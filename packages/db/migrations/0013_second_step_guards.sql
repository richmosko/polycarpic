-- Custom migration (generate --custom). Runs as session_user poly_migrator with SET ROLE poly_owner active (src/migrate.ts).
-- POLY-89 (ruling R1-R6, seceng conditions C-a..C-f): the grants, the authz and definer functions and the triggers of the
-- second sign-in step. Order: (1) grants and policies, (2) poly_authz functions, (3) poly_govern definers, (4) invoker trigger
-- functions, (5) triggers. Every function takes the acting user from app.current_user_id(); no function reads current_setting('app.*').
-- No login role gains a grant on BetterAuth's tables: every new privilege goes to a NOLOGIN definer owner. Ends on poly_owner.

-- ---------------------------------------------------------------------------------------------------------------------
-- (1) Grants and policies (R1.4). poly_govern is a definer owner and holds no login.
-- ---------------------------------------------------------------------------------------------------------------------
GRANT SELECT (two_factor_enabled, second_step_at, email), UPDATE (two_factor_enabled, second_step_at) ON public."user" TO poly_govern;--> statement-breakpoint
GRANT SELECT (id, user_id, created_at, recent_auth_at), UPDATE (recent_auth_at), DELETE ON public.session TO poly_govern;--> statement-breakpoint
GRANT SELECT, DELETE ON public.two_factor, public.passkey TO poly_govern;--> statement-breakpoint
GRANT SELECT (id, value), DELETE ON public.verification TO poly_govern;--> statement-breakpoint
GRANT INSERT (recipient_user_id, kind, payload) ON public.notification TO poly_govern;--> statement-breakpoint
CREATE POLICY notification_govern_insert ON public.notification FOR INSERT TO poly_govern WITH CHECK (true);--> statement-breakpoint
-- poly_authz reads what the exemption predicate and the gate need, through role-targeted policies, as it does for membership.
GRANT SELECT (id, self_user_id) ON public.entity TO poly_authz;--> statement-breakpoint
GRANT SELECT (second_step_at) ON public."user" TO poly_authz;--> statement-breakpoint
GRANT SELECT (entity_id, claimed_user_id, claimed_at, accepted_at, revoked_at, expires_at) ON public.invitation TO poly_authz;--> statement-breakpoint
CREATE POLICY invitation_authz_read ON public.invitation FOR SELECT TO poly_authz USING (true);--> statement-breakpoint
-- seat_claimed_invitations seats a claimed manager or owner invitation for the marker's own user (POLY-87 R1, R2); the viewer and the
-- creator's owner seat have their own policies (0003, 0007).
CREATE POLICY membership_seat_claimed ON public.membership FOR INSERT TO poly_govern
  WITH CHECK (user_id = app.current_user_id() AND role IN ('manager', 'owner'));--> statement-breakpoint

-- The two new tables. poly_app reads six columns of its own challenges; the grant table is closed to it.
ALTER TABLE app.email_challenge ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app.email_challenge FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON app.email_challenge, app.enrolment_grant FROM PUBLIC;--> statement-breakpoint
GRANT SELECT (id, purpose, created_at, expires_at, attempts, used_at) ON app.email_challenge TO poly_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.email_challenge, app.enrolment_grant TO poly_govern;--> statement-breakpoint
CREATE POLICY email_challenge_own ON app.email_challenge FOR SELECT TO poly_app USING (user_id = app.current_user_id());--> statement-breakpoint
CREATE POLICY email_challenge_govern_select ON app.email_challenge FOR SELECT TO poly_govern USING (true);--> statement-breakpoint
CREATE POLICY email_challenge_govern_insert ON app.email_challenge FOR INSERT TO poly_govern WITH CHECK (true);--> statement-breakpoint
CREATE POLICY email_challenge_govern_update ON app.email_challenge FOR UPDATE TO poly_govern USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY email_challenge_govern_delete ON app.email_challenge FOR DELETE TO poly_govern USING (true);--> statement-breakpoint
-- The grant table is closed to poly_app; row security is on and forced anyway (C-13), with policies for poly_govern alone.
ALTER TABLE app.enrolment_grant ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app.enrolment_grant FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY enrolment_grant_govern_select ON app.enrolment_grant FOR SELECT TO poly_govern USING (true);--> statement-breakpoint
CREATE POLICY enrolment_grant_govern_insert ON app.enrolment_grant FOR INSERT TO poly_govern WITH CHECK (true);--> statement-breakpoint
CREATE POLICY enrolment_grant_govern_update ON app.enrolment_grant FOR UPDATE TO poly_govern USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY enrolment_grant_govern_delete ON app.enrolment_grant FOR DELETE TO poly_govern USING (true);--> statement-breakpoint
CREATE TRIGGER email_challenge_no_truncate BEFORE TRUNCATE ON app.email_challenge FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint
CREATE TRIGGER enrolment_grant_no_truncate BEFORE TRUNCATE ON app.enrolment_grant FOR EACH STATEMENT EXECUTE FUNCTION app.refuse_truncate();--> statement-breakpoint

