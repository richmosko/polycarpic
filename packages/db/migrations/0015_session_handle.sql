-- Custom migration (generate --custom). Runs as session_user poly_migrator with SET ROLE poly_owner active (src/migrate.ts).
-- POLY-153 (ruling R1-R6, R11): web enters a transaction by a session handle. The table that holds the handle's SHA-256, the definers that
-- issue and check it, the three Sessions definers, and the deferred check that no session commits without its handle.
-- Order as R11: (1) the table, (2) the kind CHECK, (3) poly_authz's added grants, (4) the definers (poly_authz), (5) audit_membership
-- (poly_govern), (6) the constraint trigger (poly_owner). Ends on poly_owner. Nothing here revokes anything from poly_app (POLY-149).

-- (1) R1: one handle per session, for life. Only poly_authz reads or inserts; no login role holds anything.
CREATE TABLE app.session_handle (
  session_id  uuid PRIMARY KEY REFERENCES public.session(id) ON DELETE CASCADE,
  handle_hash bytea NOT NULL UNIQUE CHECK (pg_catalog.octet_length(handle_hash) = 32),
  created_at  timestamptz NOT NULL DEFAULT pg_catalog.now()
);--> statement-breakpoint
ALTER TABLE app.session_handle ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app.session_handle FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON app.session_handle FROM PUBLIC;--> statement-breakpoint
GRANT SELECT, INSERT ON app.session_handle TO poly_authz;--> statement-breakpoint
CREATE POLICY session_handle_read ON app.session_handle FOR SELECT TO poly_authz USING (true);--> statement-breakpoint
CREATE POLICY session_handle_attach ON app.session_handle FOR INSERT TO poly_authz WITH CHECK (true);--> statement-breakpoint
CREATE TRIGGER session_handle_no_truncate BEFORE TRUNCATE ON app.session_handle FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint

-- (2) The marker's kind gains 'session' (R4).
ALTER TABLE app.tx_identity DROP CONSTRAINT tx_identity_kind_check;--> statement-breakpoint
ALTER TABLE app.tx_identity ADD CONSTRAINT tx_identity_kind_check
  CHECK (kind IN ('web', 'signup', 'auth', 'session') OR kind ~ '^system:[a-z][a-z0-9_]{0,62}$');--> statement-breakpoint

-- (3) poly_authz's added grants (R2): what the six definers read and write, nothing on a tenant table, no INSERT on session.
GRANT SELECT (recent_auth_at, user_agent, ip_address, updated_at) ON public.session TO poly_authz;--> statement-breakpoint
GRANT UPDATE (expires_at, updated_at) ON public.session TO poly_authz;--> statement-breakpoint
GRANT DELETE ON public.session TO poly_authz;--> statement-breakpoint
GRANT SELECT (id, name, image) ON public."user" TO poly_authz;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_session_id() TO poly_authz;--> statement-breakpoint

-- (4) The definers. A definer owner needs CREATE on its schema only for the duration of the file.
GRANT CREATE ON SCHEMA app TO poly_authz, poly_govern;--> statement-breakpoint

SET ROLE poly_authz;--> statement-breakpoint

