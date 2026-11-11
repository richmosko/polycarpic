-- Custom migration (generate --custom). Runs as session_user poly_migrator with SET ROLE poly_owner active (src/migrate.ts).
-- Tenancy rules (POLY-62 ruling R3, R4): authz functions, triggers, policies, grants, FORCE ROW LEVEL SECURITY.
-- Ends on poly_owner: tracking rows are inserted by the active role, and only poly_owner may insert (ARCH §6.2).

-- The five system entity types are seeded before FORCE, while the owner is still exempt from the policies.
INSERT INTO public.entity_type (name, kind, system_key) VALUES
  ('Person', 'base', 'person'),
  ('Trust', 'base', 'trust'),
  ('Business', 'base', 'business'),
  ('Household', 'parent', 'household'),
  ('Holding', 'parent', 'holding');--> statement-breakpoint

-- Table privileges for the definer owners that touch tenancy tables (nothing is granted to PUBLIC).
GRANT SELECT ON public.membership TO poly_authz;--> statement-breakpoint
GRANT INSERT ON public.membership, public.audit_event TO poly_govern;--> statement-breakpoint

-- Definer owners need CREATE on their schema only for the duration of the file (as in 0001).
GRANT CREATE ON SCHEMA app TO poly_authz, poly_govern;--> statement-breakpoint

SET ROLE poly_authz;--> statement-breakpoint

-- Authz functions: read membership through the role-targeted policy below. Context only through app.current_user_id().
CREATE FUNCTION app.has_role(uuid, text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.membership m
      WHERE m.entity_id = $1
        AND m.user_id = app.current_user_id()
        AND (CASE m.role WHEN 'viewer' THEN 1 WHEN 'manager' THEN 2 WHEN 'owner' THEN 3 END)
            >= (CASE $2 WHEN 'viewer' THEN 1 WHEN 'manager' THEN 2 WHEN 'owner' THEN 3 END)
    )
  $$;--> statement-breakpoint
CREATE FUNCTION app.visible_entities() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $$
    SELECT coalesce(array_agg(m.entity_id), '{}'::uuid[]) FROM public.membership m
    WHERE m.user_id = app.current_user_id()
  $$;--> statement-breakpoint
