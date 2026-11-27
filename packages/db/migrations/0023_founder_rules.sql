-- Custom migration (generate --custom). Runs as session_user poly_migrator with SET ROLE poly_owner active (src/migrate.ts).
-- POLY-90 (ruling R2-R7 + addenda): the founder backfill, the founder invariant, the self-Person owner row, issued_via set once,
-- the 1 -> 2 revocation and the lock order of the seating path. No rule here exempts a role, superuser included. Ends on poly_owner.

-- ---------------------------------------------------------------------------------------------------------------------
-- (1) The backfill (R3). It runs as the table owner, so FORCE is lifted for its two statements. audit_event is read too.
-- A Person takes its own user, who must hold owner; any other entity takes the subject of its earliest owner
-- membership.created audit row who still holds owner, else its earliest owner row. The migration never invents a founder.
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.entity NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.membership NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.audit_event NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE public.entity e SET founding_owner_user_id = CASE
    WHEN e.self_user_id IS NOT NULL THEN
      (SELECT m.user_id FROM public.membership m
        WHERE m.entity_id = e.id AND m.user_id = e.self_user_id AND m.role = 'owner')
    ELSE coalesce(
      (SELECT a.subject_user_id FROM public.audit_event a
         JOIN public.membership m ON m.entity_id = a.entity_id AND m.user_id = a.subject_user_id AND m.role = 'owner'
        WHERE a.entity_id = e.id AND a.kind = 'membership.created' AND a.payload ->> 'role' = 'owner'
        ORDER BY a.created_at, a.id LIMIT 1),
      (SELECT m.user_id FROM public.membership m
        WHERE m.entity_id = e.id AND m.role = 'owner'
        ORDER BY m.created_at, m.id LIMIT 1))
  END
  WHERE e.purged_at IS NULL;--> statement-breakpoint
DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.entity e WHERE e.purged_at IS NULL AND e.founding_owner_user_id IS NULL) THEN
      RAISE EXCEPTION 'founder backfill: an entity has no owner to found it' USING ERRCODE = '23514';
    END IF;
  END
  $$;--> statement-breakpoint
ALTER TABLE public.entity FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.membership FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.audit_event FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------------
-- (2) Grants and policies. poly_authz reads the founder for the invariant. poly_govern may lock any entity row and, with
-- WITH CHECK (false), update none (POLY-112 replaces the check for transfer_founder). Its one new invitation write is the
-- revocation of an outstanding direct row; invitation_govern_update and invitation_bootstrap_revoke are unchanged.
-- ---------------------------------------------------------------------------------------------------------------------
GRANT SELECT (founding_owner_user_id, purged_at) ON public.entity TO poly_authz;--> statement-breakpoint
GRANT UPDATE (founding_owner_user_id) ON public.entity TO poly_govern;--> statement-breakpoint
CREATE POLICY entity_govern_lock_read ON public.entity FOR SELECT TO poly_govern USING (true);--> statement-breakpoint
CREATE POLICY entity_govern_lock ON public.entity FOR UPDATE TO poly_govern USING (true) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY invitation_govern_transition_revoke ON public.invitation FOR UPDATE TO poly_govern
  USING (issued_via = 'owner' AND entity_id IS NOT NULL AND revoked_at IS NULL AND accepted_at IS NULL)
  WITH CHECK (issued_via = 'owner' AND revoked_at IS NOT NULL);--> statement-breakpoint

-- A definer owner needs CREATE on its schema only for the duration of the file.
GRANT CREATE ON SCHEMA app TO poly_authz, poly_govern;--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------------
-- (3) poly_authz definers
-- ---------------------------------------------------------------------------------------------------------------------
SET ROLE poly_authz;--> statement-breakpoint

-- The founder invariant (R2), deferred: it re-reads the state at commit, whoever commits. A missing entity row refuses. A
-- purged entity has no founder and is skipped by state, never by role. Read only.
CREATE FUNCTION app.founder_holds_owner() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_entity uuid;
    v_founder uuid;
    v_purged timestamptz;
  BEGIN
    -- NEW and OLD do not have the same columns on the two tables, so each read is its own statement.
    IF TG_TABLE_NAME = 'entity' THEN
      v_entity := NEW.id;
    ELSE
      v_entity := OLD.entity_id;
    END IF;
    SELECT e.founding_owner_user_id, e.purged_at INTO v_founder, v_purged FROM public.entity e WHERE e.id = v_entity;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'the founding owner must hold owner' USING ERRCODE = '23514';
    END IF;
    IF v_purged IS NOT NULL THEN
      RETURN NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.membership m
                   WHERE m.entity_id = v_entity AND m.user_id = v_founder AND m.role = 'owner') THEN
      RAISE EXCEPTION 'the founding owner must hold owner' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END
  $fn$;--> statement-breakpoint

