-- Custom migration (generate --custom). Runs as session_user poly_migrator with SET ROLE poly_owner active (src/migrate.ts).
-- POLY-150i (ruling Addendum 3, A3 to A5): Confirm it's you. One writer of session.recent_auth_at for an enrolled user (complete_step_up),
-- a challenge row per begin, a forward-only TOTP step per user, and the step_up record rows. D7 (b) is decided: a backup code is accepted,
-- so A3.3's write order and its evidence (step_up_pending, two triggers) are here. The database also writes an audit event for every
-- second-step method added or removed (DECISIONS 2026-11-19). Order as A5: (1) tables, (2) the record's kind and method,
-- (3) poly_govern definers, (4) triggers. Ends on poly_owner.

-- (1) The challenge: one open row per session, hashed WebAuthn challenge for the passkey method only. No login role holds a privilege.
CREATE TABLE app.step_up_challenge (
  id            uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  session_id    uuid NOT NULL REFERENCES public.session(id) ON DELETE CASCADE,
  method        text NOT NULL CHECK (method IN ('totp', 'backup_code', 'passkey')),
  webauthn_hash bytea CHECK (pg_catalog.octet_length(webauthn_hash) = 32),
  created_at    timestamptz NOT NULL DEFAULT pg_catalog.now(),
  expires_at    timestamptz NOT NULL,
  CHECK ((method = 'passkey') = (webauthn_hash IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX step_up_challenge_session_idx ON app.step_up_challenge (session_id);--> statement-breakpoint
CREATE INDEX step_up_challenge_user_idx ON app.step_up_challenge (user_id);--> statement-breakpoint
ALTER TABLE app.step_up_challenge ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app.step_up_challenge FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON app.step_up_challenge FROM PUBLIC;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON app.step_up_challenge TO poly_govern;--> statement-breakpoint
CREATE POLICY step_up_challenge_read ON app.step_up_challenge FOR SELECT TO poly_govern USING (true);--> statement-breakpoint
CREATE POLICY step_up_challenge_insert ON app.step_up_challenge FOR INSERT TO poly_govern WITH CHECK (true);--> statement-breakpoint
CREATE POLICY step_up_challenge_delete ON app.step_up_challenge FOR DELETE TO poly_govern USING (true);--> statement-breakpoint
CREATE TRIGGER step_up_challenge_no_truncate BEFORE TRUNCATE ON app.step_up_challenge FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint

-- The last TOTP step a user has spent, at sign-in or at a re-check. Forward-only for every role.
CREATE TABLE app.step_up_totp (
  user_id   uuid PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  last_step bigint NOT NULL
);--> statement-breakpoint
ALTER TABLE app.step_up_totp ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app.step_up_totp FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON app.step_up_totp FROM PUBLIC;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.step_up_totp TO poly_govern;--> statement-breakpoint
CREATE POLICY step_up_totp_read ON app.step_up_totp FOR SELECT TO poly_govern USING (true);--> statement-breakpoint
CREATE POLICY step_up_totp_insert ON app.step_up_totp FOR INSERT TO poly_govern WITH CHECK (true);--> statement-breakpoint
CREATE POLICY step_up_totp_update ON app.step_up_totp FOR UPDATE TO poly_govern USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE TRIGGER step_up_totp_no_truncate BEFORE TRUNCATE ON app.step_up_totp FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint
CREATE FUNCTION app.step_up_totp_forward() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $fn$
  BEGIN
    IF NEW.last_step < OLD.last_step THEN
      RAISE EXCEPTION 'a spent TOTP step never goes back' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.step_up_totp_forward() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER step_up_totp_10_forward BEFORE UPDATE ON app.step_up_totp
  FOR EACH ROW EXECUTE FUNCTION app.step_up_totp_forward();--> statement-breakpoint

-- A3.3: the evidence that a backup-code stamp was followed by the list write, in the same transaction.
CREATE TABLE app.step_up_pending (
  xid     xid8 PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE
);--> statement-breakpoint
ALTER TABLE app.step_up_pending ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app.step_up_pending FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON app.step_up_pending FROM PUBLIC;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON app.step_up_pending TO poly_govern;--> statement-breakpoint
CREATE POLICY step_up_pending_read ON app.step_up_pending FOR SELECT TO poly_govern USING (true);--> statement-breakpoint
CREATE POLICY step_up_pending_insert ON app.step_up_pending FOR INSERT TO poly_govern WITH CHECK (true);--> statement-breakpoint
CREATE POLICY step_up_pending_delete ON app.step_up_pending FOR DELETE TO poly_govern USING (true);--> statement-breakpoint
CREATE TRIGGER step_up_pending_no_truncate BEFORE TRUNCATE ON app.step_up_pending FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint

-- (2) The record gains the re-check's two kinds and the method. A step_up row carries its session; a step_up_failure does not need one.
DO $do$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT con.conname FROM pg_catalog.pg_constraint con
            WHERE con.conrelid = 'app.sign_in_record'::pg_catalog.regclass AND con.contype = 'c'
              AND pg_catalog.pg_get_constraintdef(con.oid) ~ '(kind = ANY|session_id IS NOT NULL)'
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE app.sign_in_record DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$do$;--> statement-breakpoint
ALTER TABLE app.sign_in_record ADD COLUMN method text;--> statement-breakpoint
ALTER TABLE app.sign_in_record ADD CONSTRAINT sign_in_record_kind_check
  CHECK (kind IN ('session', 'second_step_failure', 'second_step_lock', 'step_up', 'step_up_failure'));--> statement-breakpoint
ALTER TABLE app.sign_in_record ADD CONSTRAINT sign_in_record_session_id_check
  CHECK ((kind IN ('session', 'step_up')) = (session_id IS NOT NULL) OR kind = 'step_up_failure');--> statement-breakpoint
ALTER TABLE app.sign_in_record ADD CONSTRAINT sign_in_record_method_check
  CHECK ((kind IN ('step_up', 'step_up_failure')) = (method IS NOT NULL) AND (method IS NULL OR method IN ('totp', 'backup_code', 'passkey')));--> statement-breakpoint

-- (3) The poly_govern definers.
GRANT CREATE ON SCHEMA app TO poly_govern;--> statement-breakpoint
SET ROLE poly_govern;--> statement-breakpoint

-- A3.1: the challenge. The marker is kind 'auth' and names the session; nothing is passed that names a user or a session.
CREATE FUNCTION app.begin_step_up(p_method text, p_webauthn_hash bytea) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_uid uuid;
    v_sid uuid;
    v_id uuid;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.begin_step_up($1, $2)' THEN
      RAISE EXCEPTION 'a step-up definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned() AND t.kind = 'auth') THEN
      RAISE EXCEPTION 'an auth marker is required' USING ERRCODE = '42501';
    END IF;
    v_uid := app.current_user_id();
    v_sid := app.current_session_id();
    IF v_uid IS NULL OR v_sid IS NULL THEN
      RAISE EXCEPTION 'no user in context' USING ERRCODE = '42501';
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('totp', 'backup_code', 'passkey') THEN
      RAISE EXCEPTION 'unknown method' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public."user" u WHERE u.id = v_uid AND u.second_step_at IS NOT NULL) THEN
      RAISE EXCEPTION 'no second step' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.session s WHERE s.id = v_sid AND s.user_id = v_uid) THEN
      RAISE EXCEPTION 'no such session' USING ERRCODE = '42501';
    END IF;
    IF p_method IN ('totp', 'backup_code') AND (p_webauthn_hash IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.two_factor t WHERE t.user_id = v_uid AND t.verified)) THEN
      RAISE EXCEPTION 'no authenticator app' USING ERRCODE = '42501';
    END IF;
    IF p_method = 'passkey' AND (p_webauthn_hash IS NULL OR pg_catalog.octet_length(p_webauthn_hash) <> 32
                                 OR NOT EXISTS (SELECT 1 FROM public.passkey k WHERE k.user_id = v_uid)) THEN
      RAISE EXCEPTION 'no passkey' USING ERRCODE = '42501';
    END IF;
    DELETE FROM app.step_up_challenge c WHERE c.session_id = v_sid;
    INSERT INTO app.step_up_challenge (user_id, session_id, method, webauthn_hash, expires_at)
    VALUES (v_uid, v_sid, p_method, p_webauthn_hash, pg_catalog.now() + interval '5 minutes')
    RETURNING id INTO v_id;
    RETURN v_id;
  END
  $fn$;--> statement-breakpoint

