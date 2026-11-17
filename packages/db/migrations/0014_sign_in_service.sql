-- Custom migration (generate --custom). Runs as session_user poly_migrator with SET ROLE poly_owner active (src/migrate.ts).
-- POLY-152 (ruling R2, R3, R5, R8, R10): the sign-in service's role poly_auth (created by roles.sql, run before migrate), its
-- grants, the two definers it needs (enter_auth_session, provision_person), and the twelve EXECUTE removals from poly_app.
-- Order as R10: (1) table grants and the tx_identity policy, (2) kind CHECK, (3) the sign-up stamp, (4) owner grants and policies,
-- (5) the definers, (6) EXECUTE grants then REVOKEs. Ends on poly_owner.

-- (1) poly_auth's table grants: exactly poly_app's on BetterAuth's six tables (0001, 0005), nothing on any other table.
GRANT USAGE ON SCHEMA app TO poly_auth;--> statement-breakpoint
GRANT USAGE ON SCHEMA drizzle TO poly_auth;--> statement-breakpoint
GRANT SELECT ON drizzle.__drizzle_migrations TO poly_auth;--> statement-breakpoint
GRANT SELECT ON public."user" TO poly_auth;--> statement-breakpoint
GRANT INSERT (id, name, email, email_verified, image, two_factor_enabled, created_at, updated_at) ON public."user" TO poly_auth;--> statement-breakpoint
GRANT UPDATE (name, email, email_verified, image, updated_at) ON public."user" TO poly_auth;--> statement-breakpoint
GRANT SELECT, DELETE ON public.session TO poly_auth;--> statement-breakpoint
GRANT INSERT (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id) ON public.session TO poly_auth;--> statement-breakpoint
GRANT UPDATE (expires_at, token, updated_at, ip_address, user_agent) ON public.session TO poly_auth;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account, public.verification, public.two_factor, public.passkey TO poly_auth;--> statement-breakpoint
GRANT SELECT ON app.tx_identity TO poly_auth;--> statement-breakpoint
ALTER POLICY tx_identity_own ON app.tx_identity
  TO poly_app, poly_worker, poly_auth, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal;--> statement-breakpoint

-- (2) The marker's kind gains 'auth' (R5).
ALTER TABLE app.tx_identity DROP CONSTRAINT tx_identity_kind_check;--> statement-breakpoint
ALTER TABLE app.tx_identity ADD CONSTRAINT tx_identity_kind_check
  CHECK (kind IN ('web', 'signup', 'auth') OR kind ~ '^system:[a-z][a-z0-9_]{0,62}$');--> statement-breakpoint

-- (3) The sign-up stamp: only a poly_auth insert is a sign-up from here (R2). A poly_app user insert gets a NULL stamp, so
-- enter_new_user refuses it.
CREATE OR REPLACE FUNCTION app.stamp_signup_user() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    v_tx pg_catalog.int8 := pg_catalog.pg_current_xact_id()::pg_catalog.text::pg_catalog.int8;
  BEGIN
    -- Only a poly_auth insert is a sign-up. Any other role (superuser seeds, the web role, poly_worker, restores) gets a NULL stamp, so
    -- it neither counts toward one user per transaction nor trips signup_stamp_cleared at commit.
    IF current_user <> 'poly_auth' THEN
      NEW.signup_txid := NULL;
      RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM public."user" u WHERE u.signup_txid = v_tx) THEN
      RAISE EXCEPTION 'one user per transaction' USING ERRCODE = '42501';
    END IF;
    NEW.signup_txid := v_tx;
    RETURN NEW;
  END
  $$;--> statement-breakpoint

-- (4) Owner grants, each for one definer alone.
-- enter_auth_session (poly_authz) reads the live session row it enters from.
GRANT SELECT (id, user_id, token, expires_at, created_at) ON public.session TO poly_authz;--> statement-breakpoint
-- provision_person (poly_govern): the Person insert and the reads it checks first (R3).
GRANT INSERT (type_id, name, self_user_id) ON public.entity TO poly_govern;--> statement-breakpoint
GRANT SELECT (id, self_user_id) ON public.entity TO poly_govern;--> statement-breakpoint
GRANT SELECT (id, system_key) ON public.entity_type TO poly_govern;--> statement-breakpoint
GRANT SELECT (id, name, signup_txid) ON public."user" TO poly_govern;--> statement-breakpoint
CREATE POLICY entity_provision_insert ON public.entity FOR INSERT TO poly_govern
  WITH CHECK (self_user_id = app.current_user_id());--> statement-breakpoint
CREATE POLICY entity_provision_read ON public.entity FOR SELECT TO poly_govern
  USING (self_user_id = app.current_user_id());--> statement-breakpoint
CREATE POLICY entity_type_govern_read ON public.entity_type FOR SELECT TO poly_govern
  USING (system_key = 'person');--> statement-breakpoint

