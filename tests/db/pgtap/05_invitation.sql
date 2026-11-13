-- POLY-87 (ruling R1, R2, addenda 1-2; conditions 15-19, 29-31, 32 pgTAP part, 23 pgTAP part). One transaction, rolled back.
-- Fixtures are written as superuser through pg_temp.sx() and the checks that need a login role's view go through
-- pg_temp.run_as(): both swallow the error and return 'ERR:<sqlstate>', so a missing migration shows up as a "not ok"
-- line per assertion instead of one psql abort. A "new user" is a user row whose signup_txid is forged to the current
-- transaction id by the superuser (the stamp itself is covered in auth-new-user-step.test.ts).
-- Each assertion's message names the mutation that turns it red.
BEGIN;
SELECT no_plan();

CREATE FUNCTION pg_temp.sx(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN 'ERR:' || SQLSTATE; END $$;
CREATE FUNCTION pg_temp.q1(q text) RETURNS text LANGUAGE plpgsql AS $$ DECLARE r text; BEGIN EXECUTE q INTO r; RETURN coalesce(r, ''); EXCEPTION WHEN OTHERS THEN RETURN 'ERR:' || SQLSTATE; END $$;
-- runs `pre` (optional) then `q` (a statement returning one text value) as `role` with app.user_id = uid ('' = none)
CREATE FUNCTION pg_temp.run_as(role text, uid text, pre text, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM set_config('app.user_id', uid, true);
  EXECUTE format('SET LOCAL ROLE %I', role);
  IF pre IS NOT NULL THEN EXECUTE pre; END IF;
  EXECUTE q INTO r;
  RESET ROLE;
  PERFORM set_config('app.user_id', '', true);
  RETURN coalesce(r, '');
EXCEPTION WHEN OTHERS THEN RETURN 'ERR:' || SQLSTATE;
END $$;

-- ---------------------------------------------------------------- R1: schema facts (step 1)
SELECT has_column('public', 'invitation', 'claimed_user_id', 'invitation.claimed_user_id exists (mutation: migration 0006 absent)');
SELECT has_column('public', 'invitation', 'claimed_at', 'invitation.claimed_at exists');
SELECT has_column('public', 'user', 'signup_txid', 'user.signup_txid exists (R2 sign-up marker)');
SELECT is((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.user'::regclass AND attname = 'signup_txid'), 'bigint', 'signup_txid is bigint');
SELECT is((SELECT count(*)::int FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'public.user'::regclass AND a.attname = 'signup_txid'), 1, 'signup_txid is indexed');
SELECT is((SELECT count(*)::int FROM pg_index WHERE indrelid = 'public.invitation'::regclass AND indpred IS NOT NULL
    AND pg_get_expr(indpred, indrelid) ~ 'claimed_at IS NULL' AND pg_get_expr(indpred, indrelid) ~ 'revoked_at IS NULL' AND pg_get_indexdef(indexrelid) ~ 'lower\(email'), 1,
  'a partial index on lower(email) WHERE claimed_at IS NULL AND revoked_at IS NULL');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public.invitation'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ~ 'octet_length\(token_hash\) = 32'), 1, 'a check requires octet_length(token_hash) = 32');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public.invitation'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ~ 'claimed_user_id IS NULL\) = \(.*claimed_at IS NULL'), 1, 'the claimed pair check: (claimed_user_id IS NULL) = (claimed_at IS NULL)');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public.invitation'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ~ 'accepted_at IS NULL\) OR \(.*claimed_at IS NOT NULL'), 1, 'accepted implies claimed');

-- ---------------------------------------------------------------- fixtures
SELECT is(pg_temp.sx($f$
  INSERT INTO public."user" (id, name, email, email_verified) VALUES
    ('00000000-0000-4000-8000-0000000000f0', 'Owner', 'owner@qa.test', true),
    ('00000000-0000-4000-8000-0000000000f1', 'U1', 'u1@qa.test', true),
    ('00000000-0000-4000-8000-0000000000f2', 'U2', 'u2@qa.test', true),
    ('00000000-0000-4000-8000-0000000000f4', 'U4', 'u4@qa.test', true),
    ('00000000-0000-4000-8000-0000000000f5', 'U5', 'u5@qa.test', true),
    ('00000000-0000-4000-8000-0000000000f6', 'U6', 'u6@qa.test', false),
    ('00000000-0000-4000-8000-0000000000f7', 'U7', 'u7@qa.test', true),
    ('00000000-0000-4000-8000-0000000000f8', 'Existing', 'p@qa.test', true);
  SELECT set_config('app.user_id', '00000000-0000-4000-8000-0000000000f0', true);
  INSERT INTO public.entity (id, type_id, name, tax_classification) VALUES ('00000000-0000-4000-8000-0000000000e1',
    (SELECT id FROM public.entity_type WHERE system_key = 'business'), 'qa-E', 'business_pass_through');
  SELECT set_config('app.user_id', '', true);
  UPDATE public."user" SET second_step_at = now() WHERE id = '00000000-0000-4000-8000-0000000000f2';
  INSERT INTO public.invitation (id, entity_id, email, role, inviter_user_id, token_hash, expires_at) VALUES
    ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1', 'u1@qa.test', 'viewer', '00000000-0000-4000-8000-0000000000f0', sha256('t1'::bytea), now() + interval '1 day'),
    ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000e1', 'u2@qa.test', 'owner', '00000000-0000-4000-8000-0000000000f0', sha256('t2'::bytea), now() + interval '1 day'),
    ('00000000-0000-4000-8000-0000000000b3', NULL, 'u4@qa.test', 'viewer', NULL, sha256('t3'::bytea), now() + interval '1 day'),
    ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000e1', 'p@qa.test', 'viewer', '00000000-0000-4000-8000-0000000000f0', sha256('t4'::bytea), now() + interval '1 day'),
    ('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000e1', 'u6@qa.test', 'viewer', '00000000-0000-4000-8000-0000000000f0', sha256('t6'::bytea), now() + interval '1 day'),
    ('00000000-0000-4000-8000-0000000000b7', '00000000-0000-4000-8000-0000000000e1', 'u7@qa.test', 'viewer', '00000000-0000-4000-8000-0000000000f0', sha256('t7'::bytea), now() + interval '1 day');
$f$), 'ok', 'fixtures: owner, entity, six users, six invitations (one with no entity)');
-- new users: stamp forged to this transaction. P (Existing) is stamped with an earlier transaction id.
SELECT is(pg_temp.sx($f$
  UPDATE public."user" SET signup_txid = pg_current_xact_id()::text::bigint
    WHERE id IN ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f4',
                 '00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000f7');
  UPDATE public."user" SET signup_txid = pg_current_xact_id()::text::bigint - 1 WHERE id = '00000000-0000-4000-8000-0000000000f8';
$f$), 'ok', 'fixtures: sign-up stamps (mutation: signup_txid absent)');

-- ---------------------------------------------------------------- C15: the membership write path
SELECT is(has_any_column_privilege('poly_app', 'public.membership', 'INSERT'), false, 'C15: poly_app holds no INSERT on membership (POLY-62 R4)');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f1', NULL,
    $q$SELECT app.accept_invitations(sha256('t1'::bytea))::text$q$), '00000000-0000-4000-8000-0000000000e1',
  'C15: accept_invitations seats the new user against their live viewer invitation and returns that entity (mutation: no accept definer)');
