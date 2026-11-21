-- Custom migration (generate --custom). Runs as session_user poly_migrator with SET ROLE poly_owner active (src/migrate.ts).
-- POLY-137 (ruling R3, R5, R9, decisions D1, D2, D4): the 24-hour hold on a method added after the first, the emails the database writes
-- through an outbox, the cancel link's definer, the worker's mail definers, and the three notice triggers. Order as R9.1:
-- (1) row-level security and grants, (2) poly_govern definers, (3) poly_purge's purge, (4) poly_owner's invoker trigger functions and triggers.
-- No login role gains a privilege on any table. Ends on poly_owner, with CREATE on app revoked.

-- (1) The two tables: forced RLS, policies for poly_govern (and poly_purge on the outbox), no TRUNCATE, no grant to a login role.
ALTER TABLE app.method_hold ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app.method_hold FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app.mail_outbox ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app.mail_outbox FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON app.method_hold, app.mail_outbox FROM PUBLIC;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.method_hold, app.mail_outbox TO poly_govern;--> statement-breakpoint
GRANT SELECT, DELETE ON app.mail_outbox TO poly_purge;--> statement-breakpoint
CREATE POLICY method_hold_govern_select ON app.method_hold FOR SELECT TO poly_govern USING (true);--> statement-breakpoint
CREATE POLICY method_hold_govern_insert ON app.method_hold FOR INSERT TO poly_govern WITH CHECK (true);--> statement-breakpoint
CREATE POLICY method_hold_govern_update ON app.method_hold FOR UPDATE TO poly_govern USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY mail_outbox_govern_select ON app.mail_outbox FOR SELECT TO poly_govern USING (true);--> statement-breakpoint
CREATE POLICY mail_outbox_govern_insert ON app.mail_outbox FOR INSERT TO poly_govern WITH CHECK (true);--> statement-breakpoint
CREATE POLICY mail_outbox_govern_update ON app.mail_outbox FOR UPDATE TO poly_govern USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY mail_outbox_purge_select ON app.mail_outbox FOR SELECT TO poly_purge USING (true);--> statement-breakpoint
CREATE POLICY mail_outbox_purge_delete ON app.mail_outbox FOR DELETE TO poly_purge USING (true);--> statement-breakpoint
CREATE TRIGGER method_hold_no_truncate BEFORE TRUNCATE ON app.method_hold FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint
CREATE TRIGGER mail_outbox_no_truncate BEFORE TRUNCATE ON app.mail_outbox FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint

-- R3.3 rule 2 reads the audit trail; D4's trigger finds the user through the account row. Column-exact, no login role.
GRANT SELECT (user_id, provider_id) ON public.account TO poly_govern;--> statement-breakpoint
GRANT SELECT (subject_user_id, kind, actor, created_at) ON public.audit_event TO poly_govern;--> statement-breakpoint
CREATE POLICY audit_event_second_step_govern ON public.audit_event FOR SELECT TO poly_govern
  USING (kind IN ('second_step.method_added', 'second_step.method_removed'));--> statement-breakpoint

-- (2) The poly_govern definers.
GRANT CREATE ON SCHEMA app TO poly_govern, poly_purge;--> statement-breakpoint
SET ROLE poly_govern;--> statement-breakpoint