-- (5) The definers. A definer owner needs CREATE on its schema only for the duration of the file.
GRANT CREATE ON SCHEMA app TO poly_authz, poly_govern;--> statement-breakpoint

SET ROLE poly_authz;--> statement-breakpoint

-- The service's own entry (R5): a live session row writes the marker. Same checks as enter_asserted_user (0011).
CREATE FUNCTION app.enter_auth_session(text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_user uuid;
    v_session uuid;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.enter_auth_session($1)' THEN
      RAISE EXCEPTION 'an identity definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF $1 IS NULL THEN
      RAISE EXCEPTION 'identity is required' USING ERRCODE = '22004';
    END IF;
    IF EXISTS (SELECT 1 FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned()) THEN
      RAISE EXCEPTION 'this transaction already has an identity' USING ERRCODE = '42501';
    END IF;
    IF pg_catalog.pg_current_xact_id_if_assigned() IS NOT NULL THEN
      RAISE EXCEPTION 'the identity marker must be the first write of its transaction' USING ERRCODE = '42501';
    END IF;
    SELECT s.user_id, s.id INTO v_user, v_session FROM public.session s
      WHERE s.token = $1 AND s.expires_at > pg_catalog.now() AND s.created_at + interval '30 days' > pg_catalog.now();
    IF v_user IS NULL THEN
      RAISE EXCEPTION 'no live session' USING ERRCODE = '42501';
    END IF;
    INSERT INTO app.tx_identity (xid, user_id, session_id, kind) VALUES (pg_catalog.pg_current_xact_id(), v_user, v_session, 'auth');
    RETURN pg_catalog.pg_current_xact_id()::pg_catalog.text;
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.enter_auth_session(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.enter_auth_session(text) TO poly_auth;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.enter_new_user(uuid) TO poly_auth;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.enter_new_user(uuid) FROM poly_app;--> statement-breakpoint

SET ROLE poly_govern;--> statement-breakpoint

-- The Person insert of a sign-up (R3). poly_auth holds no write on entity; this definer does it for the user this transaction created.
CREATE FUNCTION app.provision_person() RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_user uuid;
    v_kind text;
    v_name text;
    v_type uuid;
    v_id uuid;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.provision_person()' THEN
      RAISE EXCEPTION 'an identity definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    SELECT t.user_id, t.kind INTO v_user, v_kind FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned();
    IF v_user IS NULL OR v_kind IS DISTINCT FROM 'signup' THEN
      RAISE EXCEPTION 'not a sign-up transaction' USING ERRCODE = '42501';
    END IF;
    SELECT u.name INTO v_name FROM public."user" u
      WHERE u.id = v_user AND u.signup_txid = pg_catalog.pg_current_xact_id()::pg_catalog.text::pg_catalog.int8;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not a user created by this transaction' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.entity e WHERE e.self_user_id = v_user) THEN
      RAISE EXCEPTION 'the user already has a Person' USING ERRCODE = '42501';
    END IF;
    SELECT t.id INTO v_type FROM public.entity_type t WHERE t.system_key = 'person';
    INSERT INTO public.entity (type_id, name, self_user_id) VALUES (v_type, coalesce(v_name, 'Person'), v_user) RETURNING id INTO v_id;
    RETURN v_id;
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.provision_person() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.provision_person() TO poly_auth;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.claim_invitations(bytea, text), app.accept_invitations(bytea),
  app.step_up_fresh(), app.enrol_proof(text), app.enrolment_grant_live(), app.check_factor_removal(uuid, text, uuid),
  app.set_two_factor_enabled(boolean), app.consume_passkey_grant(), app.take_recent_auth_stamp(uuid),
  app.issue_email_challenge(text), app.confirm_email_challenge(text)
  TO poly_auth;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION
  app.claim_invitations(bytea, text), app.accept_invitations(bytea),
  app.step_up_fresh(), app.enrol_proof(text), app.enrolment_grant_live(), app.check_factor_removal(uuid, text, uuid),
  app.set_two_factor_enabled(boolean), app.consume_passkey_grant(), app.take_recent_auth_stamp(uuid),
  app.issue_email_challenge(text), app.confirm_email_challenge(text)
  FROM poly_app;--> statement-breakpoint

-- The actor of an auth-marked transaction is the user, as for web and signup (R5).
CREATE OR REPLACE FUNCTION app.audit_membership() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    v_actor text := coalesce(
      (SELECT CASE t.kind WHEN 'web' THEN 'user' WHEN 'signup' THEN 'user' WHEN 'auth' THEN 'user' ELSE t.kind END
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

SET ROLE poly_owner;--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM poly_authz, poly_govern;--> statement-breakpoint

-- (6) The readers (owned by poly_owner). The definers' own grants and the twelve REVOKEs from poly_app ran above, by their owners:
-- only a function's owner can change its ACL.
GRANT EXECUTE ON FUNCTION app.current_user_id() TO poly_auth;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_session_id() TO poly_auth;
