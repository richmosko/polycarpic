-- Custom migration (generate --custom). Runs as session_user poly_migrator with SET ROLE poly_owner active (src/migrate.ts).
-- POLY-87 (ruling R2): the sign-up stamp, the set-once rule, the new-user step and the invitation claim/accept definers.
-- Ends on poly_owner.

-- Table privileges the definer owners need (nothing is granted to PUBLIC). poly_app gets no write on any of it.
GRANT SELECT (claimed_user_id, claimed_at) ON public.invitation TO poly_app;--> statement-breakpoint
GRANT SELECT (id, signup_txid) ON public."user" TO poly_authz;--> statement-breakpoint
GRANT SELECT (self_user_id) ON public.entity TO poly_authz;--> statement-breakpoint
GRANT SELECT ON public.invitation TO poly_govern;--> statement-breakpoint
GRANT UPDATE (claimed_user_id, claimed_at, accepted_at) ON public.invitation TO poly_govern;--> statement-breakpoint
GRANT SELECT (id, email, email_verified, signup_txid) ON public."user" TO poly_govern;--> statement-breakpoint
GRANT UPDATE (signup_txid) ON public."user" TO poly_govern;--> statement-breakpoint

CREATE POLICY entity_authz_read ON public.entity FOR SELECT TO poly_authz USING (true);--> statement-breakpoint
CREATE POLICY invitation_govern_read ON public.invitation FOR SELECT TO poly_govern USING (true);--> statement-breakpoint
CREATE POLICY invitation_govern_update ON public.invitation FOR UPDATE TO poly_govern
  USING (true) WITH CHECK (claimed_user_id = app.current_user_id());--> statement-breakpoint
-- Viewers only (S6): beside membership_seat, which seats an owner for seat_creator.
CREATE POLICY membership_accept_viewer ON public.membership FOR INSERT TO poly_govern
  WITH CHECK (user_id = app.current_user_id() AND role = 'viewer');--> statement-breakpoint

GRANT CREATE ON SCHEMA app TO poly_authz, poly_govern;--> statement-breakpoint

SET ROLE poly_authz;--> statement-breakpoint