SELECT is((SELECT role FROM public.membership WHERE entity_id = '00000000-0000-4000-8000-0000000000e1' AND user_id = '00000000-0000-4000-8000-0000000000f1'), 'viewer', 'C15: seated as viewer');
SELECT isnt((SELECT accepted_at FROM public.invitation WHERE id = '00000000-0000-4000-8000-0000000000b1'), NULL, 'C15: accepted_at set on the seated row');
SELECT is(pg_temp.q1($q$SELECT claimed_user_id::text FROM public.invitation WHERE id = '00000000-0000-4000-8000-0000000000b1'$q$), '00000000-0000-4000-8000-0000000000f1', 'C15: claimed_user_id bound to the new user');
SELECT is(pg_temp.q1($q$SELECT (signup_txid IS NULL)::text FROM public."user" WHERE id = '00000000-0000-4000-8000-0000000000f1'$q$), 'true', 'S13: accept_invitations clears the sign-up stamp before it returns (mutation: the stamp stays)');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f2', NULL,
    $q$SELECT app.accept_invitations(sha256('t2'::bytea))::text$q$), '',
  'C15: an owner invitation is claimed and not seated, even with second_step_at set by a superuser (S6; POLY-89 seats it)');
SELECT is((SELECT count(*)::int FROM public.membership WHERE user_id = '00000000-0000-4000-8000-0000000000f2'), 0, 'C15: no membership for the owner invitee');
SELECT is(pg_temp.q1($q$SELECT claimed_user_id::text FROM public.invitation WHERE id = '00000000-0000-4000-8000-0000000000b2'$q$), '00000000-0000-4000-8000-0000000000f2', 'C15: the owner row is claimed');
SELECT is((SELECT accepted_at FROM public.invitation WHERE id = '00000000-0000-4000-8000-0000000000b2'), NULL, 'C15: and accepted_at stays null');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f5', NULL,
    $q$SELECT app.accept_invitations(sha256('no such token'::bytea))::text$q$), 'ERR:42501', 'C15: no matching live invitation: refused 42501');