-- app.current_session_id() (0011) is executable by poly_app only; the definers below read the marker's session too.
GRANT EXECUTE ON FUNCTION app.current_session_id() TO poly_govern;--> statement-breakpoint

-- 0007's commit-time stamp check ran as the committing role and read public."user", so any UPDATE of a user by a role with no
-- USAGE on public (the operator's reset) failed at COMMIT. It becomes a definer of poly_govern; the check itself is unchanged.
DROP TRIGGER user_90_stamp_cleared ON public."user";--> statement-breakpoint
DROP FUNCTION app.signup_stamp_cleared();--> statement-breakpoint

GRANT CREATE ON SCHEMA app TO poly_authz, poly_govern;--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------------
-- (2) poly_authz: the one exemption predicate (R4)
-- ---------------------------------------------------------------------------------------------------------------------
SET ROLE poly_authz;--> statement-breakpoint

-- True when the entity is the marker user's own Person and nothing is shared or about to be: no other member, and no invitation
-- that is unrevoked, unaccepted and either claimed or unexpired (enrol, invite a manager, drop the last method, the invitee seats later).
-- VOLATILE on purpose: callers read it in a statement after their lock (R1.6).
CREATE FUNCTION app.own_person_exempt(p_entity uuid) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $$
    SELECT app.current_user_id() IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.entity e WHERE e.id = p_entity AND e.self_user_id = app.current_user_id())
      AND NOT EXISTS (SELECT 1 FROM public.membership m WHERE m.entity_id = p_entity AND m.user_id <> app.current_user_id())
      AND NOT EXISTS (SELECT 1 FROM public.invitation i
                      WHERE i.entity_id = p_entity AND i.revoked_at IS NULL AND i.accepted_at IS NULL
                        AND (i.claimed_at IS NOT NULL OR i.expires_at > pg_catalog.now()))
  $$;--> statement-breakpoint
-- The marker user holds manager or owner on an entity where the exemption does not hold.
CREATE FUNCTION app.second_step_needed() RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $$
    SELECT EXISTS (SELECT 1 FROM public.membership m
                   WHERE m.user_id = app.current_user_id() AND m.role IN ('manager', 'owner')
                     AND NOT app.own_person_exempt(m.entity_id))
  $$;--> statement-breakpoint
-- The sign-in gate and SecondStep.required (R4): one answer. A pure read of the marker user's own state, so no exact-call check.
CREATE FUNCTION app.second_step_required() RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_open boolean;
  BEGIN
    IF app.current_user_id() IS NULL THEN
      RAISE EXCEPTION 'no user in context' USING ERRCODE = '42501';
    END IF;
    SELECT u.second_step_at IS NULL INTO v_open FROM public."user" u WHERE u.id = app.current_user_id();
    RETURN coalesce(v_open, false) AND app.second_step_needed();
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.own_person_exempt(uuid), app.second_step_needed() FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.second_step_required() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.own_person_exempt(uuid), app.second_step_needed() TO poly_govern;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.second_step_required() TO poly_app;--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------------
-- (3) poly_govern definers
-- ---------------------------------------------------------------------------------------------------------------------
SET ROLE poly_govern;--> statement-breakpoint

-- A fresh step-up (R1.2): the marker's own user holds a session, named by the marker, stamped within 300 s. The marker's session id
-- only narrows the check; the proof is recent_auth_at, which no login role can write.
CREATE FUNCTION app.step_up_fresh() RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $$
    SELECT EXISTS (SELECT 1 FROM public.session s
                   WHERE s.id = app.current_session_id() AND s.user_id = app.current_user_id()
                     AND s.recent_auth_at <= pg_catalog.now()
                     AND s.recent_auth_at >= pg_catalog.now() - interval '300 seconds')
  $$;--> statement-breakpoint

