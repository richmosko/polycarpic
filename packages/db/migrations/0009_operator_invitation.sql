-- Custom migration (generate --custom). Runs as session_user poly_migrator with SET ROLE poly_owner active (src/migrate.ts).
-- POLY-142 (ruling R1-R2): the operator's invitation issuer, the one-live-bootstrap index, and the bootstrap rule in claim/accept.
-- Ends on poly_owner.

-- At most one unclaimed, unrevoked bootstrap row, whatever the advisory lock does.
CREATE UNIQUE INDEX invitation_one_live_bootstrap ON public.invitation ((true))
  WHERE issued_via = 'bootstrap' AND claimed_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint

GRANT INSERT (email, role, token_hash, expires_at, issued_via) ON public.invitation TO poly_govern;--> statement-breakpoint
GRANT UPDATE (revoked_at) ON public.invitation TO poly_govern;--> statement-breakpoint
CREATE POLICY invitation_operator_issue ON public.invitation FOR INSERT TO poly_govern
  WITH CHECK (entity_id IS NULL AND inviter_user_id IS NULL AND issued_via IN ('operator', 'bootstrap')
              AND role = 'viewer' AND app.current_user_id() IS NULL);--> statement-breakpoint
CREATE POLICY invitation_bootstrap_revoke ON public.invitation FOR UPDATE TO poly_govern
  USING (issued_via = 'bootstrap' AND claimed_at IS NULL)
  WITH CHECK (issued_via = 'bootstrap' AND claimed_at IS NULL AND revoked_at IS NOT NULL);--> statement-breakpoint

GRANT CREATE ON SCHEMA app TO poly_govern;--> statement-breakpoint

SET ROLE poly_govern;--> statement-breakpoint

-- The operator's issuer. Refuses any user context; writes its own actor literal (app.actor proves nothing). Every call takes the
-- advisory lock. A bootstrap call revokes the earlier unclaimed bootstrap row first, then refuses if a user exists: a sign-up
-- holding that row's lock commits before the revoke proceeds, and the next statement sees its user.
CREATE FUNCTION app.issue_operator_invitation(p_email text, p_hash bytea, p_bootstrap boolean)
  RETURNS TABLE (o_invitation_id uuid, o_expires_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
  SET lock_timeout = '2s'
  AS $$
  DECLARE
    v_id uuid;
    v_exp timestamptz;
    v_via text := CASE WHEN p_bootstrap THEN 'bootstrap' ELSE 'operator' END;
    r record;
  BEGIN
    IF app.current_user_id() IS NOT NULL THEN
      RAISE EXCEPTION 'operator invitations are issued without a user in context' USING ERRCODE = '42501';
    END IF;
    IF p_email IS NULL OR pg_catalog.length(p_email) > 254 OR p_email ~ '[\x01-\x20\x7f]' OR p_email !~ '^[^@]+@[^@]+$' THEN
      RAISE EXCEPTION 'not an email address' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app.issue_operator_invitation', 0));
    IF p_bootstrap THEN
      FOR r IN
        UPDATE public.invitation i SET revoked_at = pg_catalog.now()
        WHERE i.issued_via = 'bootstrap' AND i.claimed_at IS NULL AND i.revoked_at IS NULL
        RETURNING i.id
      LOOP
        INSERT INTO public.audit_event (entity_id, actor_user_id, actor, kind, subject_user_id, payload)
        VALUES (NULL, NULL, 'operator:cli', 'invitation.revoked', NULL, pg_catalog.jsonb_build_object('invitation_id', r.id));
      END LOOP;
      IF EXISTS (SELECT u.id FROM public."user" u) THEN
        RAISE EXCEPTION 'instance_not_empty' USING ERRCODE = '55000';
      END IF;
    ELSIF NOT EXISTS (SELECT u.id FROM public."user" u) THEN
      RAISE EXCEPTION 'instance_empty' USING ERRCODE = '55000';
    END IF;
    INSERT INTO public.invitation (email, role, token_hash, expires_at, issued_via)
    VALUES (pg_catalog.lower(p_email), 'viewer', p_hash, pg_catalog.now() + interval '7 days', v_via)
    RETURNING id, expires_at INTO v_id, v_exp;
    INSERT INTO public.audit_event (entity_id, actor_user_id, actor, kind, subject_user_id, payload)
    VALUES (NULL, NULL, 'operator:cli', 'invitation.issued', NULL,
            pg_catalog.jsonb_build_object('invitation_id', v_id, 'issued_via', v_via));
    RETURN QUERY SELECT v_id, v_exp;
  END
  $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.issue_operator_invitation(text, bytea, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.issue_operator_invitation(text, bytea, boolean) TO poly_worker;--> statement-breakpoint

-- 0007's claim and accept, plus one predicate: a bootstrap invitation is dead once any user exists (accept excludes the
-- user this transaction inserted).
CREATE OR REPLACE FUNCTION app.claim_invitations(bytea, text) RETURNS void
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
      AND (i.issued_via <> 'bootstrap' OR NOT EXISTS (SELECT u.id FROM public."user" u))
    ORDER BY i.id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invitation_required' USING ERRCODE = '42501';
    END IF;
  END
  $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.accept_invitations(bytea) RETURNS uuid
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
        AND (i.issued_via <> 'bootstrap' OR NOT EXISTS (SELECT u.id FROM public."user" u WHERE u.id <> v_uid))
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

SET ROLE poly_owner;--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM poly_govern;