-- R3: the handle is issued here, from poly_auth, for a session created in the caller's own transaction. At rest every committed session
-- has a handle (the deferred check below), so step 4 refuses every committed session. No login role can read a hash (R1).
CREATE FUNCTION app.attach_session_handle(p_session uuid, p_handle text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.attach_session_handle($1, $2)' THEN
      RAISE EXCEPTION 'an identity definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF p_session IS NULL OR p_handle IS NULL THEN
      RAISE EXCEPTION 'a session and a handle are required' USING ERRCODE = '22004';
    END IF;
    IF p_handle !~ '^[A-Za-z0-9_-]{43}$' THEN
      RAISE EXCEPTION 'invalid handle' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.session s WHERE s.id = p_session) THEN
      RETURN false;
    END IF;
    IF EXISTS (SELECT 1 FROM app.session_handle h WHERE h.session_id = p_session) THEN
      RETURN false;
    END IF;
    INSERT INTO app.session_handle (session_id, handle_hash) VALUES (p_session, pg_catalog.sha256(pg_catalog.convert_to(p_handle, 'UTF8')));
    RETURN true;
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.attach_session_handle(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.attach_session_handle(uuid, text) TO poly_auth;--> statement-breakpoint

-- R4: web's entry. The plain handle is hashed here and nowhere else; one message for every refusal.
CREATE FUNCTION app.enter_session(p_handle text)
  RETURNS TABLE (xid text, user_id uuid, session_id uuid, name text, image text, expires_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  #variable_conflict use_column
  DECLARE
    v_user uuid;
    v_session uuid;
    v_created timestamptz;
    v_expires timestamptz;
    v_name text;
    v_image text;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT * FROM app.enter_session($1)' THEN
      RAISE EXCEPTION 'an identity definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF p_handle IS NULL THEN
      RAISE EXCEPTION 'identity is required' USING ERRCODE = '22004';
    END IF;
    IF EXISTS (SELECT 1 FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned()) THEN
      RAISE EXCEPTION 'this transaction already has an identity' USING ERRCODE = '42501';
    END IF;
    IF pg_catalog.pg_current_xact_id_if_assigned() IS NOT NULL THEN
      RAISE EXCEPTION 'the identity marker must be the first write of its transaction' USING ERRCODE = '42501';
    END IF;
    IF p_handle ~ '^[A-Za-z0-9_-]{43}$' THEN
      SELECT s.user_id, s.id, s.created_at, s.expires_at, u.name, u.image INTO v_user, v_session, v_created, v_expires, v_name, v_image
        FROM app.session_handle h
        JOIN public.session s ON s.id = h.session_id
        JOIN public."user" u ON u.id = s.user_id
        WHERE h.handle_hash = pg_catalog.sha256(pg_catalog.convert_to(p_handle, 'UTF8'))
          AND s.expires_at > pg_catalog.now() AND s.created_at + interval '30 days' > pg_catalog.now();
    END IF;
    IF v_user IS NULL THEN
      RAISE EXCEPTION 'no live session' USING ERRCODE = '42501';
    END IF;
    INSERT INTO app.tx_identity (xid, user_id, session_id, kind) VALUES (pg_catalog.pg_current_xact_id(), v_user, v_session, 'session');
    -- The slide (POLY-152 R7): at most once a day, never past the 30-day cap. After the marker insert, so the first-write check holds.
    IF v_expires <= pg_catalog.now() + interval '6 days' THEN
      v_expires := LEAST(pg_catalog.now() + interval '7 days', v_created + interval '30 days');
      UPDATE public.session s SET expires_at = v_expires, updated_at = pg_catalog.now() WHERE s.id = v_session;
    END IF;
    RETURN QUERY SELECT pg_catalog.pg_current_xact_id()::pg_catalog.text, v_user, v_session, v_name, v_image, v_expires;
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.enter_session(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.enter_session(text) TO poly_app;--> statement-breakpoint

-- R5.2: no session commits without its handle. Fires at commit, for every role, superuser included.
CREATE FUNCTION app.session_needs_handle() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.session s WHERE s.id = NEW.id)
       AND NOT EXISTS (SELECT 1 FROM app.session_handle h WHERE h.session_id = NEW.id) THEN
      RAISE EXCEPTION 'a session needs its handle' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.session_needs_handle() FROM PUBLIC;--> statement-breakpoint
-- CREATE TRIGGER checks EXECUTE for the creator (poly_owner, below); the grant is dropped again straight after.
GRANT EXECUTE ON FUNCTION app.session_needs_handle() TO poly_owner;--> statement-breakpoint

-- R6: Settings -> Sessions, revoke and step-up. Each refuses 42501 unless the marker is of kind 'session'.
CREATE FUNCTION app.recent_auth_ok() RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned() AND t.kind = 'session') THEN
      RAISE EXCEPTION 'a web session is required' USING ERRCODE = '42501';
    END IF;
    RETURN coalesce((SELECT true FROM public.session s
                      WHERE s.id = app.current_session_id() AND s.user_id = app.current_user_id()
                        AND s.recent_auth_at <= pg_catalog.now()
                        AND s.recent_auth_at >= pg_catalog.now() - interval '300 seconds'), false);
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.recent_auth_ok() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.recent_auth_ok() TO poly_app;--> statement-breakpoint

CREATE FUNCTION app.my_sessions()
  RETURNS TABLE (id uuid, user_agent text, ip_address text, created_at timestamptz, updated_at timestamptz, current boolean)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  #variable_conflict use_column
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned() AND t.kind = 'session') THEN
      RAISE EXCEPTION 'a web session is required' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT s.id, s.user_agent, s.ip_address, s.created_at, s.updated_at, s.id = app.current_session_id()
      FROM public.session s WHERE s.user_id = app.current_user_id() ORDER BY s.created_at, s.id;
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.my_sessions() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.my_sessions() TO poly_app;--> statement-breakpoint

CREATE FUNCTION app.revoke_my_session(p_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned() AND t.kind = 'session') THEN
      RAISE EXCEPTION 'a web session is required' USING ERRCODE = '42501';
    END IF;
    IF p_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.session s WHERE s.id = p_id AND s.user_id = app.current_user_id()) THEN
      RAISE EXCEPTION 'no such session' USING ERRCODE = 'P0002';
    END IF;
    IF p_id IS DISTINCT FROM app.current_session_id() AND NOT app.recent_auth_ok() THEN
      RAISE EXCEPTION 'step_up_required' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.session s WHERE s.id = p_id AND s.user_id = app.current_user_id();
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.revoke_my_session(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.revoke_my_session(uuid) TO poly_app;--> statement-breakpoint

-- (5) The actor of a session-marked transaction is the user, as for web, signup and auth (R4).
SET ROLE poly_govern;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.audit_membership() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    v_actor text := coalesce(
      (SELECT CASE t.kind WHEN 'web' THEN 'user' WHEN 'signup' THEN 'user' WHEN 'auth' THEN 'user' WHEN 'session' THEN 'user' ELSE t.kind END
         FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned()),
      nullif(pg_catalog.current_setting('app.actor', true), ''),
      'none');
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

-- (6) The deferred check, on the table's owner.
SET ROLE poly_owner;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER session_needs_handle AFTER INSERT ON public.session
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.session_needs_handle();--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM poly_authz, poly_govern;--> statement-breakpoint
SET ROLE poly_authz;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.session_needs_handle() FROM poly_owner;--> statement-breakpoint
SET ROLE poly_owner;