-- The proof a factor write needs. First factor (second_step_at NULL): a live grant for (user, marker session) when p_by is NULL, or a
-- grant this very transaction consumed, by p_by, when it is not. Any later factor: a fresh step-up.
CREATE FUNCTION app.enrol_proof(p_by text) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_uid uuid := app.current_user_id();
    v_first boolean;
  BEGIN
    IF v_uid IS NULL THEN
      RETURN false;
    END IF;
    SELECT u.second_step_at IS NULL INTO v_first FROM public."user" u WHERE u.id = v_uid;
    IF NOT coalesce(v_first, false) THEN
      RETURN app.step_up_fresh();
    END IF;
    IF p_by IS NULL THEN
      RETURN EXISTS (SELECT 1 FROM app.enrolment_grant g
                     WHERE g.user_id = v_uid AND g.session_id = app.current_session_id()
                       AND g.consumed_at IS NULL AND g.revoked_at IS NULL AND g.expires_at > pg_catalog.now());
    END IF;
    RETURN EXISTS (SELECT 1 FROM app.enrolment_grant g
                   WHERE g.user_id = v_uid AND g.consumed_xid = pg_catalog.pg_current_xact_id()
                     AND g.consumed_by = p_by AND g.revoked_at IS NULL);
  END
  $fn$;--> statement-breakpoint

-- A live grant exists for the marker's user and session: the enrolment class's check (R5). A pure read of its own state.
CREATE FUNCTION app.enrolment_grant_live() RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    IF app.current_user_id() IS NULL OR app.current_session_id() IS NULL THEN
      RAISE EXCEPTION 'no user in context' USING ERRCODE = '42501';
    END IF;
    RETURN EXISTS (SELECT 1 FROM app.enrolment_grant g
                   WHERE g.user_id = app.current_user_id() AND g.session_id = app.current_session_id()
                     AND g.consumed_at IS NULL AND g.revoked_at IS NULL AND g.expires_at > pg_catalog.now());
  END
  $fn$;--> statement-breakpoint