-- R3.1: a method is held while a hold row names it, is not cancelled, and either its notice is unsent or its usable_at is ahead.
-- Called by app.guard_method_hold() inside the write, so it carries no exact-call check.
CREATE FUNCTION app.method_held(p_table text, p_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
    SELECT EXISTS (
      SELECT 1 FROM app.method_hold h
      WHERE h.cancelled_at IS NULL
        AND (h.notice_sent_at IS NULL OR h.usable_at > pg_catalog.now())
        AND CASE p_table WHEN 'two_factor' THEN h.two_factor_id = p_id WHEN 'passkey' THEN h.passkey_id = p_id ELSE false END)
  $fn$;--> statement-breakpoint

-- R3.7: the cancel link. The token is 43 canonical base64url characters for 32 bytes; its sha256 names a hold that is still held. For that hold's
-- user it deletes the method of every held hold, marks them cancelled, and deletes every session. The deletes fire sync_second_step.
CREATE FUNCTION app.cancel_method_hold(p_token text) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_bytes bytea;
    v_user uuid;
    r record;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.cancel_method_hold($1)' THEN
      RAISE EXCEPTION 'a hold definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
      RETURN false;
    END IF;
    v_bytes := pg_catalog.decode(pg_catalog.translate(p_token, '-_', '+/') || '=', 'base64');
    IF pg_catalog.octet_length(v_bytes) <> 32
       OR pg_catalog.translate(pg_catalog.rtrim(pg_catalog.encode(v_bytes, 'base64'), '='), '+/', '-_') <> p_token THEN
      RETURN false;
    END IF;
    SELECT h.user_id INTO v_user FROM app.method_hold h
      WHERE h.cancel_hash = pg_catalog.sha256(v_bytes)
        AND h.cancelled_at IS NULL AND (h.notice_sent_at IS NULL OR h.usable_at > pg_catalog.now())
      ORDER BY h.created_at LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    PERFORM 1 FROM public."user" u WHERE u.id = v_user FOR UPDATE;
    FOR r IN
      SELECT h.id, h.two_factor_id, h.passkey_id FROM app.method_hold h
        WHERE h.user_id = v_user AND h.cancelled_at IS NULL AND (h.notice_sent_at IS NULL OR h.usable_at > pg_catalog.now())
        ORDER BY h.created_at, h.id FOR UPDATE
    LOOP
      IF r.two_factor_id IS NOT NULL THEN
        DELETE FROM public.two_factor t WHERE t.id = r.two_factor_id;
      ELSE
        DELETE FROM public.passkey k WHERE k.id = r.passkey_id;
      END IF;
      UPDATE app.method_hold h SET cancelled_at = pg_catalog.now() WHERE h.id = r.id;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.two_factor t WHERE t.user_id = v_user AND t.verified) THEN
      UPDATE public."user" u SET two_factor_enabled = false WHERE u.id = v_user AND u.two_factor_enabled;
    END IF;
    DELETE FROM public.session s WHERE s.user_id = v_user;
    RETURN true;
  END
  $fn$;--> statement-breakpoint

-- R3.6: the worker's four definers. Each answers one exact statement.
CREATE FUNCTION app.claim_mail() RETURNS TABLE (id uuid, kind text, to_address text, payload jsonb, attempts integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  #variable_conflict use_column
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT * FROM app.claim_mail()' THEN
      RAISE EXCEPTION 'a mail definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      WITH c AS (
        SELECT o.id FROM app.mail_outbox o
          WHERE o.sent_at IS NULL AND o.attempts < 10
            AND (o.claimed_at IS NULL OR o.claimed_at < pg_catalog.clock_timestamp() - interval '5 minutes')
          ORDER BY o.created_at, o.id
          LIMIT 1 FOR UPDATE SKIP LOCKED)
      UPDATE app.mail_outbox m SET claimed_at = pg_catalog.clock_timestamp(), attempts = m.attempts + 1
        FROM c WHERE m.id = c.id
        RETURNING m.id, m.kind, m.to_address, m.payload, m.attempts;
  END
  $fn$;--> statement-breakpoint

