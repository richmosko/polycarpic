-- Custom migration (generate --custom). Runs as session_user poly_migrator with SET ROLE poly_owner active (src/migrate.ts).
-- POLY-149 (ruling R2, R3, R4, R6): the sign-in record, the growing second-step lock, the N1 fix to enter_session, reset_second_step's
-- streak delete. Order as R6.1: (1) record, (2) its triggers, (3) streak, (4) poly_govern definers, (5) purge, (6) enter_session,
-- (7) triggers on the BetterAuth tables. Ends on poly_owner. Nothing here revokes from poly_app (0017).

-- (1) R3: the append-only record. No foreign key (a row outlives its account until the purge); no login role holds a privilege.
CREATE TABLE app.sign_in_record (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('session', 'second_step_failure', 'second_step_lock')),
  user_id       uuid NOT NULL,
  session_id    uuid,
  created_at    timestamptz NOT NULL DEFAULT pg_catalog.now(),
  ip_address    text,
  user_agent    text,
  lock_minutes  integer CHECK ((kind = 'second_step_lock') = (lock_minutes IS NOT NULL)),
  CHECK ((kind = 'session') = (session_id IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX sign_in_record_user_created_idx ON app.sign_in_record (user_id, created_at);--> statement-breakpoint
CREATE INDEX sign_in_record_created_idx ON app.sign_in_record (created_at);--> statement-breakpoint
ALTER TABLE app.sign_in_record ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app.sign_in_record FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON app.sign_in_record FROM PUBLIC;--> statement-breakpoint
GRANT INSERT ON app.sign_in_record TO poly_govern;--> statement-breakpoint
GRANT SELECT (user_id, created_at), DELETE ON app.sign_in_record TO poly_purge;--> statement-breakpoint
GRANT SELECT (id) ON public."user" TO poly_purge;--> statement-breakpoint
CREATE POLICY sign_in_record_append ON app.sign_in_record FOR INSERT TO poly_govern WITH CHECK (true);--> statement-breakpoint
CREATE POLICY sign_in_record_purge_read ON app.sign_in_record FOR SELECT TO poly_purge USING (true);--> statement-breakpoint
CREATE POLICY sign_in_record_purge ON app.sign_in_record FOR DELETE TO poly_purge USING (true);--> statement-breakpoint

-- (2) UPDATE always raises; DELETE only for the purge role on a purgeable row. An invoker, so current_user is the deleting role.
-- It binds the owner and superuser too.
CREATE FUNCTION app.sign_in_record_immutable() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $fn$
  BEGIN
    -- The statement-level trigger refuses before any row is visited: with RLS forced the owner sees no row (no policy names it), so a
    -- row trigger alone would let its UPDATE and DELETE pass as no-ops. Only the purge role's DELETE gets to the row check.
    IF TG_LEVEL = 'STATEMENT' THEN
      IF TG_OP = 'DELETE' AND current_user = 'poly_purge' THEN
        RETURN NULL;
      END IF;
      RAISE EXCEPTION 'the sign-in record is append-only' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' AND current_user = 'poly_purge'
       AND (OLD.created_at < pg_catalog.now() - interval '400 days'
            OR NOT EXISTS (SELECT 1 FROM public."user" u WHERE u.id = OLD.user_id)) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'the sign-in record is append-only' USING ERRCODE = '42501';
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.sign_in_record_immutable() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER sign_in_record_05_refuse BEFORE UPDATE OR DELETE ON app.sign_in_record
  FOR EACH STATEMENT EXECUTE FUNCTION app.sign_in_record_immutable();--> statement-breakpoint
CREATE TRIGGER sign_in_record_10_immutable BEFORE UPDATE OR DELETE ON app.sign_in_record
  FOR EACH ROW EXECUTE FUNCTION app.sign_in_record_immutable();--> statement-breakpoint
CREATE TRIGGER sign_in_record_no_truncate BEFORE TRUNCATE ON app.sign_in_record FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint

-- (3) R2: the doubling's state, keyed by user (a user has one factor row, and deleting and re-enrolling it must not reset it).
-- Only poly_govern. The cascade from user is safe: no login role can delete a user (pinned in pgTAP 12).
CREATE TABLE app.second_step_streak (
  user_id     uuid PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  locks       integer NOT NULL DEFAULT 0 CHECK (locks >= 0),
  updated_at  timestamptz NOT NULL DEFAULT pg_catalog.now()
);--> statement-breakpoint
ALTER TABLE app.second_step_streak ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app.second_step_streak FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON app.second_step_streak FROM PUBLIC;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.second_step_streak TO poly_govern;--> statement-breakpoint
CREATE POLICY second_step_streak_govern ON app.second_step_streak FOR ALL TO poly_govern USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE TRIGGER second_step_streak_no_truncate BEFORE TRUNCATE ON app.second_step_streak FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint

-- (4) The poly_govern functions. A definer owner needs CREATE on its schema only for the duration of the file.
GRANT CREATE ON SCHEMA app TO poly_govern, poly_purge, poly_authz;--> statement-breakpoint
SET ROLE poly_govern;--> statement-breakpoint

-- Addendum 4: one rule for the address on every record row: kept as given when it is an inet (so at most 45 characters), else NULL.
-- An invoker and immutable; only the two poly_govern definers below call it.
CREATE FUNCTION app.sign_in_address(p_value text) RETURNS text
  LANGUAGE sql IMMUTABLE
  SET search_path = ''
  AS $fn$ SELECT CASE WHEN p_value IS NOT NULL AND pg_catalog.pg_input_is_valid(p_value, 'inet') THEN p_value END $fn$;--> statement-breakpoint

-- R3: one row per committed session insert, from NEW only. created_at is the database clock; nothing is passed by a caller.
CREATE FUNCTION app.record_session_sign_in() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    INSERT INTO app.sign_in_record (kind, user_id, session_id, ip_address, user_agent)
    VALUES ('session', NEW.user_id, NEW.id, app.sign_in_address(NEW.ip_address), pg_catalog.left(NEW.user_agent, 512));
    RETURN NULL;
  END
  $fn$;--> statement-breakpoint

-- R2: the lock guard. Reads only clock_timestamp(); no role is exempt. The address and browser on a second-step row are the
-- sign-in service's word (two transaction settings); the address is kept only if it is an inet (app.sign_in_address).
CREATE FUNCTION app.guard_second_step_lock() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    t timestamptz := pg_catalog.clock_timestamp();
    n integer;
    len integer;
    v_ip text;
    v_ua text;
    v_old integer := coalesce(OLD.failed_verification_count, 0);
    v_new integer := coalesce(NEW.failed_verification_count, 0);
  BEGIN
    -- 1. A lock in force: nothing shortens, clears, extends or replaces it, and nothing lowers its count.
    IF OLD.locked_until > t THEN
      IF NEW.locked_until IS DISTINCT FROM OLD.locked_until OR v_new < v_old THEN
        RAISE EXCEPTION 'second_step_locked' USING ERRCODE = '42501';
      END IF;
    END IF;
    v_ip := app.sign_in_address(nullif(pg_catalog.current_setting('poly.client_ip', true), ''));
    v_ua := pg_catalog.left(nullif(pg_catalog.current_setting('poly.user_agent', true), ''), 512);
    -- 3. A new lock: the length is ours, whatever was sent.
    IF NEW.locked_until IS NOT NULL AND NEW.locked_until IS DISTINCT FROM OLD.locked_until THEN
      INSERT INTO app.second_step_streak (user_id, locks) VALUES (NEW.user_id, 0) ON CONFLICT (user_id) DO NOTHING;
      SELECT s.locks INTO n FROM app.second_step_streak s WHERE s.user_id = NEW.user_id FOR UPDATE;
      len := LEAST(15 * (1 << LEAST(n, 7)), 1440);
      NEW.locked_until := t + len * interval '1 minute';
      UPDATE app.second_step_streak s SET locks = n + 1, updated_at = pg_catalog.now() WHERE s.user_id = NEW.user_id;
      INSERT INTO app.sign_in_record (kind, user_id, ip_address, user_agent, lock_minutes)
      VALUES ('second_step_lock', NEW.user_id, v_ip, v_ua, len);
    -- 4. The correct-code reset: the shape of the library's reset write on an unlocked row. A lapse's lazy clear has a non-NULL old value.
    ELSIF OLD.locked_until IS NULL AND NEW.locked_until IS NULL AND NEW.failed_verification_count = 0 THEN
      UPDATE app.second_step_streak s SET locks = 0, updated_at = pg_catalog.now() WHERE s.user_id = NEW.user_id AND s.locks <> 0;
    END IF;
    -- 5. A counted failure.
    IF v_new > v_old THEN
      INSERT INTO app.sign_in_record (kind, user_id, ip_address, user_agent)
      VALUES ('second_step_failure', NEW.user_id, v_ip, v_ua);
    END IF;
    RETURN NEW;
  END
  $fn$;--> statement-breakpoint

-- R2: the factor row cannot be deleted during a lock except by reset_second_step (poly_govern). An invoker: current_user is the deleter.
CREATE FUNCTION app.guard_second_step_lock_delete() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $fn$
  BEGIN
    IF OLD.locked_until > pg_catalog.clock_timestamp() AND current_user <> 'poly_govern' THEN
      RAISE EXCEPTION 'second_step_locked' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END
  $fn$;--> statement-breakpoint

-- The operator's reset (0013), plus the streak: the only path that clears the doubling.
CREATE OR REPLACE FUNCTION app.reset_second_step(p_email text) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_user uuid;
    v_n bigint;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.reset_second_step($1)' THEN
      RAISE EXCEPTION 'a second-step definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF app.current_user_id() IS NOT NULL THEN
      RAISE EXCEPTION 'the reset is issued without a user in context' USING ERRCODE = '42501';
    END IF;
    -- user_email_unique is case-sensitive, so two rows can match: which one is reset would be undefined. Refuse, reset neither.
    SELECT pg_catalog.count(*) INTO v_n FROM public."user" u WHERE pg_catalog.lower(u.email) = pg_catalog.lower(p_email);
    IF v_n = 0 THEN
      RAISE EXCEPTION 'no such user' USING ERRCODE = 'P0002';
    ELSIF v_n > 1 THEN
      RAISE EXCEPTION 'more than one user matches' USING ERRCODE = '21000';
    END IF;
    SELECT u.id INTO v_user FROM public."user" u WHERE pg_catalog.lower(u.email) = pg_catalog.lower(p_email) FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no such user' USING ERRCODE = 'P0002';
    END IF;
    DELETE FROM public.two_factor WHERE user_id = v_user;
    DELETE FROM app.second_step_streak WHERE user_id = v_user;
    DELETE FROM public.passkey WHERE user_id = v_user;
    UPDATE public."user" SET two_factor_enabled = false WHERE id = v_user;
    DELETE FROM app.email_challenge WHERE user_id = v_user;
    DELETE FROM app.enrolment_grant WHERE user_id = v_user;
    DELETE FROM public.session WHERE user_id = v_user;
    DELETE FROM public.verification WHERE value = v_user::pg_catalog.text;
    INSERT INTO public.audit_event (entity_id, actor_user_id, actor, kind, subject_user_id, payload)
    VALUES (NULL, NULL, 'operator', 'second_step.reset', v_user, '{}'::pg_catalog.jsonb);
    INSERT INTO public.notification (recipient_user_id, kind, payload) VALUES (v_user, 'second_step.reset', '{}'::pg_catalog.jsonb);
    RETURN true;
  END
  $fn$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.sign_in_address(text) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.record_session_sign_in(), app.guard_second_step_lock(), app.guard_second_step_lock_delete() FROM PUBLIC;--> statement-breakpoint
-- CREATE TRIGGER checks EXECUTE for the creator (poly_owner, step 7); dropped again there.
GRANT EXECUTE ON FUNCTION app.record_session_sign_in(), app.guard_second_step_lock(), app.guard_second_step_lock_delete() TO poly_owner;--> statement-breakpoint

-- (5) R3: the only delete path of the record. The caller passes nothing.
SET ROLE poly_purge;--> statement-breakpoint
CREATE FUNCTION app.purge_sign_in_record() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_n integer;
  BEGIN
    DELETE FROM app.sign_in_record r
      WHERE r.created_at < pg_catalog.now() - interval '400 days'
         OR NOT EXISTS (SELECT 1 FROM public."user" u WHERE u.id = r.user_id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.purge_sign_in_record() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.purge_sign_in_record() TO poly_worker;--> statement-breakpoint

-- (6) R4 (N1): the slide writes only when the expiry moves forward.
SET ROLE poly_authz;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.enter_session(p_handle text)
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
    v_new timestamptz;
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
    -- The slide (POLY-152 R7): at most once a day, never past the 30-day cap, and only when the expiry moves forward (N1, Addendum 2).
    -- After the marker insert, so the first-write check holds.
    IF v_expires <= pg_catalog.now() + interval '6 days' THEN
      v_new := LEAST(pg_catalog.now() + interval '7 days', v_created + interval '30 days');
      -- Addendum 2: non-blocking and at most one write. The locked row's own expiry is compared (not the one read above), and a row
      -- another transaction is sliding is skipped: this entry returns the expiry it read.
      UPDATE public.session s SET expires_at = v_new, updated_at = pg_catalog.now()
        WHERE s.id = (SELECT s2.id FROM public.session s2 WHERE s2.id = v_session AND s2.expires_at < v_new FOR UPDATE SKIP LOCKED);
      IF FOUND THEN
        v_expires := v_new;
      END IF;
    END IF;
    RETURN QUERY SELECT pg_catalog.pg_current_xact_id()::pg_catalog.text, v_user, v_session, v_name, v_image, v_expires;
  END
  $fn$;--> statement-breakpoint

-- (7) The triggers, on the tables' owner.
SET ROLE poly_owner;--> statement-breakpoint
CREATE TRIGGER session_80_sign_in_record AFTER INSERT ON public.session
  FOR EACH ROW EXECUTE FUNCTION app.record_session_sign_in();--> statement-breakpoint
CREATE TRIGGER two_factor_15_lock BEFORE UPDATE OF failed_verification_count, locked_until ON public.two_factor
  FOR EACH ROW EXECUTE FUNCTION app.guard_second_step_lock();--> statement-breakpoint
CREATE TRIGGER two_factor_16_lock_delete BEFORE DELETE ON public.two_factor
  FOR EACH ROW EXECUTE FUNCTION app.guard_second_step_lock_delete();--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM poly_govern, poly_purge, poly_authz;--> statement-breakpoint
SET ROLE poly_govern;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.record_session_sign_in(), app.guard_second_step_lock(), app.guard_second_step_lock_delete() FROM poly_owner;--> statement-breakpoint
SET ROLE poly_owner;