-- A3.2: the one new writer of recent_auth_at. The stamp is the service's word that a factor was checked; the database checks the
-- challenge, the lock, the step, and writes the record row in the same transaction. now(), not clock_timestamp(): step_up_fresh()
-- reads recent_auth_at <= now().
CREATE FUNCTION app.complete_step_up(p_method text, p_challenge uuid, p_step bigint) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_uid uuid;
    v_sid uuid;
    v_now_step bigint := pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp()) / 30)::bigint;
    v_last bigint;
    v_n integer;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.complete_step_up($1, $2, $3)' THEN
      RAISE EXCEPTION 'a step-up definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned() AND t.kind = 'auth') THEN
      RAISE EXCEPTION 'an auth marker is required' USING ERRCODE = '42501';
    END IF;
    v_uid := app.current_user_id();
    v_sid := app.current_session_id();
    IF v_uid IS NULL OR v_sid IS NULL THEN
      RAISE EXCEPTION 'no user in context' USING ERRCODE = '42501';
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('totp', 'backup_code', 'passkey') THEN
      RAISE EXCEPTION 'unknown method' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public."user" u WHERE u.id = v_uid AND u.second_step_at IS NOT NULL) THEN
      RAISE EXCEPTION 'step_up_refused' USING ERRCODE = '42501';
    END IF;
    -- No earlier stamp in this transaction: now() is the transaction's start, so a stamp made here reads as equal to it.
    IF EXISTS (SELECT 1 FROM public.session s WHERE s.id = v_sid AND s.recent_auth_at = pg_catalog.now()) THEN
      RAISE EXCEPTION 'step_up_refused' USING ERRCODE = '42501';
    END IF;
    -- The challenge: this user's, this session's, this method's, unexpired. It is spent by being read.
    DELETE FROM app.step_up_challenge c
      WHERE c.id = p_challenge AND c.user_id = v_uid AND c.session_id = v_sid AND c.method = p_method AND c.expires_at > pg_catalog.now();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'step_up_challenge' USING ERRCODE = '42501';
    END IF;
    IF p_method IN ('totp', 'backup_code') AND EXISTS (SELECT 1 FROM public.two_factor t WHERE t.user_id = v_uid AND t.verified AND t.locked_until > pg_catalog.clock_timestamp()) THEN
      RAISE EXCEPTION 'step_up_refused' USING ERRCODE = '42501';
    END IF;
    IF p_method = 'backup_code' THEN
      -- A3.3: the stamp comes first, then the list is written (guard #5 wants the fresh stamp). If the list is never written,
      -- step_up_pending_resolved raises at commit and the stamp rolls back with it.
      INSERT INTO app.step_up_pending (xid, user_id) VALUES (pg_catalog.pg_current_xact_id(), v_uid);
    ELSIF p_method = 'totp' THEN
      IF p_step IS NULL OR p_step < v_now_step - 1 OR p_step > v_now_step + 1 THEN
        RAISE EXCEPTION 'step_up_refused' USING ERRCODE = '42501';
      END IF;
      SELECT s.last_step INTO v_last FROM app.step_up_totp s WHERE s.user_id = v_uid FOR UPDATE;
      IF FOUND THEN
        IF p_step <= v_last THEN
          RAISE EXCEPTION 'step_up_refused' USING ERRCODE = '42501';
        END IF;
        UPDATE app.step_up_totp s SET last_step = p_step WHERE s.user_id = v_uid;
      ELSE
        INSERT INTO app.step_up_totp (user_id, last_step) VALUES (v_uid, p_step);
      END IF;
    END IF;
    UPDATE public.session s SET recent_auth_at = pg_catalog.now() WHERE s.id = v_sid AND s.user_id = v_uid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'step_up_refused' USING ERRCODE = '42501';
    END IF;
    INSERT INTO app.sign_in_record (kind, user_id, session_id, method, ip_address, user_agent)
    VALUES ('step_up', v_uid, v_sid, p_method,
            app.sign_in_address(nullif(pg_catalog.current_setting('poly.client_ip', true), '')),
            pg_catalog.left(nullif(pg_catalog.current_setting('poly.user_agent', true), ''), 512));
    RETURN true;
  END
  $fn$;--> statement-breakpoint

-- A3.4: a TOTP code accepted at sign-in or at first enrolment is spent for re-checks too. It can only move the step forward, and
-- only within now() +- 1, so SQL as poly_auth gains at worst the refusal of one honest re-check for 30 seconds.
CREATE FUNCTION app.note_totp_step(p_user uuid, p_step bigint) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_now_step bigint := pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp()) / 30)::bigint;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.note_totp_step($1, $2)' THEN
      RAISE EXCEPTION 'a step-up definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF p_user IS NULL OR p_step IS NULL OR p_step < v_now_step - 1 OR p_step > v_now_step + 1 THEN
      RAISE EXCEPTION 'a TOTP step outside the window' USING ERRCODE = '42501';
    END IF;
    INSERT INTO app.step_up_totp (user_id, last_step) VALUES (p_user, p_step)
      ON CONFLICT (user_id) DO UPDATE SET last_step = GREATEST(app.step_up_totp.last_step, EXCLUDED.last_step);
  END
  $fn$;--> statement-breakpoint

