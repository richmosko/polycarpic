-- The spike's own SQL, applied as postgres after the product chain (roles.sql, then the migrations). Throwaway.
-- 1. poly_auth, the sign-in service's role. 2. app.session_handle. 3. web's reach narrowed to what stage 2 leaves it.
-- 4. the lookup definer web calls with sha256(handle). Everything poly_auth holds is listed here, so the S line can be read against it.

DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'poly_auth') THEN CREATE ROLE poly_auth; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'poly148_lookup') THEN CREATE ROLE poly148_lookup; END IF;
END $r$;
ALTER ROLE poly_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE poly148_lookup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SELECT format('GRANT CONNECT ON DATABASE %I TO poly_auth', current_database()) \gexec

GRANT USAGE ON SCHEMA public, app, drizzle TO poly_auth;
GRANT SELECT ON drizzle.__drizzle_migrations TO poly_auth;

-- BetterAuth's tables: what poly_app holds today (0001, 0005), moved to poly_auth.
GRANT SELECT, INSERT ON public."user" TO poly_auth;
GRANT INSERT (id, name, email, email_verified, image, two_factor_enabled, created_at, updated_at) ON public."user" TO poly_auth;
GRANT UPDATE (name, email, email_verified, image, updated_at) ON public."user" TO poly_auth;
-- Stand-in for POLY-89's grant (the checks enrol TOTP through the real routes): BetterAuth's twoFactor writes this column at the first verify.
GRANT UPDATE (two_factor_enabled) ON public."user" TO poly_auth;
GRANT SELECT, DELETE ON public.session TO poly_auth;
GRANT INSERT (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id) ON public.session TO poly_auth;
GRANT UPDATE (expires_at, token, updated_at, ip_address, user_agent) ON public.session TO poly_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account, public.verification, public.two_factor, public.passkey TO poly_auth;

-- The handle table.
CREATE TABLE IF NOT EXISTS app.session_handle (
  session_id uuid NOT NULL REFERENCES public.session(id) ON DELETE CASCADE,
  handle_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.session_handle OWNER TO poly_owner;
REVOKE ALL ON app.session_handle FROM PUBLIC;
GRANT SELECT, INSERT ON app.session_handle TO poly_auth;

-- The existing definers and the marker read, as poly_app has them today. The sign-in service opens withTenant and withContextFreeTx itself.
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.current_session_id() TO poly_auth;
GRANT SELECT ON app.tx_identity TO poly_auth;
GRANT EXECUTE ON FUNCTION app.enter_new_user(uuid), app.enter_asserted_user(uuid, uuid), app.claim_invitations(bytea, text), app.accept_invitations(bytea) TO poly_auth;
GRANT EXECUTE ON FUNCTION app.has_role(uuid, text), app.visible_entities(), app.owner_count(uuid) TO poly_auth;

-- The tenancy reach sign-up needs today: provisionPerson inserts the Person entity in the new user's marked transaction, and the
-- claim reads the invitation columns. Each is poly_app's grant (0003, 0006-0009) repeated for poly_auth. The S line reports them.
GRANT SELECT ON public.entity, public.membership TO poly_auth;
GRANT INSERT (type_id, name, tax_classification, self_user_id) ON public.entity TO poly_auth;
GRANT SELECT (id, created_at, name, kind, system_key) ON public.entity_type TO poly_auth;
GRANT SELECT (claimed_user_id, claimed_at, issued_via) ON public.invitation TO poly_auth;
DO $p$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname, tablename, roles FROM pg_policies
           WHERE schemaname = 'public' AND tablename IN ('entity', 'membership', 'entity_type', 'invitation') AND 'poly_app' = ANY (roles)
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO %s', r.policyname, r.tablename,
      (SELECT string_agg(quote_ident(q.y), ', ') FROM (SELECT DISTINCT unnest(r.roles || ARRAY['poly_auth']::name[]) AS y) q));
  END LOOP;
END $p$;

-- Web's reach, as stage 2 leaves it: no BetterAuth secret, no write on BetterAuth's tables or the handle table.
REVOKE ALL ON public.session, public.account, public.verification, public.two_factor, public.passkey FROM poly_app;
REVOKE ALL ON public."user" FROM poly_app;
GRANT SELECT (id, name, email, email_verified, image, created_at, updated_at) ON public."user" TO poly_app;
REVOKE ALL ON app.session_handle FROM poly_app;

-- The lookup: web sends sha256(cookie value) and learns the user and session, nothing else.
GRANT USAGE ON SCHEMA app, public TO poly148_lookup;
GRANT SELECT (id, user_id, expires_at) ON public.session TO poly148_lookup;
GRANT SELECT ON app.session_handle TO poly148_lookup;
CREATE OR REPLACE FUNCTION app.spike_session_of_handle(p_hash bytea) RETURNS TABLE (user_id uuid, session_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $f$ SELECT s.user_id, s.id FROM app.session_handle h JOIN public.session s ON s.id = h.session_id
         WHERE h.handle_hash = p_hash AND s.expires_at > pg_catalog.now() $f$;
ALTER FUNCTION app.spike_session_of_handle(bytea) OWNER TO poly148_lookup;
REVOKE EXECUTE ON FUNCTION app.spike_session_of_handle(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.spike_session_of_handle(bytea) TO poly_app;

-- Stand-ins for the stage-2 migration (each is a measured failure first; the record names the unpatched error):
-- (a) the first TOTP verify rotates the session with createSession(userId, false, activeSession), which copies recent_auth_at into the INSERT.
--     poly_app has no INSERT on that column (0005), so the rotation fails there too until POLY-89's definers own the column.
GRANT INSERT (recent_auth_at) ON public.session TO poly_auth;
-- (b) app.stamp_signup_user() (0007) treats only `current_user = 'poly_app'` as a sign-up; poly_auth's insert gets a NULL stamp and
--     enter_new_user then refuses ('not a user created by this transaction'). Same body, the role test widened.
CREATE OR REPLACE FUNCTION app.stamp_signup_user() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    v_tx pg_catalog.int8 := pg_catalog.pg_current_xact_id()::pg_catalog.text::pg_catalog.int8;
  BEGIN
    IF current_user NOT IN ('poly_app', 'poly_auth') THEN
      NEW.signup_txid := NULL;
      RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM public."user" u WHERE u.signup_txid = v_tx) THEN
      RAISE EXCEPTION 'one user per transaction' USING ERRCODE = '42501';
    END IF;
    NEW.signup_txid := v_tx;
    RETURN NEW;
  END
  $$;

-- (c) the marker read: tx_identity_own (0011) is TO the nine roles; poly_auth must read its own transaction's marker for app.current_user_id().
ALTER POLICY tx_identity_own ON app.tx_identity TO poly_app, poly_worker, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal, poly_auth;