-- The step: the user was inserted by THIS transaction (the stamp, never xmin or a setting), nobody is signed in yet, and the
-- user has no Person. set_config(..., true) outlives the function and ends with the transaction.
CREATE FUNCTION app.enter_new_user(uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $$
  BEGIN
    IF app.current_user_id() IS NOT NULL THEN
      RAISE EXCEPTION 'a user is already in context' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public."user" u WHERE u.id = $1 AND u.signup_txid = pg_catalog.pg_current_xact_id()::pg_catalog.text::pg_catalog.int8) THEN
      RAISE EXCEPTION 'not a user created by this transaction' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.entity e WHERE e.self_user_id = $1) THEN
      RAISE EXCEPTION 'the user already has a Person' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_catalog.set_config('app.user_id', $1::pg_catalog.text, true);
  END
  $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.enter_new_user(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.enter_new_user(uuid) TO poly_app;--> statement-breakpoint

SET ROLE poly_govern;--> statement-breakpoint

-- Locks the live rows this sign-up may claim, in id order (one order for every caller, so no deadlock, S5). With a hash: the
-- one row for that token and email. With none: every live row for the email. No row: one refusal for every cause.
CREATE FUNCTION app.claim_invitations(bytea, text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  SET lock_timeout = '5s'
  AS $$
  BEGIN
    IF app.current_user_id() IS NOT NULL THEN
      RAISE EXCEPTION 'invitation_required' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.invitation i
    WHERE i.claimed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > pg_catalog.now()
      AND pg_catalog.lower(i.email) = pg_catalog.lower($2)
      AND ($1 IS NULL OR i.token_hash = $1)
    ORDER BY i.id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invitation_required' USING ERRCODE = '42501';
    END IF;
  END
  $$;--> statement-breakpoint
-- Binds the rows claim_invitations locked to the user this transaction inserted, seats viewers, clears the stamp, and returns
-- the newest seated entity (null: the user's own Person). The email comes from the user row, never from the caller.
CREATE FUNCTION app.accept_invitations(bytea) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  SET lock_timeout = '5s'
  AS $$
  DECLARE
    v_uid uuid := app.current_user_id();
    v_email text;
    v_verified boolean;
    r record;
    v_n int := 0;
  BEGIN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'no user in context' USING ERRCODE = '42501';
    END IF;
    SELECT u.email, u.email_verified INTO v_email, v_verified FROM public."user" u
    WHERE u.id = v_uid AND u.signup_txid = pg_catalog.pg_current_xact_id()::pg_catalog.text::pg_catalog.int8;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not a user created by this transaction' USING ERRCODE = '42501';
    END IF;
    IF $1 IS NULL AND NOT v_verified THEN
      RAISE EXCEPTION 'a verified email is required' USING ERRCODE = '42501';
    END IF;
    FOR r IN
      SELECT i.id, i.entity_id, i.role FROM public.invitation i
      WHERE i.claimed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > pg_catalog.now()
        AND pg_catalog.lower(i.email) = pg_catalog.lower(v_email)
        AND ($1 IS NULL OR i.token_hash = $1)
      ORDER BY i.id FOR UPDATE
    LOOP
      v_n := v_n + 1;
      IF r.entity_id IS NOT NULL AND r.role = 'viewer' THEN
        INSERT INTO public.membership (entity_id, user_id, role) VALUES (r.entity_id, v_uid, 'viewer')
        ON CONFLICT DO NOTHING;
      END IF;
      UPDATE public.invitation SET claimed_user_id = v_uid, claimed_at = pg_catalog.now(),
        accepted_at = CASE WHEN r.entity_id IS NULL OR r.role = 'viewer' THEN pg_catalog.now() END
      WHERE id = r.id;
    END LOOP;
    IF v_n = 0 THEN
      RAISE EXCEPTION 'invitation_required' USING ERRCODE = '42501';
    END IF;
    UPDATE public."user" SET signup_txid = NULL WHERE id = v_uid;
    RETURN (SELECT i.entity_id FROM public.invitation i
            WHERE i.claimed_user_id = v_uid AND i.accepted_at IS NOT NULL AND i.entity_id IS NOT NULL
            ORDER BY i.created_at DESC, i.id DESC LIMIT 1);
  END
  $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.claim_invitations(bytea, text), app.accept_invitations(bytea) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_invitations(bytea, text), app.accept_invitations(bytea) TO poly_app;--> statement-breakpoint

SET ROLE poly_owner;--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM poly_authz, poly_govern;--> statement-breakpoint

-- Invoker trigger functions.
-- The sign-up marker: the top-level transaction id (pg_current_xact_id is the same inside BetterAuth's savepoint), one user
-- per transaction. Overwrites whatever the INSERT supplied.
CREATE FUNCTION app.stamp_signup_user() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    v_tx pg_catalog.int8 := pg_catalog.pg_current_xact_id()::pg_catalog.text::pg_catalog.int8;
  BEGIN
    -- Only a poly_app insert is a sign-up. Any other role (superuser seeds, poly_worker, restores) gets a NULL stamp, so
    -- it neither counts toward one user per transaction nor trips signup_stamp_cleared at commit.
    IF current_user <> 'poly_app' THEN
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
-- Set once (S10): a non-null revoked_at, claimed_user_id, claimed_at or accepted_at never changes.
CREATE FUNCTION app.invitation_set_once() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
       OR (OLD.claimed_user_id IS NOT NULL AND NEW.claimed_user_id IS DISTINCT FROM OLD.claimed_user_id)
       OR (OLD.claimed_at IS NOT NULL AND NEW.claimed_at IS DISTINCT FROM OLD.claimed_at)
       OR (OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at) THEN
      RAISE EXCEPTION 'an invitation''s revocation, claim and acceptance are set once' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint
-- S13 (C32): no committed user row carries a stamp. Re-reads the row at commit, for every role.
CREATE FUNCTION app.signup_stamp_cleared() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM public."user" u WHERE u.id = NEW.id AND u.signup_txid IS NOT NULL) THEN
      RAISE EXCEPTION 'a sign-up must end by accepting its invitation' USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
  END
  $$;--> statement-breakpoint
CREATE TRIGGER user_10_stamp_signup BEFORE INSERT ON public."user"
  FOR EACH ROW EXECUTE FUNCTION app.stamp_signup_user();--> statement-breakpoint
CREATE TRIGGER invitation_20_set_once BEFORE UPDATE ON public.invitation
  FOR EACH ROW EXECUTE FUNCTION app.invitation_set_once();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER user_90_stamp_cleared AFTER INSERT OR UPDATE ON public."user"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.signup_stamp_cleared();
--> statement-breakpoint
-- S14 (C33): between the insert and the accept, the stamped user's email and verified flag cannot change, so the address
-- the claim matched is the address accept_invitations reads. Every other column passes, including the stamp's clearing.
CREATE FUNCTION app.signup_email_fixed() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF OLD.signup_txid IS NOT NULL
       AND (NEW.email IS DISTINCT FROM OLD.email OR NEW.email_verified IS DISTINCT FROM OLD.email_verified) THEN
      RAISE EXCEPTION 'a user''s email is fixed until its sign-up is accepted' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint
CREATE TRIGGER user_20_signup_email_fixed BEFORE UPDATE ON public."user"
  FOR EACH ROW EXECUTE FUNCTION app.signup_email_fixed();