-- A4: a failed passkey assertion has no counter to record it, so the service says so. The row is the service's word; a forger gains nothing.
CREATE FUNCTION app.record_step_up_failure() RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.record_step_up_failure()' THEN
      RAISE EXCEPTION 'a step-up definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned() AND t.kind = 'auth') THEN
      RAISE EXCEPTION 'an auth marker is required' USING ERRCODE = '42501';
    END IF;
    IF app.current_user_id() IS NULL THEN
      RAISE EXCEPTION 'no user in context' USING ERRCODE = '42501';
    END IF;
    -- A failed assertion spends the session's open challenge: the next attempt begins again.
    DELETE FROM app.step_up_challenge c WHERE c.session_id = app.current_session_id() AND c.user_id = app.current_user_id();
    INSERT INTO app.sign_in_record (kind, user_id, session_id, method, ip_address, user_agent)
    VALUES ('step_up_failure', app.current_user_id(), app.current_session_id(), 'passkey',
            app.sign_in_address(nullif(pg_catalog.current_setting('poly.client_ip', true), '')),
            pg_catalog.left(nullif(pg_catalog.current_setting('poly.user_agent', true), ''), 512));
  END
  $fn$;--> statement-breakpoint

-- The service verifies a passkey assertion against the hash it handed begin_step_up, and it keeps no state between the two requests.
-- This returns only that hash (never a preimage), for this user's and this session's own open passkey challenge.
CREATE FUNCTION app.step_up_challenge_hash(p_challenge uuid) RETURNS bytea
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.step_up_challenge_hash($1)' THEN
      RAISE EXCEPTION 'a step-up definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned() AND t.kind = 'auth') THEN
      RAISE EXCEPTION 'an auth marker is required' USING ERRCODE = '42501';
    END IF;
    RETURN (SELECT c.webauthn_hash FROM app.step_up_challenge c
             WHERE c.id = p_challenge AND c.user_id = app.current_user_id() AND c.session_id = app.current_session_id()
               AND c.method = 'passkey' AND c.expires_at > pg_catalog.now());
  END
  $fn$;--> statement-breakpoint