-- The self user's owner row on their own Person cannot be lowered or deleted (R4, seceng F1), refused at the statement.
CREATE FUNCTION app.keep_own_person_owner() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_self uuid;
  BEGIN
    IF OLD.role = 'owner' AND (TG_OP = 'DELETE' OR NEW.role <> 'owner') THEN
      SELECT e.self_user_id INTO v_self FROM public.entity e WHERE e.id = OLD.entity_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'entity not available' USING ERRCODE = '42501';
      END IF;
      IF v_self = OLD.user_id THEN
        RAISE EXCEPTION 'a user keeps owner on their own Person' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END
  $fn$;--> statement-breakpoint

-- The owner rows of an entity, whoever asks (R6): unlike owner_count it is not relative to the caller, so no context can
-- null it. VOLATILE: the caller reads it in a statement after its lock. A held raise leaves role below owner (ARCH 3.1c).
CREATE FUNCTION app.effective_owner_count(p_entity uuid) RETURNS int
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $$
    SELECT pg_catalog.count(*)::int FROM public.membership m WHERE m.entity_id = p_entity AND m.role = 'owner'
  $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.founder_holds_owner(), app.keep_own_person_owner(), app.effective_owner_count(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.effective_owner_count(uuid) TO poly_govern;--> statement-breakpoint
-- CREATE TRIGGER needs EXECUTE for its creator; poly_owner holds it only for this file.
GRANT EXECUTE ON FUNCTION app.founder_holds_owner(), app.keep_own_person_owner() TO poly_owner;--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------------
-- (4) poly_govern definers
-- ---------------------------------------------------------------------------------------------------------------------
SET ROLE poly_govern;--> statement-breakpoint

-- The 1 -> 2 revocation (R6, A-24, C-28): in the transaction of every membership write that makes an owner. The entity row
-- is locked first and the owners are counted in a later statement; from two owners on, every outstanding direct invitation
-- of the entity is revoked, claimed or not, expired or not.
CREATE FUNCTION app.owner_transition() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    n int;
    v_actor text;
    r record;
  BEGIN
    IF NEW.role <> 'owner' THEN
      RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF OLD.role = 'owner' THEN
        RETURN NULL;
      END IF;
    END IF;
    PERFORM 1 FROM public.entity e WHERE e.id = NEW.entity_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'entity not available' USING ERRCODE = '42501';
    END IF;
    n := app.effective_owner_count(NEW.entity_id);
    IF n IS NULL THEN
      RAISE EXCEPTION 'entity not available' USING ERRCODE = '42501';
    END IF;
    IF n < 2 THEN
      RETURN NULL;
    END IF;
    -- The actor, as app.audit_membership() computes it (its current body, 0017).
    v_actor := coalesce(
      (SELECT CASE t.kind WHEN 'signup' THEN 'user' WHEN 'auth' THEN 'user' WHEN 'session' THEN 'user' ELSE t.kind END
         FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned()),
      nullif(pg_catalog.current_setting('app.actor', true), ''),
      'none');
    FOR r IN
      UPDATE public.invitation i SET revoked_at = pg_catalog.now()
      WHERE i.entity_id = NEW.entity_id AND i.issued_via = 'owner' AND i.revoked_at IS NULL AND i.accepted_at IS NULL
      RETURNING i.id, i.inviter_user_id
    LOOP
      INSERT INTO public.audit_event (entity_id, actor_user_id, actor, kind, payload)
      VALUES (NEW.entity_id, app.current_user_id(), v_actor, 'invitation.revoked',
              pg_catalog.jsonb_build_object('invitation_id', r.id, 'reason', 'owner_transition'));
      IF r.inviter_user_id IS NOT NULL THEN
        INSERT INTO public.notification (recipient_user_id, kind, payload)
        VALUES (r.inviter_user_id, 'invitation.revoked',
                pg_catalog.jsonb_build_object('invitation_id', r.id, 'entity_id', NEW.entity_id, 'reason', 'owner_transition'));
      END IF;
    END LOOP;
    RETURN NULL;
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.owner_transition() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.owner_transition() TO poly_owner;--> statement-breakpoint

-- 0013's seating, with one lock order (R7): the entity rows, in id order, before any invitation row. The loop reads in a
-- later statement, so it skips a row that was revoked while the lock was waited for. acceptance is written before the
-- membership, so the revocation that write fires never matches the row being seated.
CREATE OR REPLACE FUNCTION app.seat_claimed_invitations() RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_uid uuid := app.current_user_id();
    r record;
  BEGIN
    IF v_uid IS NULL THEN
      RETURN;
    END IF;
    PERFORM 1 FROM public.entity e
    WHERE e.id IN (SELECT i.entity_id FROM public.invitation i
                   WHERE i.claimed_user_id = v_uid AND i.accepted_at IS NULL AND i.revoked_at IS NULL
                     AND i.entity_id IS NOT NULL AND i.role IN ('manager', 'owner'))
    ORDER BY e.id FOR UPDATE;
    FOR r IN
      SELECT i.id, i.entity_id, i.role FROM public.invitation i
      WHERE i.claimed_user_id = v_uid AND i.accepted_at IS NULL AND i.revoked_at IS NULL
        AND i.entity_id IS NOT NULL AND i.role IN ('manager', 'owner')
      ORDER BY i.id FOR UPDATE
    LOOP
      -- The loop's rows are fetched ahead: a seat earlier in this loop can revoke a later one (the same user's second
      -- invitation to the same entity), so the write asks again and a revoked row seats nothing.
      UPDATE public.invitation SET accepted_at = pg_catalog.now() WHERE id = r.id AND revoked_at IS NULL;
      CONTINUE WHEN NOT FOUND;
      INSERT INTO public.membership (entity_id, user_id, role) VALUES (r.entity_id, v_uid, r.role) ON CONFLICT DO NOTHING;
    END LOOP;
  END
  $fn$;--> statement-breakpoint