-- NULL when the caller holds no membership on the entity: a non-member learns nothing about its owners.
CREATE FUNCTION app.owner_count(uuid) RETURNS int
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $$
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM public.membership m WHERE m.entity_id = $1 AND m.user_id = app.current_user_id())
      THEN (SELECT count(*)::int FROM public.membership o WHERE o.entity_id = $1 AND o.role = 'owner')
    END
  $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.has_role(uuid, text), app.visible_entities(), app.owner_count(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.has_role(uuid, text), app.visible_entities(), app.owner_count(uuid) TO poly_app, poly_worker;--> statement-breakpoint

SET ROLE poly_govern;--> statement-breakpoint

-- The one write of a first membership: whoever inserts an entity becomes its owner (a purged entity with no members
-- can therefore never be claimed through a poly_app policy).
CREATE FUNCTION app.seat_creator() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  BEGIN
    IF app.current_user_id() IS NULL THEN
      RAISE EXCEPTION 'no user in context' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.membership (entity_id, user_id, role) VALUES (NEW.id, app.current_user_id(), 'owner');
    RETURN NULL;
  END
  $$;--> statement-breakpoint
CREATE FUNCTION app.audit_membership() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    v_actor text := coalesce(nullif(pg_catalog.current_setting('app.actor', true), ''), 'user');
  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.audit_event (entity_id, actor_user_id, actor, kind, subject_user_id, payload)
      VALUES (NEW.entity_id, app.current_user_id(), v_actor, 'membership.created', NEW.user_id, jsonb_build_object('role', NEW.role));
    ELSIF TG_OP = 'UPDATE' THEN
      INSERT INTO public.audit_event (entity_id, actor_user_id, actor, kind, subject_user_id, payload)
      VALUES (NEW.entity_id, app.current_user_id(), v_actor, 'membership.role_changed', NEW.user_id,
              jsonb_build_object('from', OLD.role, 'to', NEW.role));
    ELSE
      INSERT INTO public.audit_event (entity_id, actor_user_id, actor, kind, subject_user_id, payload)
      VALUES (OLD.entity_id, app.current_user_id(), v_actor, 'membership.removed', OLD.user_id, jsonb_build_object('role', OLD.role));
    END IF;
    RETURN NULL;
  END
  $$;--> statement-breakpoint
-- CREATE TRIGGER needs EXECUTE for its creator; poly_owner holds it only for this file.
GRANT EXECUTE ON FUNCTION app.seat_creator(), app.audit_membership() TO poly_owner;--> statement-breakpoint

SET ROLE poly_owner;--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM poly_authz, poly_govern;--> statement-breakpoint

-- Invoker trigger functions.
CREATE FUNCTION app.check_tax_classification() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    t record;
  BEGIN
    IF NEW.purged_at IS NOT NULL THEN RETURN NEW; END IF;
    SELECT kind, system_key INTO t FROM public.entity_type WHERE id = NEW.type_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown entity type' USING ERRCODE = '23514';
    END IF;
    IF NEW.tax_classification IS NULL THEN
      NEW.tax_classification := CASE
        WHEN t.system_key = 'person' THEN 'individual'
        WHEN t.kind = 'parent' THEN 'parent_pass_through'
      END;
      IF NEW.tax_classification IS NULL THEN
        RAISE EXCEPTION 'tax classification required for this entity type' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NOT (CASE
      WHEN t.kind = 'parent' THEN NEW.tax_classification LIKE 'parent\_%'
      WHEN t.system_key = 'person' THEN NEW.tax_classification = 'individual'
      WHEN t.system_key = 'trust' THEN NEW.tax_classification LIKE 'trust\_%'
      WHEN t.system_key = 'business' THEN NEW.tax_classification LIKE 'business\_%'
      ELSE NEW.tax_classification NOT LIKE 'parent\_%'
    END) THEN
      RAISE EXCEPTION 'tax classification % is not valid for this entity type', NEW.tax_classification USING ERRCODE = '23514';
    END IF;
    IF NEW.self_user_id IS NOT NULL AND t.system_key IS DISTINCT FROM 'person' THEN
      RAISE EXCEPTION 'only a Person can be a user''s own entity' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint
CREATE FUNCTION app.refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION '% on % is not permitted', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
  END
  $$;--> statement-breakpoint
CREATE FUNCTION app.refuse_truncate() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'TRUNCATE on % is not permitted', TG_TABLE_NAME USING ERRCODE = '42501';
  END
  $$;--> statement-breakpoint
-- The last owner cannot leave. The entity row lock serialises two owners demoting each other.
CREATE FUNCTION app.keep_an_owner() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    n int;
  BEGIN
    IF OLD.role = 'owner' AND (TG_OP = 'DELETE' OR NEW.role <> 'owner') THEN
      PERFORM 1 FROM public.entity WHERE id = OLD.entity_id FOR UPDATE;
      n := app.owner_count(OLD.entity_id);
      IF n IS NULL OR n <= 1 THEN
        RAISE EXCEPTION 'an entity keeps at least one owner' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint

CREATE TRIGGER entity_tax_classification BEFORE INSERT OR UPDATE ON public.entity
  FOR EACH ROW EXECUTE FUNCTION app.check_tax_classification();--> statement-breakpoint
CREATE TRIGGER entity_seat_creator AFTER INSERT ON public.entity
  FOR EACH ROW EXECUTE FUNCTION app.seat_creator();--> statement-breakpoint
CREATE TRIGGER membership_keep_an_owner BEFORE UPDATE OR DELETE ON public.membership
  FOR EACH ROW EXECUTE FUNCTION app.keep_an_owner();--> statement-breakpoint
CREATE TRIGGER membership_audit AFTER INSERT OR UPDATE OR DELETE ON public.membership
  FOR EACH ROW EXECUTE FUNCTION app.audit_membership();--> statement-breakpoint
CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON public.audit_event
  FOR EACH ROW EXECUTE FUNCTION app.refuse_change();--> statement-breakpoint
CREATE TRIGGER entity_no_truncate BEFORE TRUNCATE ON public.entity FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint
CREATE TRIGGER entity_type_no_truncate BEFORE TRUNCATE ON public.entity_type FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint
CREATE TRIGGER membership_no_truncate BEFORE TRUNCATE ON public.membership FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint
CREATE TRIGGER invitation_no_truncate BEFORE TRUNCATE ON public.invitation FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint
CREATE TRIGGER notification_no_truncate BEFORE TRUNCATE ON public.notification FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON public.audit_event FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint

-- Revoke the file-scoped trigger-creation grant.
-- Only the grantor can revoke it.
SET ROLE poly_govern;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.seat_creator(), app.audit_membership() FROM poly_owner;--> statement-breakpoint
SET ROLE poly_owner;--> statement-breakpoint

-- Row level security: forced for every role, the table owner included.
ALTER TABLE public.entity_type FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.entity FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.membership FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.invitation FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.notification FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.audit_event FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Policies: one per command, never FOR ALL.
CREATE POLICY entity_select ON public.entity FOR SELECT TO poly_app, poly_worker
  USING (id = any (((SELECT app.visible_entities()))::uuid[]));--> statement-breakpoint
CREATE POLICY entity_insert ON public.entity FOR INSERT TO poly_app
  WITH CHECK (app.current_user_id() IS NOT NULL AND (self_user_id IS NULL OR self_user_id = app.current_user_id()));--> statement-breakpoint
CREATE POLICY entity_update ON public.entity FOR UPDATE TO poly_app
  USING (app.has_role(id, 'owner')) WITH CHECK (app.has_role(id, 'owner'));--> statement-breakpoint

CREATE POLICY membership_authz_read ON public.membership FOR SELECT TO poly_authz USING (true);--> statement-breakpoint
CREATE POLICY membership_select ON public.membership FOR SELECT TO poly_app, poly_worker
  USING (user_id = app.current_user_id() OR app.has_role(entity_id, 'manager'));--> statement-breakpoint
CREATE POLICY membership_insert ON public.membership FOR INSERT TO poly_app WITH CHECK (app.has_role(entity_id, 'owner'));--> statement-breakpoint
CREATE POLICY membership_update ON public.membership FOR UPDATE TO poly_app
  USING (app.has_role(entity_id, 'owner')) WITH CHECK (app.has_role(entity_id, 'owner'));--> statement-breakpoint
CREATE POLICY membership_delete ON public.membership FOR DELETE TO poly_app USING (app.has_role(entity_id, 'owner'));--> statement-breakpoint
CREATE POLICY membership_seat ON public.membership FOR INSERT TO poly_govern
  WITH CHECK (user_id = app.current_user_id() AND role = 'owner');--> statement-breakpoint

CREATE POLICY invitation_select ON public.invitation FOR SELECT TO poly_app, poly_worker USING (app.has_role(entity_id, 'owner'));--> statement-breakpoint
CREATE POLICY invitation_insert ON public.invitation FOR INSERT TO poly_app
  WITH CHECK (app.has_role(entity_id, 'owner') AND inviter_user_id = app.current_user_id());--> statement-breakpoint
CREATE POLICY invitation_update ON public.invitation FOR UPDATE TO poly_app
  USING (app.has_role(entity_id, 'owner')) WITH CHECK (app.has_role(entity_id, 'owner'));--> statement-breakpoint

CREATE POLICY notification_select ON public.notification FOR SELECT TO poly_app, poly_worker
  USING (recipient_user_id = app.current_user_id());--> statement-breakpoint
CREATE POLICY notification_update ON public.notification FOR UPDATE TO poly_app
  USING (recipient_user_id = app.current_user_id()) WITH CHECK (recipient_user_id = app.current_user_id());--> statement-breakpoint

CREATE POLICY audit_event_select ON public.audit_event FOR SELECT TO poly_app, poly_worker
  USING (app.has_role(entity_id, 'owner') OR actor_user_id = app.current_user_id());--> statement-breakpoint
CREATE POLICY audit_event_insert ON public.audit_event FOR INSERT TO poly_govern WITH CHECK (true);--> statement-breakpoint

CREATE POLICY entity_type_select ON public.entity_type FOR SELECT TO poly_app, poly_worker
  USING (owner_user_id IS NULL OR owner_user_id = app.current_user_id() OR id IN (SELECT type_id FROM public.entity));--> statement-breakpoint
CREATE POLICY entity_type_insert ON public.entity_type FOR INSERT TO poly_app
  WITH CHECK (system_key IS NULL AND owner_user_id = app.current_user_id());--> statement-breakpoint

-- Grants: column-exact. No role holds DELETE on entity, invitation, notification or audit_event.
GRANT SELECT ON public.entity, public.membership, public.invitation, public.notification, public.audit_event, public.entity_type
  TO poly_app, poly_worker;--> statement-breakpoint
GRANT INSERT (type_id, name, tax_classification, self_user_id) ON public.entity TO poly_app;--> statement-breakpoint
GRANT UPDATE (name, tax_classification) ON public.entity TO poly_app;--> statement-breakpoint
GRANT INSERT (entity_id, user_id, role) ON public.membership TO poly_app;--> statement-breakpoint
GRANT UPDATE (role) ON public.membership TO poly_app;--> statement-breakpoint
GRANT DELETE ON public.membership TO poly_app;--> statement-breakpoint
GRANT INSERT (entity_id, email, role, inviter_user_id, token_hash, expires_at) ON public.invitation TO poly_app;--> statement-breakpoint
GRANT UPDATE (revoked_at) ON public.invitation TO poly_app;--> statement-breakpoint
GRANT UPDATE (read_at) ON public.notification TO poly_app;--> statement-breakpoint
GRANT INSERT (name, kind, owner_user_id) ON public.entity_type TO poly_app;