-- Arms the cancel link for a mail's holds: the hash is the worker's; usable_at only moves later, to 24 hours after the arming at least. It
-- returns the latest usable_at (the mail's {until}), or NULL when no hold of that mail is held any more (after a cancel).
CREATE FUNCTION app.arm_hold_cancel(p_mail uuid, p_hash bytea) RETURNS timestamptz
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_until timestamptz;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.arm_hold_cancel($1, $2)' THEN
      RAISE EXCEPTION 'a mail definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF p_mail IS NULL OR p_hash IS NULL OR pg_catalog.octet_length(p_hash) <> 32 THEN
      RAISE EXCEPTION 'a cancel hash is 32 bytes' USING ERRCODE = '22023';
    END IF;
    UPDATE app.method_hold h
      SET cancel_hash = p_hash, usable_at = GREATEST(h.usable_at, pg_catalog.clock_timestamp() + interval '24 hours')
      WHERE h.mail_id = p_mail AND h.cancelled_at IS NULL AND (h.notice_sent_at IS NULL OR h.usable_at > pg_catalog.now());
    SELECT pg_catalog.max(h.usable_at) INTO v_until FROM app.method_hold h
      WHERE h.mail_id = p_mail AND h.cancelled_at IS NULL AND h.cancel_hash = p_hash;
    RETURN v_until;
  END
  $fn$;--> statement-breakpoint

CREATE FUNCTION app.mail_sent(p_mail uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.mail_sent($1)' THEN
      RAISE EXCEPTION 'a mail definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    UPDATE app.mail_outbox o SET sent_at = pg_catalog.clock_timestamp() WHERE o.id = p_mail AND o.sent_at IS NULL;
    UPDATE app.method_hold h SET notice_sent_at = pg_catalog.clock_timestamp() WHERE h.mail_id = p_mail AND h.notice_sent_at IS NULL;
  END
  $fn$;--> statement-breakpoint

CREATE FUNCTION app.mail_failed(p_mail uuid, p_status integer) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.mail_failed($1, $2)' THEN
      RAISE EXCEPTION 'a mail definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    UPDATE app.mail_outbox o SET last_status = p_status WHERE o.id = p_mail AND o.sent_at IS NULL;
  END
  $fn$;--> statement-breakpoint

-- R3.2: THE writer of user.second_step_at, 0019's body plus the hold and the outbox. The audit event is first and unchanged. A superuser session
-- (fixtures, restores) writes no hold and no mail; a user being deleted writes neither (the NOT FOUND return is above the new writes).
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
    v_email text;
    v_method text := CASE TG_TABLE_NAME WHEN 'passkey' THEN 'passkey' ELSE 'totp' END;
    v_row uuid := CASE TG_OP WHEN 'DELETE' THEN OLD.id ELSE NEW.id END;
    v_held boolean;
    v_mail uuid;
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
                'method', v_method,
                'passkey_id', CASE WHEN TG_TABLE_NAME = 'passkey' THEN v_row END,
                'session_id', app.current_session_id(),
                'marker_kind', v_kind));
    END IF;
    v_has := EXISTS (SELECT 1 FROM public.two_factor t WHERE t.user_id = v_user AND t.verified)
          OR EXISTS (SELECT 1 FROM public.passkey k WHERE k.user_id = v_user);
    SELECT u.second_step_at IS NOT NULL, u.email INTO v_set, v_email FROM public."user" u WHERE u.id = v_user;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    IF v_event IS NOT NULL
       AND NOT ((SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) AND pg_catalog.current_setting('role') = 'none') THEN
      IF v_event = 'second_step.method_added' THEN
        -- R3.3: first set-up (not held) only when the user has no second step AND no removal of their own since the operator's last reset.
        v_held := v_set OR EXISTS (
          SELECT 1 FROM public.audit_event a
           WHERE a.subject_user_id = v_user AND a.kind = 'second_step.method_removed' AND a.actor <> 'operator'
             AND a.created_at > COALESCE((SELECT pg_catalog.max(o.created_at) FROM public.audit_event o
                                           WHERE o.subject_user_id = v_user AND o.kind = 'second_step.method_removed' AND o.actor = 'operator'),
                                          '-infinity'::timestamptz));
        INSERT INTO app.mail_outbox (user_id, kind, to_address, payload)
        VALUES (v_user, 'method_added', v_email,
                pg_catalog.jsonb_build_object('methods', pg_catalog.jsonb_build_array(v_method), 'at', pg_catalog.now())
                  || CASE WHEN v_held THEN pg_catalog.jsonb_build_object('usable_at', pg_catalog.now() + interval '24 hours') ELSE '{}'::pg_catalog.jsonb END)
        ON CONFLICT (user_id, kind, tx) DO UPDATE
          SET payload = pg_catalog.jsonb_set(app.mail_outbox.payload, '{methods}', (app.mail_outbox.payload -> 'methods') || (EXCLUDED.payload -> 'methods'))
        RETURNING id INTO v_mail;
        IF v_held THEN
          INSERT INTO app.method_hold (user_id, method, two_factor_id, passkey_id, usable_at, mail_id)
          VALUES (v_user, v_method, CASE WHEN v_method = 'totp' THEN v_row END, CASE WHEN v_method = 'passkey' THEN v_row END,
                  pg_catalog.now() + interval '24 hours', v_mail);
        END IF;
      ELSE
        INSERT INTO app.mail_outbox (user_id, kind, to_address, payload)
        VALUES (v_user, 'method_removed', v_email,
                pg_catalog.jsonb_build_object('methods', pg_catalog.jsonb_build_array(v_method), 'at', pg_catalog.now()))
        ON CONFLICT (user_id, kind, tx) DO UPDATE
          SET payload = pg_catalog.jsonb_set(app.mail_outbox.payload, '{methods}', (app.mail_outbox.payload -> 'methods') || (EXCLUDED.payload -> 'methods'));
      END IF;
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