-- A3.3: the list write resolves the evidence; a stamp with no list write fails at commit.
CREATE FUNCTION app.step_up_spent() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    IF OLD.backup_codes IS DISTINCT FROM NEW.backup_codes THEN
      DELETE FROM app.step_up_pending p WHERE p.xid = pg_catalog.pg_current_xact_id();
    END IF;
    RETURN NULL;
  END
  $fn$;--> statement-breakpoint
CREATE FUNCTION app.step_up_pending_resolved() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    IF EXISTS (SELECT 1 FROM app.step_up_pending p WHERE p.xid = NEW.xid) THEN
      RAISE EXCEPTION 'step_up_unresolved: a backup-code re-check must spend the code' USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
  END
  $fn$;--> statement-breakpoint

-- Addendum 5 (RC5 c): every second-step method added or removed is an audit event, written by the database whichever role or path made
-- the change, so a planted factor is on the record. Actor: the marker's user; the operator (reset-mfa); else the system.
CREATE OR REPLACE FUNCTION app.sync_second_step() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_user uuid := CASE TG_OP WHEN 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
    v_has boolean;
    v_set boolean;
    v_event text;
    v_marker uuid := app.current_user_id();
    v_kind text;
  BEGIN
    IF v_marker IS NOT NULL AND v_user IS DISTINCT FROM v_marker THEN
      RAISE EXCEPTION 'a second step belongs to its own user' USING ERRCODE = '42501';
    END IF;
    -- A passkey row has no `verified`; the two tables are told apart before either record is read.
    IF TG_TABLE_NAME = 'passkey' THEN
      v_event := CASE TG_OP WHEN 'INSERT' THEN 'second_step.method_added' WHEN 'DELETE' THEN 'second_step.method_removed' END;
    ELSIF TG_OP = 'INSERT' THEN
      IF NEW.verified THEN v_event := 'second_step.method_added'; END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.verified AND NOT OLD.verified THEN v_event := 'second_step.method_added'; END IF;
    ELSIF OLD.verified THEN
      v_event := 'second_step.method_removed';
    END IF;
    IF v_event IS NOT NULL THEN
      SELECT t.kind INTO v_kind FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned();
      INSERT INTO public.audit_event (entity_id, actor_user_id, actor, kind, subject_user_id, payload)
      VALUES (NULL, v_marker,
              CASE WHEN v_marker IS NOT NULL THEN 'user' WHEN session_user = 'poly_operator' THEN 'operator' ELSE 'system' END,
              v_event, v_user,
              pg_catalog.jsonb_build_object(
                'method', CASE TG_TABLE_NAME WHEN 'passkey' THEN 'passkey' ELSE 'totp' END,
                'passkey_id', CASE WHEN TG_TABLE_NAME = 'passkey' THEN CASE TG_OP WHEN 'DELETE' THEN OLD.id ELSE NEW.id END END,
                'session_id', app.current_session_id(),
                'marker_kind', v_kind));
    END IF;
    v_has := EXISTS (SELECT 1 FROM public.two_factor t WHERE t.user_id = v_user AND t.verified)
          OR EXISTS (SELECT 1 FROM public.passkey k WHERE k.user_id = v_user);
    SELECT u.second_step_at IS NOT NULL INTO v_set FROM public."user" u WHERE u.id = v_user;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    IF v_has AND NOT v_set THEN
      UPDATE public."user" SET second_step_at = pg_catalog.now() WHERE id = v_user;
      PERFORM app.seat_claimed_invitations();
    ELSIF NOT v_has AND v_set THEN
      UPDATE public."user" SET second_step_at = NULL WHERE id = v_user;
    END IF;
    RETURN NULL;
  END
  $fn$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.begin_step_up(text, bytea), app.complete_step_up(text, uuid, bigint), app.note_totp_step(uuid, bigint), app.record_step_up_failure(), app.step_up_challenge_hash(uuid), app.step_up_spent(), app.step_up_pending_resolved() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.step_up_spent(), app.step_up_pending_resolved() TO poly_owner;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.begin_step_up(text, bytea), app.complete_step_up(text, uuid, bigint), app.note_totp_step(uuid, bigint), app.record_step_up_failure(), app.step_up_challenge_hash(uuid) TO poly_auth;--> statement-breakpoint

