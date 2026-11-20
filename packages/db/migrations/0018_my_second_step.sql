ALTER TABLE "two_factor" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- POLY-150 (ruling R2, RC1): the one read behind the SecondStep read model. poly_app lost its reach into BetterAuth's tables in 0017, so
-- the facts the second-step screens need come from one definer. It reads only the marker's own user and session (kind 'session'), writes
-- nothing, and returns no secret, backup code, key, credential id, hash, attempt count, lock time or address.
GRANT CREATE ON SCHEMA app TO poly_govern;--> statement-breakpoint
SET ROLE poly_govern;--> statement-breakpoint
CREATE FUNCTION app.my_second_step()
  RETURNS TABLE (second_step_at timestamptz, totp_added_at timestamptz, passkeys jsonb, challenge_expires_at timestamptz,
                 resend_available_at timestamptz, grant_expires_at timestamptz, needs_a_method boolean, codes_paused boolean)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  AS $fn$
  #variable_conflict use_column
  DECLARE
    v_uid uuid;
    v_sid uuid;
    v_third timestamptz;
    v_wrong bigint;
  BEGIN
    IF pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.current_query()), ';\s*$', '') IS DISTINCT FROM 'SELECT * FROM app.my_second_step()' THEN
      RAISE EXCEPTION 'a second-step definer must be called on its own' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.tx_identity t WHERE t.xid = pg_catalog.pg_current_xact_id_if_assigned() AND t.kind = 'session') THEN
      RAISE EXCEPTION 'a web session is required' USING ERRCODE = '42501';
    END IF;
    v_uid := app.current_user_id();
    v_sid := app.current_session_id();
    IF v_uid IS NULL OR v_sid IS NULL THEN
      RAISE EXCEPTION 'no user in context' USING ERRCODE = '42501';
    END IF;
    -- The 3-in-15-minutes rule (issue_email_challenge): the third-newest challenge in the window, when there are three.
    SELECT c.created_at INTO v_third FROM app.email_challenge c
      WHERE c.user_id = v_uid AND c.created_at > pg_catalog.now() - interval '15 minutes'
      ORDER BY c.created_at DESC OFFSET 2 LIMIT 1;
    SELECT coalesce(pg_catalog.sum(c.attempts), 0) INTO v_wrong FROM app.email_challenge c
      WHERE c.user_id = v_uid AND c.created_at > pg_catalog.now() - interval '24 hours';
    RETURN QUERY SELECT
      u.second_step_at,
      (SELECT t.created_at FROM public.two_factor t WHERE t.user_id = v_uid AND t.verified ORDER BY t.created_at LIMIT 1),
      coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', k.id, 'name', k.name, 'created_at', k.created_at) ORDER BY k.created_at, k.id)
                  FROM public.passkey k WHERE k.user_id = v_uid), '[]'::jsonb),
      (SELECT c.expires_at FROM app.email_challenge c
        WHERE c.user_id = v_uid AND c.session_id = v_sid AND c.purpose = 'first_enrolment' AND c.used_at IS NULL AND c.expires_at > pg_catalog.now()
        ORDER BY c.created_at DESC LIMIT 1),
      -- Set only while the 3-in-15 rule alone holds the next send back; NULL for the 10-wrong rule and when nothing does, so it never says which.
      CASE WHEN v_third IS NOT NULL AND v_wrong < 10 THEN v_third + interval '15 minutes' END,
      (SELECT g.expires_at FROM app.enrolment_grant g
        WHERE g.user_id = v_uid AND g.session_id = v_sid AND g.consumed_at IS NULL AND g.revoked_at IS NULL AND g.expires_at > pg_catalog.now()
        ORDER BY g.created_at DESC LIMIT 1),
      -- The rule refuse_last_method applies: manager or owner where the own-Person exemption does not hold.
      app.second_step_needed(),
      coalesce((SELECT true FROM public.two_factor t WHERE t.user_id = v_uid AND t.verified AND t.locked_until > pg_catalog.clock_timestamp() LIMIT 1), false)
    FROM public."user" u WHERE u.id = v_uid;
  END
  $fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.my_second_step() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.my_second_step() TO poly_app;--> statement-breakpoint
SET ROLE poly_owner;--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM poly_govern;