-- R3.5: 0013's body, with held methods left out of the count of remaining methods.
CREATE OR REPLACE FUNCTION app.check_factor_removal(p_user uuid, p_kind text, p_id uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_left bigint;
  BEGIN
    IF app.current_user_id() IS NULL OR p_user IS DISTINCT FROM app.current_user_id() THEN
      RAISE EXCEPTION 'a second step is removed by its own user' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public."user" u WHERE u.id = p_user FOR UPDATE;
    IF p_kind = 'two_factor_unverified' THEN
      RETURN;
    END IF;
    IF NOT app.step_up_fresh() THEN
      RAISE EXCEPTION 'step_up_required' USING ERRCODE = '42501';
    END IF;
    -- A held method (a live app.method_hold row) is not a working one: it does not stand in for the method being removed.
    SELECT (SELECT pg_catalog.count(*) FROM public.two_factor t
             WHERE t.user_id = p_user AND t.verified AND p_kind <> 'two_factor_all' AND (p_kind <> 'two_factor' OR t.id <> p_id)
               AND NOT app.method_held('two_factor', t.id))
         + (SELECT pg_catalog.count(*) FROM public.passkey k
             WHERE k.user_id = p_user AND (p_kind <> 'passkey' OR k.id <> p_id) AND NOT app.method_held('passkey', k.id))
      INTO v_left;
    IF v_left = 0 AND app.second_step_needed() THEN
      RAISE EXCEPTION 'second_step_required' USING ERRCODE = '42501';
    END IF;
  END
  $fn$;--> statement-breakpoint

-- R3.4: 0019's body, with one check before anything is spent or stamped: a held authenticator app (or its backup codes) cannot confirm.
CREATE OR REPLACE FUNCTION app.complete_step_up(p_method text, p_challenge uuid, p_step bigint) RETURNS boolean
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
    -- A method on hold (app.method_hold) cannot confirm.
    IF p_method IN ('totp', 'backup_code')
       AND EXISTS (SELECT 1 FROM public.two_factor t WHERE t.user_id = v_uid AND t.verified AND app.method_held('two_factor', t.id)) THEN
      RAISE EXCEPTION 'method_on_hold' USING ERRCODE = '42501';
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

-- D2: every change of backup_codes on a verified row, outside a spend at Confirm it's you (which has its step_up_pending row), is noticed.
-- With no marker (the sign-in transaction) the change must shrink the list, as a spend does; a copied longer list is refused.
CREATE FUNCTION app.note_codes_replaced() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_email text;
    v_kind text;
  BEGIN
    IF (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) AND pg_catalog.current_setting('role') = 'none' THEN
      RETURN NULL;
    END IF;
    IF NEW.backup_codes IS NOT DISTINCT FROM OLD.backup_codes OR OLD.verified IS NOT TRUE THEN
      RETURN NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM app.step_up_pending p WHERE p.xid = pg_catalog.pg_current_xact_id()) THEN
      RETURN NULL;
    END IF;
    IF app.current_user_id() IS NULL THEN
      IF pg_catalog.octet_length(NEW.backup_codes) >= pg_catalog.octet_length(OLD.backup_codes) THEN
        RAISE EXCEPTION 'backup_codes_not_a_spend' USING ERRCODE = '42501';
      END IF;
      v_kind := 'backup_code_used';
    ELSE
      v_kind := 'backup_codes_replaced';
    END IF;
    SELECT u.email INTO v_email FROM public."user" u WHERE u.id = NEW.user_id;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    INSERT INTO app.mail_outbox (user_id, kind, to_address, payload)
    VALUES (NEW.user_id, v_kind, v_email, pg_catalog.jsonb_build_object('at', pg_catalog.now()))
    ON CONFLICT (user_id, kind, tx) DO NOTHING;
    RETURN NULL;
  END
  $fn$;--> statement-breakpoint