-- (4) Back to poly_owner: guard_passkey is replaced, and no trigger is added to a BetterAuth table.
SET ROLE poly_owner;--> statement-breakpoint
CREATE TRIGGER two_factor_no_truncate BEFORE TRUNCATE ON public.two_factor FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint
CREATE TRIGGER passkey_no_truncate BEFORE TRUNCATE ON public.passkey FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint
CREATE TRIGGER two_factor_85_step_up_spent AFTER UPDATE OF backup_codes ON public.two_factor
  FOR EACH ROW EXECUTE FUNCTION app.step_up_spent();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER step_up_pending_resolved AFTER INSERT ON app.step_up_pending
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.step_up_pending_resolved();--> statement-breakpoint
SET ROLE poly_govern;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.step_up_spent(), app.step_up_pending_resolved() FROM poly_owner;--> statement-breakpoint
SET ROLE poly_owner;--> statement-breakpoint
-- A3.5 (guard_passkey is poly_owner's, 0013): a marked counter change, like an unmarked one, never goes down. A constant 0 still passes. Otherwise 0013's body.
CREATE OR REPLACE FUNCTION app.guard_passkey() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    v_uid uuid := app.current_user_id();
  BEGIN
    IF current_user = 'poly_govern' OR (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
                             OR NEW.public_key IS DISTINCT FROM OLD.public_key OR NEW.credential_id IS DISTINCT FROM OLD.credential_id
                             OR NEW.device_type IS DISTINCT FROM OLD.device_type OR NEW.backed_up IS DISTINCT FROM OLD.backed_up
                             OR NEW.transports IS DISTINCT FROM OLD.transports OR NEW.created_at IS DISTINCT FROM OLD.created_at
                             OR NEW.aaguid IS DISTINCT FROM OLD.aaguid) THEN
      RAISE EXCEPTION 'a passkey''s key material never changes' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.counter < OLD.counter THEN
      RAISE EXCEPTION 'a passkey''s counter never goes down' USING ERRCODE = '42501';
    END IF;
    IF v_uid IS NULL THEN
      -- Passkey sign-in: the counter, and it never goes down (a constant 0 passes).
      IF TG_OP = 'INSERT' OR NEW.name IS DISTINCT FROM OLD.name THEN
        RAISE EXCEPTION 'a passkey is written under a user' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.user_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'a passkey belongs to its own user' USING ERRCODE = '42501';
      END IF;
      PERFORM app.consume_passkey_grant();
      RETURN NEW;
    END IF;
    IF OLD.user_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'a passkey belongs to its own user' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint

-- A factor's deletion (0013's body): the kind is chosen by table before any row field is read, because a passkey row has no `verified`.
CREATE OR REPLACE FUNCTION app.refuse_last_method() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    v_kind text;
  BEGIN
    IF current_user = 'poly_govern' OR (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
      RETURN OLD;
    END IF;
    IF TG_TABLE_NAME = 'passkey' THEN
      v_kind := 'passkey';
    ELSIF OLD.verified THEN
      v_kind := 'two_factor';
    ELSE
      v_kind := 'two_factor_unverified';
    END IF;
    PERFORM app.check_factor_removal(OLD.user_id, v_kind, OLD.id);
    RETURN OLD;
  END
  $$;--> statement-breakpoint

REVOKE CREATE ON SCHEMA app FROM poly_govern;