SET ROLE poly_owner;--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM poly_authz, poly_govern;--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------------
-- (5) The invoker function: 0007's set-once rule, with issued_via checked first (R5). It never changes, for any role.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.invitation_set_once() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF NEW.issued_via IS DISTINCT FROM OLD.issued_via THEN
      RAISE EXCEPTION 'an invitation''s issued_via never changes' USING ERRCODE = '42501';
    END IF;
    IF (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
       OR (OLD.claimed_user_id IS NOT NULL AND NEW.claimed_user_id IS DISTINCT FROM OLD.claimed_user_id)
       OR (OLD.claimed_at IS NOT NULL AND NEW.claimed_at IS DISTINCT FROM OLD.claimed_at)
       OR (OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at) THEN
      RAISE EXCEPTION 'an invitation''s revocation, claim and acceptance are set once' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------------
-- (6) Triggers. The names carry the order: _15_ after the gate (_10_) and before keep_an_owner (_20_); entity_z91 after
-- entity_seat_creator, so SET CONSTRAINTS ALL IMMEDIATE does not check an owner row that is not written yet.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TRIGGER membership_15_own_person_owner BEFORE UPDATE OR DELETE ON public.membership
  FOR EACH ROW EXECUTE FUNCTION app.keep_own_person_owner();--> statement-breakpoint
CREATE TRIGGER membership_80_owner_transition AFTER INSERT OR UPDATE OF role ON public.membership
  FOR EACH ROW EXECUTE FUNCTION app.owner_transition();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER entity_z91_founder_holds_owner AFTER INSERT OR UPDATE ON public.entity
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.founder_holds_owner();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER membership_91_founder_holds_owner AFTER UPDATE OR DELETE ON public.membership
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.founder_holds_owner();--> statement-breakpoint

-- Revoke the file-scoped trigger-creation grant. Only the grantor can revoke it.
SET ROLE poly_authz;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.founder_holds_owner(), app.keep_own_person_owner() FROM poly_owner;--> statement-breakpoint
SET ROLE poly_govern;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.owner_transition() FROM poly_owner;--> statement-breakpoint
SET ROLE poly_owner;