-- D4: a changed password is noticed, whichever path wrote it. A first password (an INSERT) is out of scope.
CREATE FUNCTION app.note_password_changed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_email text;
  BEGIN
    IF (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) AND pg_catalog.current_setting('role') = 'none' THEN
      RETURN NULL;
    END IF;
    IF NEW.password IS NOT DISTINCT FROM OLD.password THEN
      RETURN NULL;
    END IF;
    SELECT u.email INTO v_email FROM public."user" u WHERE u.id = NEW.user_id;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    INSERT INTO app.mail_outbox (user_id, kind, to_address, payload)
    VALUES (NEW.user_id, 'password_changed', v_email, pg_catalog.jsonb_build_object('at', pg_catalog.now()))
    ON CONFLICT (user_id, kind, tx) DO NOTHING;
    RETURN NULL;
  END
  $fn$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.method_held(text, uuid), app.cancel_method_hold(text), app.claim_mail(), app.arm_hold_cancel(uuid, bytea),
  app.mail_sent(uuid), app.mail_failed(uuid, integer), app.note_codes_replaced(), app.note_password_changed() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.method_held(text, uuid), app.cancel_method_hold(text) TO poly_auth;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_mail(), app.arm_hold_cancel(uuid, bytea), app.mail_sent(uuid), app.mail_failed(uuid, integer) TO poly_worker;--> statement-breakpoint
-- CREATE TRIGGER needs EXECUTE for its creator; poly_owner holds it only for this file.
GRANT EXECUTE ON FUNCTION app.note_codes_replaced(), app.note_password_changed() TO poly_owner;--> statement-breakpoint

-- (3) poly_purge's purge: sent rows over 30 days. An unsent row is never purged: it keeps its method held and keeps gate line 19 failing.
SET ROLE poly_purge;--> statement-breakpoint
CREATE FUNCTION app.purge_mail_outbox() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_n integer;
  BEGIN
    DELETE FROM app.mail_outbox o WHERE o.sent_at IS NOT NULL AND o.created_at < pg_catalog.now() - interval '30 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.purge_mail_outbox() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.purge_mail_outbox() TO poly_worker;--> statement-breakpoint

-- (4) The invoker trigger functions and the triggers, on the tables' owner.
SET ROLE poly_owner;--> statement-breakpoint

-- R3.4: the hold's guard. Only poly_govern (reached through its own definers) and a superuser pass unchecked.
CREATE FUNCTION app.guard_method_hold() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $fn$
  BEGIN
    IF current_user = 'poly_govern' OR (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'two_factor' THEN
      -- A wrong-code increment passes; the success reset and any change of the codes are what a held method may not do.
      IF NEW.failed_verification_count = 0 OR NEW.backup_codes IS DISTINCT FROM OLD.backup_codes THEN
        IF app.method_held('two_factor', NEW.id) THEN
          RAISE EXCEPTION 'method_on_hold' USING ERRCODE = '42501';
        END IF;
      END IF;
    ELSIF app.method_held('passkey', NEW.id) THEN
      RAISE EXCEPTION 'method_on_hold' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $fn$;--> statement-breakpoint

-- D1: no login role changes user.email. A superuser (the operator at the box) may.
CREATE FUNCTION app.refuse_email_change() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $fn$
  BEGIN
    IF NEW.email IS NOT DISTINCT FROM OLD.email THEN
      RETURN NEW;
    END IF;
    IF (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a user''s email is changed by no login role' USING ERRCODE = '42501';
  END
  $fn$;--> statement-breakpoint

CREATE TRIGGER two_factor_12_method_hold BEFORE UPDATE OF failed_verification_count, backup_codes ON public.two_factor
  FOR EACH ROW EXECUTE FUNCTION app.guard_method_hold();--> statement-breakpoint
CREATE TRIGGER passkey_12_method_hold BEFORE UPDATE OF counter ON public.passkey
  FOR EACH ROW EXECUTE FUNCTION app.guard_method_hold();--> statement-breakpoint
CREATE TRIGGER user_21_email_fixed BEFORE UPDATE OF email ON public."user"
  FOR EACH ROW EXECUTE FUNCTION app.refuse_email_change();--> statement-breakpoint
CREATE TRIGGER two_factor_84_codes_replaced AFTER UPDATE OF backup_codes ON public.two_factor
  FOR EACH ROW EXECUTE FUNCTION app.note_codes_replaced();--> statement-breakpoint
CREATE TRIGGER account_80_password_changed AFTER UPDATE OF password ON public.account
  FOR EACH ROW EXECUTE FUNCTION app.note_password_changed();--> statement-breakpoint

REVOKE CREATE ON SCHEMA app FROM poly_govern, poly_purge;--> statement-breakpoint
SET ROLE poly_govern;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.note_codes_replaced(), app.note_password_changed() FROM poly_owner;--> statement-breakpoint
SET ROLE poly_owner;