SELECT is((SELECT count(*)::int FROM public.membership WHERE user_id = '00000000-0000-4000-8000-0000000000f5'), 0, 'C15: and nothing is seated');
SELECT is(pg_temp.run_as('poly_govern', '00000000-0000-4000-8000-0000000000f5', NULL,
    $q$WITH i AS (INSERT INTO public.membership (entity_id, user_id, role) VALUES ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f5', 'manager') RETURNING 1) SELECT count(*)::text FROM i$q$),
  'ERR:42501', 'S6: the poly_govern INSERT policy on membership seats viewers only (mutation: policy without role = viewer)');
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname COLLATE "C") FROM pg_proc p
    WHERE p.pronamespace = 'app'::regnamespace AND p.prosrc ~* 'insert\s+into\s+("?public"?\.)?"?membership'),
  ARRAY['accept_invitations', 'seat_creator'], 'C15: only seat_creator and accept_invitations insert into membership (body scan)');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE polrelid = 'public.membership'::regclass AND polcmd = 'a'
    AND polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'poly_govern')]::oid[]), 2, 'C15: exactly two poly_govern INSERT policies on membership: seat_creator''s and accept_invitations''');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE polrelid = 'public.membership'::regclass AND polcmd = 'a'
    AND polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'poly_govern')]::oid[]
    AND pg_get_expr(polwithcheck, polrelid) ~ 'viewer' AND pg_get_expr(polwithcheck, polrelid) ~ 'current_user_id'), 1, 'S6: one of them is limited to role = viewer for app.current_user_id()');

-- ---------------------------------------------------------------- S2: token-less accept needs a verified email
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f6', NULL, $q$SELECT app.accept_invitations(NULL)::text$q$), 'ERR:42501',
  'S2: a token-less accept for an unverified email is refused (mutation: the verified check missing)');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f7', NULL, $q$SELECT app.accept_invitations(NULL)::text$q$), '00000000-0000-4000-8000-0000000000e1',
  'S2: a token-less accept for a verified email seats the matching invitation');

-- ---------------------------------------------------------------- C16: no-entity invitations
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f0', NULL, $q$SELECT count(*)::text FROM public.invitation WHERE entity_id IS NULL$q$), '0',
  'C16: a no-entity invitation is visible to no poly_app SELECT policy, not even the entity owner''s (mutation: a policy admits NULL entity)');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f0', NULL,
    $q$WITH u AS (UPDATE public.invitation SET revoked_at = now() WHERE entity_id IS NULL RETURNING 1) SELECT count(*)::text FROM u$q$), '0', 'C16: nor to any poly_app UPDATE policy');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f0', NULL,
    $q$WITH i AS (INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at) VALUES (NULL, 'x@qa.test', 'viewer', '00000000-0000-4000-8000-0000000000f0', sha256('x'::bytea), now() + interval '1 day') RETURNING 1) SELECT count(*)::text FROM i$q$),
  'ERR:42501', 'C16: a poly_app INSERT of a no-entity invitation is refused 42501 (gate_owner_changes)');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f4', NULL, $q$SELECT app.accept_invitations(sha256('t3'::bytea))::text$q$), '',
  'C16: accept_invitations handles the no-entity row: the invitee gets no entity back');
SELECT isnt((SELECT accepted_at FROM public.invitation WHERE id = '00000000-0000-4000-8000-0000000000b3'), NULL, 'C16: the no-entity row is claimed and accepted');
SELECT is((SELECT count(*)::int FROM public.membership WHERE user_id = '00000000-0000-4000-8000-0000000000f4'), 0, 'C16: and seats no membership');

SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f1', NULL, $q$SELECT count(*)::text FROM public.invitation$q$), '0',
  'C16: a viewer seated by an invitation selects 0 rows from invitation, their own claimed row included (mutation: a claimant read policy)');