-- Removing a factor (R3 #7, R1.6). Locks the user row, then reads in later statements. p_kind: 'two_factor' (one verified row),
-- 'two_factor_unverified' (a half-enrolled row: no method is lost), 'two_factor_all' (the flip off: every TOTP row goes), 'passkey'.
CREATE FUNCTION app.check_factor_removal(p_user uuid, p_kind text, p_id uuid) RETURNS void
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
    SELECT (SELECT pg_catalog.count(*) FROM public.two_factor t
             WHERE t.user_id = p_user AND t.verified AND p_kind <> 'two_factor_all' AND (p_kind <> 'two_factor' OR t.id <> p_id))
         + (SELECT pg_catalog.count(*) FROM public.passkey k WHERE k.user_id = p_user AND (p_kind <> 'passkey' OR k.id <> p_id))
      INTO v_left;
    IF v_left = 0 AND app.second_step_needed() THEN
      RAISE EXCEPTION 'second_step_required' USING ERRCODE = '42501';
    END IF;
  END
  $fn$;--> statement-breakpoint

-- The flip (R3 #1). On: an unverified two_factor row of the user exists; a first factor consumes the live grant, a later one needs a
-- fresh step-up. Off: a fresh step-up, and the last-method rule. The column is read back at commit (two_factor_consistent), so
-- the flip and the factor row's deletion must end in the same transaction (the measured order is flip, then delete).
CREATE FUNCTION app.set_two_factor_enabled(p_on boolean) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_uid uuid;
    v_first boolean;
    v_grant uuid;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.set_two_factor_enabled($1)' THEN
      RAISE EXCEPTION 'a second-step definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    v_uid := app.current_user_id();
    IF v_uid IS NULL OR p_on IS NULL THEN
      RAISE EXCEPTION 'no user in context' USING ERRCODE = '42501';
    END IF;
    IF p_on THEN
      IF NOT EXISTS (SELECT 1 FROM public.two_factor t WHERE t.user_id = v_uid AND NOT t.verified) THEN
        RAISE EXCEPTION 'no unverified factor to turn on' USING ERRCODE = '42501';
      END IF;
      SELECT u.second_step_at IS NULL INTO v_first FROM public."user" u WHERE u.id = v_uid;
      IF coalesce(v_first, false) THEN
        UPDATE app.enrolment_grant g
          SET consumed_at = pg_catalog.now(), consumed_xid = pg_catalog.pg_current_xact_id(), consumed_by = 'totp'
          WHERE g.user_id = v_uid AND g.session_id = app.current_session_id()
            AND g.consumed_at IS NULL AND g.revoked_at IS NULL AND g.expires_at > pg_catalog.now()
          RETURNING g.id INTO v_grant;
        IF v_grant IS NULL THEN
          RAISE EXCEPTION 'email_confirmation_required' USING ERRCODE = '42501';
        END IF;
      ELSIF NOT app.step_up_fresh() THEN
        RAISE EXCEPTION 'step_up_required' USING ERRCODE = '42501';
      END IF;
    ELSE
      PERFORM app.check_factor_removal(v_uid, 'two_factor_all', NULL);
    END IF;
    UPDATE public."user" SET two_factor_enabled = p_on WHERE id = v_uid;
  END
  $fn$;--> statement-breakpoint

-- The passkey's gate (R3 #6): called by guard_passkey inside the passkey INSERT, never directly. A first factor consumes the live
-- grant and stamps the marker session, which must be exactly one row; a later factor needs a fresh step-up.
CREATE FUNCTION app.consume_passkey_grant() RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_uid uuid := app.current_user_id();
    v_sid uuid := app.current_session_id();
    v_first boolean;
    v_grant uuid;
    v_n bigint;
  BEGIN
    IF pg_catalog.pg_trigger_depth() = 0 OR v_uid IS NULL THEN
      RAISE EXCEPTION 'a passkey grant is consumed by the passkey insert' USING ERRCODE = '42501';
    END IF;
    SELECT u.second_step_at IS NULL INTO v_first FROM public."user" u WHERE u.id = v_uid;
    IF NOT coalesce(v_first, false) THEN
      IF NOT app.step_up_fresh() THEN
        RAISE EXCEPTION 'step_up_required' USING ERRCODE = '42501';
      END IF;
      RETURN;
    END IF;
    UPDATE app.enrolment_grant g
      SET consumed_at = pg_catalog.now(), consumed_xid = pg_catalog.pg_current_xact_id(), consumed_by = 'passkey', stamped_at = pg_catalog.now()
      WHERE g.user_id = v_uid AND g.session_id = v_sid
        AND g.consumed_at IS NULL AND g.revoked_at IS NULL AND g.expires_at > pg_catalog.now()
      RETURNING g.id INTO v_grant;
    IF v_grant IS NULL THEN
      RAISE EXCEPTION 'email_confirmation_required' USING ERRCODE = '42501';
    END IF;
    UPDATE public.session SET recent_auth_at = pg_catalog.now() WHERE id = v_sid AND user_id = v_uid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'the grant''s session is gone' USING ERRCODE = '42501';
    END IF;
  END
  $fn$;--> statement-breakpoint

-- The session INSERT's stamp (R3 #3): true once, for the grant a TOTP verify consumed in this transaction. Called by stamp_recent_auth.
CREATE FUNCTION app.take_recent_auth_stamp(p_user uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_n bigint;
  BEGIN
    IF pg_catalog.pg_trigger_depth() = 0 OR app.current_user_id() IS NULL OR p_user IS DISTINCT FROM app.current_user_id() THEN
      RETURN false;
    END IF;
    UPDATE app.enrolment_grant g SET stamped_at = pg_catalog.now()
      WHERE g.user_id = p_user AND g.consumed_xid = pg_catalog.pg_current_xact_id()
        AND g.consumed_by = 'totp' AND g.stamped_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n = 1;
  END
  $fn$;--> statement-breakpoint

-- Seats the marker user's claimed, unrevoked manager and owner invitations (POLY-87 R1, R2). Called by sync_second_step when the
-- column goes from NULL to set; with no marker user it does nothing.
CREATE FUNCTION app.seat_claimed_invitations() RETURNS void
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
    FOR r IN
      SELECT i.id, i.entity_id, i.role FROM public.invitation i
      WHERE i.claimed_user_id = v_uid AND i.accepted_at IS NULL AND i.revoked_at IS NULL
        AND i.entity_id IS NOT NULL AND i.role IN ('manager', 'owner')
      ORDER BY i.id FOR UPDATE
    LOOP
      INSERT INTO public.membership (entity_id, user_id, role) VALUES (r.entity_id, v_uid, r.role) ON CONFLICT DO NOTHING;
      UPDATE public.invitation SET accepted_at = pg_catalog.now() WHERE id = r.id;
    END LOOP;
  END
  $fn$;--> statement-breakpoint

-- THE writer of user.second_step_at (R3 #8, C7). Recomputes for the changed row's own user, never the marker's; with a marker it
-- refuses a row of another user. An account row never counts.
CREATE FUNCTION app.sync_second_step() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_user uuid := CASE TG_OP WHEN 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
    v_has boolean;
    v_set boolean;
  BEGIN
    IF app.current_user_id() IS NOT NULL AND v_user IS DISTINCT FROM app.current_user_id() THEN
      RAISE EXCEPTION 'a second step belongs to its own user' USING ERRCODE = '42501';
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

-- At commit, for the changed row's own user: two_factor_enabled equals "a verified two_factor row exists" (C14). A superuser
-- session (fixtures, restores) passes. Unmarked sign-in updates therefore commit.
CREATE FUNCTION app.two_factor_consistent() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_user uuid;
    v_flag boolean;
  BEGIN
    IF (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) AND pg_catalog.current_setting('role') = 'none' THEN
      RETURN NULL;
    END IF;
    IF TG_TABLE_NAME = 'user' THEN
      v_user := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
      v_user := OLD.user_id;
    ELSE
      v_user := NEW.user_id;
    END IF;
    SELECT u.two_factor_enabled INTO v_flag FROM public."user" u WHERE u.id = v_user;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    IF v_flag IS DISTINCT FROM EXISTS (SELECT 1 FROM public.two_factor t WHERE t.user_id = v_user AND t.verified) THEN
      RAISE EXCEPTION 'two_factor_enabled must match the verified factor' USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
  END
  $fn$;--> statement-breakpoint

-- A manager or owner seat needs a second step, except the user's own exempt Person (C2). Covers seat_creator, the claim's seating
-- and an UPDATE raise. The user row is locked FOR SHARE and second_step_at is read in a later statement (R1.6).
CREATE FUNCTION app.require_second_step_for_role() RETURNS trigger
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_set boolean;
  BEGIN
    -- A superuser session (fixtures, restores) passes, but not one that has switched role (R1.3).
    IF (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) AND pg_catalog.current_setting('role') = 'none' THEN
      RETURN NEW;
    END IF;
    IF NEW.role NOT IN ('manager', 'owner') THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.role IN ('manager', 'owner') THEN
      RETURN NEW;
    END IF;
    PERFORM 1 FROM public."user" u WHERE u.id = NEW.user_id FOR SHARE;
    SELECT u.second_step_at IS NOT NULL INTO v_set FROM public."user" u WHERE u.id = NEW.user_id;
    IF coalesce(v_set, false) THEN
      RETURN NEW;
    END IF;
    IF NEW.user_id = app.current_user_id() AND app.own_person_exempt(NEW.entity_id) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'second_step_required' USING ERRCODE = '42501';
  END
  $fn$;--> statement-breakpoint

-- Sharing needs an enrolled inviter (C2). Operator rows (no entity) pass. With a marker the inviter is the marker user.
CREATE FUNCTION app.require_enrolled_inviter() RETURNS trigger
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_set boolean;
  BEGIN
    IF (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) AND pg_catalog.current_setting('role') = 'none' THEN
      RETURN NEW;
    END IF;
    IF NEW.entity_id IS NULL THEN
      RETURN NEW;
    END IF;
    IF app.current_user_id() IS NOT NULL AND NEW.inviter_user_id IS DISTINCT FROM app.current_user_id() THEN
      RAISE EXCEPTION 'an invitation is issued by its own inviter' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public."user" u WHERE u.id = NEW.inviter_user_id FOR SHARE;
    SELECT u.second_step_at IS NOT NULL INTO v_set FROM public."user" u WHERE u.id = NEW.inviter_user_id;
    IF NOT coalesce(v_set, false) THEN
      RAISE EXCEPTION 'second_step_required' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $fn$;--> statement-breakpoint

CREATE FUNCTION app.signup_stamp_cleared() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  BEGIN
    IF EXISTS (SELECT 1 FROM public."user" u WHERE u.id = NEW.id AND u.signup_txid IS NOT NULL) THEN
      RAISE EXCEPTION 'a sign-up must end by accepting its invitation' USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
  END
  $fn$;--> statement-breakpoint

-- The emailed code (R2). Six digits from the first 32 bits of a random uuid; stored as sha256(code || ':' || id); returned once.
-- NULL (suppressed) when 3 or more challenges were made in 15 minutes or the wrong entries of 24 hours reach 10.
CREATE FUNCTION app.issue_email_challenge(p_purpose text) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_uid uuid;
    v_sid uuid;
    v_id uuid := pg_catalog.gen_random_uuid();
    v_bytes bytea;
    v_code text;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.issue_email_challenge($1)' THEN
      RAISE EXCEPTION 'a second-step definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    v_uid := app.current_user_id();
    v_sid := app.current_session_id();
    IF v_uid IS NULL OR v_sid IS NULL THEN
      RAISE EXCEPTION 'no user in context' USING ERRCODE = '42501';
    END IF;
    IF p_purpose IS NULL OR p_purpose NOT IN ('first_enrolment', 'account_deletion') THEN
      RAISE EXCEPTION 'unknown purpose' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public."user" u WHERE u.id = v_uid FOR UPDATE;
    IF (SELECT pg_catalog.count(*) FROM app.email_challenge c WHERE c.user_id = v_uid AND c.created_at > pg_catalog.now() - interval '15 minutes') >= 3
       OR coalesce((SELECT pg_catalog.sum(c.attempts) FROM app.email_challenge c WHERE c.user_id = v_uid AND c.created_at > pg_catalog.now() - interval '24 hours'), 0) >= 10 THEN
      RETURN NULL;
    END IF;
    UPDATE app.email_challenge c SET used_at = pg_catalog.now() WHERE c.user_id = v_uid AND c.purpose = p_purpose AND c.used_at IS NULL;
    v_bytes := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
    v_code := pg_catalog.lpad((((pg_catalog.get_byte(v_bytes, 0)::bigint * 16777216) + (pg_catalog.get_byte(v_bytes, 1) * 65536)
                               + (pg_catalog.get_byte(v_bytes, 2) * 256) + pg_catalog.get_byte(v_bytes, 3)) % 1000000)::text, 6, '0');
    INSERT INTO app.email_challenge (id, user_id, session_id, purpose, code_hash, expires_at)
    VALUES (v_id, v_uid, v_sid, p_purpose, pg_catalog.sha256(pg_catalog.convert_to(v_code || ':' || v_id::text, 'UTF8')), pg_catalog.now() + interval '10 minutes');
    RETURN v_code;
  END
  $fn$;--> statement-breakpoint

-- Confirms the code for (marker user, marker session): returns false for every refusal. A right code mints one grant for the marker
-- session and revokes the user's open one; a wrong code counts, and the 5th voids the challenge.
CREATE FUNCTION app.confirm_email_challenge(p_code text) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_uid uuid;
    v_sid uuid;
    c record;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.confirm_email_challenge($1)' THEN
      RAISE EXCEPTION 'a second-step definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    v_uid := app.current_user_id();
    v_sid := app.current_session_id();
    IF v_uid IS NULL OR v_sid IS NULL THEN
      RAISE EXCEPTION 'no user in context' USING ERRCODE = '42501';
    END IF;
    IF p_code IS NULL OR p_code !~ '^[0-9]{6}$' THEN
      RETURN false;
    END IF;
    SELECT * INTO c FROM app.email_challenge x
      WHERE x.user_id = v_uid AND x.session_id = v_sid AND x.purpose = 'first_enrolment'
        AND x.used_at IS NULL AND x.expires_at > pg_catalog.now()
      ORDER BY x.created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    IF c.code_hash IS NOT DISTINCT FROM pg_catalog.sha256(pg_catalog.convert_to(p_code || ':' || c.id::text, 'UTF8')) THEN
      UPDATE app.email_challenge SET used_at = pg_catalog.now() WHERE id = c.id;
      UPDATE app.enrolment_grant g SET revoked_at = pg_catalog.now() WHERE g.user_id = v_uid AND g.consumed_at IS NULL AND g.revoked_at IS NULL;
      INSERT INTO app.enrolment_grant (user_id, session_id, expires_at) VALUES (v_uid, v_sid, pg_catalog.now() + interval '10 minutes');
      RETURN true;
    END IF;
    UPDATE app.email_challenge SET attempts = c.attempts + 1, used_at = CASE WHEN c.attempts + 1 >= 5 THEN pg_catalog.now() END WHERE id = c.id;
    RETURN false;
  END
  $fn$;--> statement-breakpoint

-- The operator's reset (R6). No user marker may be present. Raises when no user matches (the CLI exits 2). Sessions, challenges,
-- grants and trust-device rows go with the factors; sync_second_step clears second_step_at as the column's one writer.
CREATE FUNCTION app.reset_second_step(p_email text) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  DECLARE
    v_user uuid;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT app.reset_second_step($1)' THEN
      RAISE EXCEPTION 'a second-step definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF app.current_user_id() IS NOT NULL THEN
      RAISE EXCEPTION 'the reset is issued without a user in context' USING ERRCODE = '42501';
    END IF;
    SELECT u.id INTO v_user FROM public."user" u WHERE pg_catalog.lower(u.email) = pg_catalog.lower(p_email) FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no such user' USING ERRCODE = 'P0002';
    END IF;
    DELETE FROM public.two_factor WHERE user_id = v_user;
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

-- EXECUTE (R1.5): the login role the call comes from, and nobody else. The helpers the invoker triggers call are executable by
-- poly_app; the two that mutate refuse unless they run inside a trigger.
REVOKE EXECUTE ON FUNCTION app.signup_stamp_cleared() FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.step_up_fresh(), app.enrol_proof(text), app.enrolment_grant_live(), app.check_factor_removal(uuid, text, uuid),
  app.set_two_factor_enabled(boolean), app.consume_passkey_grant(), app.take_recent_auth_stamp(uuid), app.seat_claimed_invitations(),
  app.sync_second_step(), app.two_factor_consistent(), app.require_second_step_for_role(), app.require_enrolled_inviter(),
  app.issue_email_challenge(text), app.confirm_email_challenge(text), app.reset_second_step(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.step_up_fresh(), app.enrol_proof(text), app.enrolment_grant_live(), app.check_factor_removal(uuid, text, uuid),
  app.set_two_factor_enabled(boolean), app.consume_passkey_grant(), app.take_recent_auth_stamp(uuid),
  app.issue_email_challenge(text), app.confirm_email_challenge(text) TO poly_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.reset_second_step(text) TO poly_operator;--> statement-breakpoint
-- CREATE TRIGGER needs EXECUTE for its creator; poly_owner holds it only for this file.
GRANT EXECUTE ON FUNCTION app.sync_second_step(), app.two_factor_consistent(), app.require_second_step_for_role(), app.require_enrolled_inviter(), app.signup_stamp_cleared() TO poly_owner;--> statement-breakpoint

SET ROLE poly_owner;--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------------
-- (4) Invoker trigger functions: indifferent to the calling role (R1.3). Only poly_govern (reached through its own definers) and a
-- superuser pass unchecked, as app.gate_owner_changes does. They name no login role.
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION app.guard_two_factor_flag() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF current_user = 'poly_govern' OR (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.two_factor_enabled THEN
        RAISE EXCEPTION 'a user starts without a second factor' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'two_factor_enabled changes only through app.set_two_factor_enabled' USING ERRCODE = '42501';
  END
  $$;--> statement-breakpoint

-- Stamps session.recent_auth_at only for the grant a TOTP verify consumed in this transaction; every other INSERT gets NULL.
CREATE FUNCTION app.stamp_recent_auth() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF current_user = 'poly_govern' OR (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
      RETURN NEW;
    END IF;
    NEW.recent_auth_at := NULL;
    IF app.take_recent_auth_stamp(NEW.user_id) THEN
      NEW.recent_auth_at := pg_catalog.now();
    END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint
CREATE FUNCTION app.guard_recent_auth() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF current_user = 'poly_govern' OR (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'recent_auth_at is written only by the enrolment stamp' USING ERRCODE = '42501';
  END
  $$;--> statement-breakpoint

CREATE FUNCTION app.guard_two_factor() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  DECLARE
    v_uid uuid := app.current_user_id();
  BEGIN
    IF current_user = 'poly_govern' OR (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.id IS DISTINCT FROM OLD.id) THEN
      RAISE EXCEPTION 'a factor never changes its user' USING ERRCODE = '42501';
    END IF;
    IF v_uid IS NULL THEN
      -- The sign-in step: a verified row's failure counters and (backup codes kept, D1 b) the codes. Nothing else, and never an INSERT.
      IF TG_OP = 'INSERT' OR OLD.verified IS NOT TRUE OR NEW.verified IS DISTINCT FROM OLD.verified OR NEW.secret IS DISTINCT FROM OLD.secret THEN
        RAISE EXCEPTION 'a factor is written under a user' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.user_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'a factor belongs to its own user' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.verified IS DISTINCT FROM false OR NOT app.enrol_proof(NULL) THEN
        RAISE EXCEPTION 'email_confirmation_required' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.verified THEN
      IF NEW.verified IS DISTINCT FROM true OR NEW.secret IS DISTINCT FROM OLD.secret THEN
        RAISE EXCEPTION 'a verified factor is not rewritten' USING ERRCODE = '42501';
      END IF;
      IF NEW.backup_codes IS DISTINCT FROM OLD.backup_codes AND NOT app.step_up_fresh() THEN
        RAISE EXCEPTION 'step_up_required' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.verified THEN
      IF NEW.secret IS DISTINCT FROM OLD.secret OR NEW.backup_codes IS DISTINCT FROM OLD.backup_codes OR NOT app.enrol_proof('totp') THEN
        RAISE EXCEPTION 'email_confirmation_required' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.secret IS DISTINCT FROM OLD.secret OR NEW.backup_codes IS DISTINCT FROM OLD.backup_codes) AND NOT app.enrol_proof(NULL) THEN
      RAISE EXCEPTION 'email_confirmation_required' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint

CREATE FUNCTION app.guard_passkey() RETURNS trigger
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
    IF v_uid IS NULL THEN
      -- Passkey sign-in: the counter, and it never goes down (a constant 0 passes).
      IF TG_OP = 'INSERT' OR NEW.name IS DISTINCT FROM OLD.name OR NEW.counter < OLD.counter THEN
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

-- A factor's deletion: its own user, a fresh step-up, and never the last method of a manager or owner outside the exemption.
CREATE FUNCTION app.refuse_last_method() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
  BEGIN
    IF current_user = 'poly_govern' OR (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
      RETURN OLD;
    END IF;
    PERFORM app.check_factor_removal(OLD.user_id,
      CASE WHEN TG_TABLE_NAME = 'passkey' THEN 'passkey' WHEN OLD.verified THEN 'two_factor' ELSE 'two_factor_unverified' END,
      OLD.id);
    RETURN OLD;
  END
  $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------------
-- (5) Triggers. Same-event triggers fire in name order: _05_ before 0003's _10_, user_30 after 0007's _10_ and _20_, _80_ after
-- the _10_ and _20_ guards, _91_ at commit.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TRIGGER user_30_two_factor_flag BEFORE INSERT OR UPDATE OF two_factor_enabled ON public."user"
  FOR EACH ROW EXECUTE FUNCTION app.guard_two_factor_flag();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER user_91_two_factor_consistent AFTER UPDATE OF two_factor_enabled ON public."user"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.two_factor_consistent();--> statement-breakpoint
CREATE TRIGGER session_10_recent_auth BEFORE INSERT ON public.session
  FOR EACH ROW EXECUTE FUNCTION app.stamp_recent_auth();--> statement-breakpoint
CREATE TRIGGER session_11_recent_auth_fixed BEFORE UPDATE OF recent_auth_at ON public.session
  FOR EACH ROW EXECUTE FUNCTION app.guard_recent_auth();--> statement-breakpoint
CREATE TRIGGER two_factor_10_guard BEFORE INSERT OR UPDATE ON public.two_factor
  FOR EACH ROW EXECUTE FUNCTION app.guard_two_factor();--> statement-breakpoint
CREATE TRIGGER two_factor_20_last_method BEFORE DELETE ON public.two_factor
  FOR EACH ROW EXECUTE FUNCTION app.refuse_last_method();--> statement-breakpoint
CREATE TRIGGER two_factor_80_sync AFTER INSERT OR UPDATE OF verified OR DELETE ON public.two_factor
  FOR EACH ROW EXECUTE FUNCTION app.sync_second_step();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER two_factor_91_consistent AFTER INSERT OR UPDATE OR DELETE ON public.two_factor
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.two_factor_consistent();--> statement-breakpoint
CREATE TRIGGER passkey_10_guard BEFORE INSERT OR UPDATE ON public.passkey
  FOR EACH ROW EXECUTE FUNCTION app.guard_passkey();--> statement-breakpoint
CREATE TRIGGER passkey_20_last_method BEFORE DELETE ON public.passkey
  FOR EACH ROW EXECUTE FUNCTION app.refuse_last_method();--> statement-breakpoint
CREATE TRIGGER passkey_80_sync AFTER INSERT OR DELETE ON public.passkey
  FOR EACH ROW EXECUTE FUNCTION app.sync_second_step();--> statement-breakpoint
CREATE TRIGGER membership_05_second_step BEFORE INSERT OR UPDATE OF role ON public.membership
  FOR EACH ROW EXECUTE FUNCTION app.require_second_step_for_role();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER user_90_stamp_cleared AFTER INSERT OR UPDATE ON public."user"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.signup_stamp_cleared();--> statement-breakpoint
CREATE TRIGGER invitation_05_second_step BEFORE INSERT ON public.invitation
  FOR EACH ROW EXECUTE FUNCTION app.require_enrolled_inviter();--> statement-breakpoint

-- The file-scoped trigger-creation grant goes back; only the grantor can revoke it.
SET ROLE poly_govern;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.sync_second_step(), app.two_factor_consistent(), app.require_second_step_for_role(), app.require_enrolled_inviter(), app.signup_stamp_cleared() FROM poly_owner;--> statement-breakpoint
SET ROLE poly_owner;--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM poly_authz, poly_govern;