SELECT is((SELECT array_agg(polname::text ORDER BY polname COLLATE "C") FROM pg_policy
    WHERE polrelid = 'public.invitation'::regclass AND ((SELECT oid FROM pg_roles WHERE rolname = 'poly_app') = ANY (polroles) OR polroles = ARRAY[0]::oid[])),
  ARRAY['invitation_insert', 'invitation_select', 'invitation_update'], 'C16: the policies that apply to poly_app on invitation are exactly invitation_select, invitation_insert, invitation_update');

-- ---------------------------------------------------------------- C17: accept_invitations outside a sign-up transaction
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f8', NULL, $q$SELECT app.accept_invitations(sha256('t4'::bytea))::text$q$), 'ERR:42501',
  'C17: a signed-in existing user (app.user_id set, row inserted by an earlier transaction) is refused (mutation: accept trusts the setting)');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f8', $q$UPDATE public."user" SET name = 'touched' WHERE id = '00000000-0000-4000-8000-0000000000f8'$q$,
    $q$SELECT app.accept_invitations(sha256('t4'::bytea))::text$q$), 'ERR:42501', 'C17: the same forgery after this transaction UPDATEd the row (the xmin test would pass it)');
SELECT is(pg_temp.run_as('poly_app', '', NULL, $q$SELECT app.accept_invitations(sha256('t4'::bytea))::text$q$), 'ERR:42501', 'C17: with no user set at all');
SELECT is((SELECT count(*)::int FROM public.membership WHERE user_id = '00000000-0000-4000-8000-0000000000f8'), 0, 'C17: and no membership is written for the existing user');

-- ---------------------------------------------------------------- C18: the trigger functions
SELECT is((SELECT array_agg(proname::text || ':' || prosecdef ORDER BY proname COLLATE "C") FROM pg_proc WHERE pronamespace = 'app'::regnamespace
    AND proname IN ('stamp_signup_user', 'invitation_set_once', 'signup_stamp_cleared')),
  ARRAY['invitation_set_once:false', 'signup_stamp_cleared:false', 'stamp_signup_user:false'], 'C18: the three trigger functions exist and run as invoker');
SELECT ok(pg_temp.sx('SELECT app.stamp_signup_user()') <> 'ok' AND pg_temp.sx('SELECT app.invitation_set_once()') <> 'ok' AND pg_temp.sx('SELECT app.signup_stamp_cleared()') <> 'ok'
    AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'stamp_signup_user' AND pronamespace = 'app'::regnamespace), 'C18: calling a trigger function directly fails (and the function exists)');
SELECT ok(pg_temp.run_as('poly_app', '', NULL, $q$SELECT app.stamp_signup_user()::text$q$) IN ('ERR:42501', 'ERR:0A000')
    AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'stamp_signup_user' AND pronamespace = 'app'::regnamespace), 'C18: poly_app cannot call it either');
SELECT is((SELECT array_agg(proname::text || ':' || pg_get_userbyid(proowner) ORDER BY proname COLLATE "C") FROM pg_proc WHERE pronamespace = 'app'::regnamespace
    AND proname IN ('enter_new_user', 'claim_invitations', 'accept_invitations')),
  ARRAY['accept_invitations:poly_govern', 'claim_invitations:poly_govern', 'enter_new_user:poly_authz'], 'C18: definer owners per R2');
SELECT is((SELECT array_agg(g ORDER BY g COLLATE "C") FROM (SELECT p.proname::text || '=>' || pg_get_userbyid(a.grantee) AS g
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.pronamespace = 'app'::regnamespace AND p.proname IN ('enter_new_user', 'claim_invitations', 'accept_invitations') AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) x),
  ARRAY['accept_invitations=>poly_app', 'claim_invitations=>poly_app', 'enter_new_user=>poly_app'], 'C18: EXECUTE goes to poly_app alone, not PUBLIC');
SELECT is((SELECT array_agg(proname::text ORDER BY proname COLLATE "C") FROM pg_proc WHERE pronamespace = 'app'::regnamespace
    AND proname IN ('enter_new_user', 'claim_invitations', 'accept_invitations') AND prosecdef AND 'search_path=""' = ANY (proconfig)),
  ARRAY['accept_invitations', 'claim_invitations', 'enter_new_user'], 'C18: SECURITY DEFINER with search_path = ''''');

-- ---------------------------------------------------------------- C19: token_hash
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f0', NULL, $q$SELECT count(token_hash)::text FROM public.invitation$q$), 'ERR:42501', 'C19: poly_app selecting invitation.token_hash is refused 42501');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f0', NULL,
    $q$WITH i AS (INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at) VALUES ('00000000-0000-4000-8000-0000000000e1', 'short@qa.test', 'viewer', '00000000-0000-4000-8000-0000000000f0', decode(repeat('ab', 31), 'hex'), now() + interval '1 day') RETURNING 1) SELECT count(*)::text FROM i$q$),
  'ERR:23514', 'C19: a 31-byte token_hash fails the length check (23514)');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f0', NULL,
    $q$WITH i AS (INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at) VALUES ('00000000-0000-4000-8000-0000000000e1', 'full@qa.test', 'viewer', '00000000-0000-4000-8000-0000000000f0', sha256('full'::bytea), now() + interval '1 day') RETURNING 1) SELECT count(*)::text FROM i$q$),
  '1', 'C19 control: a 32-byte token_hash from an owner is accepted, so the 23514 above is the length check');
SELECT ok(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f0', NULL, $q$SELECT (count(claimed_user_id) + count(claimed_at))::text FROM public.invitation$q$) !~ '^ERR',
  'R2: poly_app can SELECT (claimed_user_id, claimed_at) on invitation');

-- ---------------------------------------------------------------- C29/C30: claim_invitations
SELECT is((SELECT pg_get_function_result(oid) FROM pg_proc WHERE pronamespace = 'app'::regnamespace AND proname = 'claim_invitations'), 'void', 'C30: claim_invitations returns void (no oracle in its result)');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f8', NULL, $q$SELECT app.claim_invitations(sha256('t4'::bytea), 'p@qa.test')::text$q$), 'ERR:42501',
  'C30: claim_invitations with app.user_id set raises 42501 (mutation: no signed-in check)');
SELECT is(pg_temp.run_as('poly_app', '', NULL, $q$SELECT app.claim_invitations(sha256('t4'::bytea), 'p@qa.test')::text$q$), '',
  'C30 control: the same claim with no user set succeeds, so the 42501 above is the setting check');
SELECT is(pg_temp.run_as('poly_app', '', NULL, $q$SELECT app.claim_invitations(sha256('t4'::bytea), 'someone.else@qa.test')::text$q$), 'ERR:42501', 'C29: a mismatched email is refused 42501');
SELECT is(pg_temp.run_as('poly_app', '', NULL, $q$SELECT app.claim_invitations(sha256('unknown'::bytea), 'p@qa.test')::text$q$), 'ERR:42501', 'C29: an unknown token is refused 42501');
SELECT is(pg_temp.run_as('poly_app', '', NULL, $q$SELECT app.claim_invitations(NULL, 'u1@qa.test')::text$q$), 'ERR:42501', 'C29: a token-less claim for an email whose invitation is already claimed is refused');

-- ---------------------------------------------------------------- C31: set once
SELECT is(pg_temp.sx($f$UPDATE public.invitation SET revoked_at = now() WHERE id = '00000000-0000-4000-8000-0000000000b6'$f$), 'ok', 'fixture: revoke b6 (a first set is allowed)');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f0', NULL,
    $q$WITH u AS (UPDATE public.invitation SET revoked_at = now() + interval '1 day' WHERE id = '00000000-0000-4000-8000-0000000000b6' RETURNING 1) SELECT count(*)::text FROM u$q$),
  'ERR:42501', 'C31: poly_app cannot change revoked_at once set (mutation: invitation_set_once absent)');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f0', NULL,
    $q$WITH u AS (UPDATE public.invitation SET revoked_at = NULL WHERE id = '00000000-0000-4000-8000-0000000000b6' RETURNING 1) SELECT count(*)::text FROM u$q$),
  'ERR:42501', 'C31: nor clear it');
SELECT is(pg_temp.run_as('poly_govern', '00000000-0000-4000-8000-0000000000f1', NULL,
    $q$WITH u AS (UPDATE public.invitation SET claimed_at = now() + interval '1 day' WHERE id = '00000000-0000-4000-8000-0000000000b1' RETURNING 1) SELECT count(*)::text FROM u$q$),
  'ERR:42501', 'C31: poly_govern cannot move claimed_at once set (the policy would admit it: claimed_user_id is unchanged)');
SELECT is(pg_temp.run_as('poly_govern', '00000000-0000-4000-8000-0000000000f1', NULL,
    $q$WITH u AS (UPDATE public.invitation SET accepted_at = now() + interval '1 day' WHERE id = '00000000-0000-4000-8000-0000000000b1' RETURNING 1) SELECT count(*)::text FROM u$q$),
  'ERR:42501', 'C31: poly_govern cannot move accepted_at once set');
SELECT is(pg_temp.run_as('poly_govern', '00000000-0000-4000-8000-0000000000f1', NULL,
    $q$WITH u AS (UPDATE public.invitation SET claimed_user_id = NULL WHERE id = '00000000-0000-4000-8000-0000000000b1' RETURNING 1) SELECT count(*)::text FROM u$q$),
  'ERR:42501', 'C31: nor claimed_user_id');

-- ---------------------------------------------------------------- C32 (S13): the stamp
SELECT is(pg_temp.q1($q$SELECT coalesce(string_agg(rolname::text, ',' ORDER BY rolname COLLATE "C"), '') FROM pg_roles WHERE has_column_privilege(oid, 'public.user', 'signup_txid', 'UPDATE') AND NOT rolsuper AND rolname NOT LIKE 'pg\_%' AND oid <> (SELECT relowner FROM pg_class WHERE oid = 'public.user'::regclass)$q$), 'poly_govern', 'C32: only poly_govern may UPDATE user.signup_txid');
SELECT is(pg_temp.q1($q$SELECT coalesce(string_agg(rolname::text, ',' ORDER BY rolname COLLATE "C"), '') FROM pg_roles WHERE has_column_privilege(oid, 'public.user', 'signup_txid', 'INSERT') AND NOT rolsuper AND rolname NOT LIKE 'pg\_%' AND oid <> (SELECT relowner FROM pg_class WHERE oid = 'public.user'::regclass)$q$), '', 'C32: nobody may INSERT user.signup_txid');
SELECT is((SELECT count(*)::int FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE p.proname = 'signup_stamp_cleared' AND t.tgrelid = 'public.user'::regclass AND t.tgdeferrable AND t.tginitdeferred AND t.tgconstraint <> 0), 1,
  'C32: signup_stamp_cleared is a DEFERRABLE INITIALLY DEFERRED constraint trigger on user');
SELECT is(pg_temp.run_as('poly_app', '', NULL, $q$SELECT app.enter_new_user('00000000-0000-4000-8000-0000000000f8')::text$q$), 'ERR:42501',
  'C32: a row stamped with another transaction''s id (a restored row) passes neither enter_new_user...');
SELECT is(pg_temp.sx($f$UPDATE public."user" SET signup_txid = pg_current_xact_id()::text::bigint + 50 WHERE id = '00000000-0000-4000-8000-0000000000f8'$f$), 'ok', 'fixture: a future stamp');
SELECT is(pg_temp.run_as('poly_app', '', NULL, $q$SELECT app.enter_new_user('00000000-0000-4000-8000-0000000000f8')::text$q$), 'ERR:42501', 'C32: ...a future stamp passes neither enter_new_user...');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000000f8', NULL, $q$SELECT app.accept_invitations(sha256('t4'::bytea))::text$q$), 'ERR:42501', 'C32: ...nor accept_invitations');

-- ---------------------------------------------------------------- C23 (pgTAP part): no way to write an invitation or a user except poly_app
SELECT is((SELECT array_agg(rolname::text ORDER BY rolname COLLATE "C") FROM pg_roles
    WHERE has_any_column_privilege(oid, 'public.invitation', 'INSERT') AND NOT rolsuper AND rolname NOT LIKE 'pg\_%' AND oid <> (SELECT relowner FROM pg_class WHERE oid = 'public.invitation'::regclass)),
  ARRAY['poly_app', 'poly_govern'], 'C23 (as changed by POLY-142 C15): INSERT on invitation is held by poly_app (owner policy) and poly_govern (invitation_operator_issue) alone');
SELECT is((SELECT array_agg(proname::text ORDER BY proname COLLATE "C") FROM pg_proc WHERE pronamespace = 'app'::regnamespace
    AND prosrc ~* 'insert\s+into\s+("?public"?\.)?"?invitation"?([^a-z_]|$)'), ARRAY['issue_operator_invitation'],
  'C23 (POLY-142): only issue_operator_invitation inserts into invitation (pg_proc source scan, S11)');
SELECT is((SELECT array_agg(proname::text ORDER BY proname COLLATE "C") FROM pg_proc WHERE pronamespace = 'app'::regnamespace
    AND prosrc ~* 'insert\s+into\s+("?public"?\.)?"?user"?([^a-z_]|$)'), NULL::text[],
  'C23: no function in schema app inserts into user (pg_proc source scan, S11)');

SELECT * FROM finish();
ROLLBACK;
