-- POLY-142 (ruling R1, R2, conditions 12-15 and addendum 1 G1). One transaction, rolled back. Same harness as 05: fixtures as
-- superuser through pg_temp.sx(); a login role's view through pg_temp.run_as(), which returns 'ERR:<sqlstate>' on failure so a
-- missing migration is one "not ok" per assertion. Each message names the mutation that turns it red.
BEGIN;
SELECT no_plan();

CREATE FUNCTION pg_temp.sx(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN 'ERR:' || SQLSTATE; END $$;
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
-- the issuing call as SQL text, returning the new invitation id
CREATE FUNCTION pg_temp.issue(email text, bootstrap boolean) RETURNS text LANGUAGE sql AS
  $$SELECT format($q$SELECT (app.issue_operator_invitation(%L, sha256(%L::bytea), %L)).o_invitation_id::text$q$, email, email, bootstrap)$$;

-- ---------------------------------------------------------------- R1: schema facts
SELECT has_column('public', 'invitation', 'issued_via', 'R1: invitation.issued_via exists (mutation: migration 0008 absent)');
SELECT is((SELECT format_type(atttypid, atttypmod) || ':' || attnotnull::text FROM pg_attribute WHERE attrelid = 'public.invitation'::regclass AND attname = 'issued_via'), 'text:true', 'R1: issued_via is text NOT NULL');
SELECT is((SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = 'public.invitation'::regclass AND a.attname = 'issued_via'), '''owner''::text', 'R1: issued_via defaults to ''owner'' (an owner-issued row never names it)');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public.invitation'::regclass AND conname = 'invitation_issued_via_check' AND pg_get_constraintdef(oid) ~ 'owner.*operator.*bootstrap'), 1, 'R1: invitation_issued_via_check admits owner, operator, bootstrap');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public.invitation'::regclass AND conname = 'invitation_operator_shape_check'), 1, 'R1: invitation_operator_shape_check exists');
SELECT is((SELECT count(*)::int FROM pg_index WHERE indexrelid = to_regclass('public.invitation_one_live_bootstrap') AND indisunique AND pg_get_expr(indpred, indrelid) ~ 'bootstrap' AND pg_get_expr(indpred, indrelid) ~ 'claimed_at IS NULL' AND pg_get_expr(indpred, indrelid) ~ 'revoked_at IS NULL'), 1, 'R1: invitation_one_live_bootstrap is a unique partial index on live bootstrap rows');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE polrelid = 'public.invitation'::regclass AND polname IN ('invitation_bootstrap_revoke', 'invitation_operator_issue')), 2, 'R1: both new poly_govern policies exist by name');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE polrelid = 'public.invitation'::regclass AND polname = 'invitation_operator_issue'
    AND pg_get_expr(polwithcheck, polrelid) ~ 'entity_id IS NULL' AND pg_get_expr(polwithcheck, polrelid) ~ 'inviter_user_id IS NULL' AND pg_get_expr(polwithcheck, polrelid) ~ 'current_user_id\(\) IS NULL' AND pg_get_expr(polwithcheck, polrelid) ~ 'viewer'), 1,
  'R1: invitation_operator_issue checks no entity, no inviter, viewer, and no user context');
SELECT ok(coalesce((SELECT prosrc ~ 'issued_via' FROM pg_proc WHERE proname = 'claim_invitations' AND pronamespace = 'app'::regnamespace), false)
  AND coalesce((SELECT prosrc ~ 'issued_via' FROM pg_proc WHERE proname = 'accept_invitations' AND pronamespace = 'app'::regnamespace), false), 'R2: claim_invitations and accept_invitations carry the bootstrap predicate');

-- ---------------------------------------------------------------- C12: the definer (catalog)
SELECT is((SELECT pg_get_userbyid(proowner)::text FROM pg_proc WHERE proname = 'issue_operator_invitation' AND pronamespace = 'app'::regnamespace), 'poly_govern', 'C12: owner is poly_govern');
SELECT is((SELECT coalesce(string_agg(pg_get_userbyid(a.grantee)::text, ',' ORDER BY pg_get_userbyid(a.grantee)::text), '') FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.proname = 'issue_operator_invitation' AND p.pronamespace = 'app'::regnamespace AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner AND a.grantee <> 0), 'poly_operator', 'C12/POLY-146: EXECUTE is held by poly_operator alone (mutation: poly_worker keeps its grant)');
SELECT is((SELECT count(*)::int FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.proname = 'issue_operator_invitation' AND p.pronamespace = 'app'::regnamespace AND a.grantee = 0), 0, 'C12: not executable by PUBLIC');
SELECT ok(coalesce((SELECT 'search_path=""' = ANY (proconfig) AND 'lock_timeout=2s' = ANY (proconfig) FROM pg_proc WHERE proname = 'issue_operator_invitation' AND pronamespace = 'app'::regnamespace), false), 'C12/R2: search_path is '''' and lock_timeout is 2s');
SELECT ok(coalesce((SELECT prosrc ~ 'pg_advisory_xact_lock' FROM pg_proc WHERE proname = 'issue_operator_invitation' AND pronamespace = 'app'::regnamespace), false), 'R2 step 3: the body takes the advisory lock');

-- ---------------------------------------------------------------- C12: behaviour, instance still empty
SELECT is((SELECT count(*)::int FROM public."user"), 0, 'precondition: the pgTAP database holds no user');
SELECT is(pg_temp.run_as('poly_operator', '', NULL, pg_temp.issue('plain@qa.test', false)), 'ERR:55000', 'R2 step 5: a plain invite on an empty instance raises 55000 (mutation: the empty check is missing)');
SELECT is(pg_temp.run_as('poly_operator', '', 'SELECT set_config(''app.actor'', ''system:x'', true)', pg_temp.issue('boot1@qa.test', true)) ~ '^[0-9a-f-]{36}$', true, 'C12: with app.actor forged to system:x and no user, the call succeeds');
SELECT is((SELECT actor FROM public.audit_event WHERE kind = 'invitation.issued'), 'operator:cli', 'C12/O5: the audit actor is the literal operator:cli, not the forged setting (mutation: the definer reads app.actor)');
SELECT is((SELECT (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(payload) k) FROM public.audit_event WHERE kind = 'invitation.issued'), 'invitation_id,issued_via', 'O5: the payload is exactly {invitation_id, issued_via}');
SELECT is((SELECT entity_id IS NULL AND actor_user_id IS NULL AND subject_user_id IS NULL FROM public.audit_event WHERE kind = 'invitation.issued'), true, 'O5: entity_id, actor_user_id and subject_user_id are null');
SELECT is((SELECT issued_via || ':' || role || ':' || (entity_id IS NULL)::text || ':' || (inviter_user_id IS NULL)::text FROM public.invitation WHERE email = 'boot1@qa.test'), 'bootstrap:viewer:true:true', 'R2 step 6: the row is a bootstrap viewer with no entity and no inviter');
SELECT is((SELECT expires_at - created_at = interval '7 days' FROM public.invitation WHERE email = 'boot1@qa.test'), true, 'R2 step 6: 7-day expiry');
-- a second bootstrap revokes the first, with its own audit row
SELECT is(pg_temp.run_as('poly_operator', '', NULL, pg_temp.issue('boot2@qa.test', true)) ~ '^[0-9a-f-]{36}$', true, 'C4: a second bootstrap succeeds');
SELECT is((SELECT count(*)::int FROM public.invitation WHERE issued_via = 'bootstrap' AND claimed_at IS NULL AND revoked_at IS NULL), 1, 'C4: exactly one live bootstrap row');
SELECT is((SELECT (revoked_at IS NOT NULL) FROM public.invitation WHERE email = 'boot1@qa.test'), true, 'C4: the first bootstrap row is revoked');
SELECT is((SELECT count(*)::int FROM public.audit_event WHERE kind = 'invitation.revoked'), 1, 'O5: one invitation.revoked audit row (mutation: revoke not audited)');
-- bad addresses: 22023 (NUL cannot be written in a text literal; the TS test covers it)
SELECT is(pg_temp.run_as('poly_operator', '', NULL, format($q$SELECT (app.issue_operator_invitation(%L, sha256('h'::bytea), true)).o_invitation_id::text$q$, a)), 'ERR:22023', 'O10: refused with 22023: ' || quote_literal(left(a, 12)))
  FROM unnest(ARRAY[repeat('a', 251) || '@b.c', 'a' || chr(13) || 'b@c.d', 'a' || chr(10) || 'b@c.d', 'a b@c.d', 'a' || chr(127) || 'b@c.d', 'nodomain', 'a@@b.c', 'a@b@c.d', '@b.c', 'a@', '']) a;
SELECT is((SELECT count(*)::int FROM public.invitation), 2, 'O10: no bad address left a row');
SELECT is(pg_temp.run_as('poly_operator', '', NULL, pg_temp.issue('UPPER@QA.TEST', true)) ~ '^[0-9a-f-]{36}$', true, 'fixture: an upper-case address is accepted');
SELECT is((SELECT count(*)::int FROM public.invitation WHERE email = 'upper@qa.test'), 1, 'O10: the row stores lower(email)');

-- ---------------------------------------------------------------- fixtures: users and an entity
SELECT is(pg_temp.sx($f$
  INSERT INTO public."user" (id, name, email, email_verified) VALUES
    ('00000000-0000-4000-8000-0000000142f0', 'Owner', 'owner142@qa.test', true),
    ('00000000-0000-4000-8000-0000000142f1', 'Claimant', 'claimant142@qa.test', true);
  SELECT set_config('app.user_id', '00000000-0000-4000-8000-0000000142f0', true);
  INSERT INTO public.entity (id, type_id, name, tax_classification) VALUES ('00000000-0000-4000-8000-0000000142e1',
    (SELECT id FROM public.entity_type WHERE system_key = 'business'), 'qa-E142', 'business_pass_through');
  SELECT set_config('app.user_id', '', true);
$f$), 'ok', 'fixture: two users and an entity');

-- ---------------------------------------------------------------- C12: who may call (instance now non-empty)
SELECT is(pg_temp.run_as('poly_worker', '', NULL, pg_temp.issue('xw@qa.test', false)), 'ERR:42501', 'POLY-146 AC4: poly_worker is refused 42501 (mutation: EXECUTE not revoked from poly_worker)');
SELECT is(pg_temp.run_as('poly_worker', '', NULL, pg_temp.issue('xw@qa.test', true)), 'ERR:42501', 'POLY-146 AC4: ...for bootstrap too');
SELECT is((SELECT count(*)::int FROM public.invitation WHERE email = 'xw@qa.test'), 0, 'POLY-146 AC4: the refused worker call left no row');
SELECT is(pg_temp.run_as('poly_operator', '', NULL, pg_temp.issue('x1@qa.test', false)) ~ '^[0-9a-f-]{36}$', true, 'C2: a plain invite on a non-empty instance succeeds');
SELECT is((SELECT issued_via FROM public.invitation WHERE email = 'x1@qa.test'), 'operator', 'C2: issued_via is operator');
SELECT is(pg_temp.run_as('poly_operator', '', NULL, pg_temp.issue('x2@qa.test', true)), 'ERR:55000', 'R2 step 4: bootstrap on a non-empty instance raises 55000');
SELECT is((SELECT count(*)::int FROM public.invitation WHERE issued_via = 'bootstrap' AND claimed_at IS NULL AND revoked_at IS NULL), 1, 'R2 step 4: the refusal rolled the revoke back (one live bootstrap row remains; mutation: the revoke commits before the user check)');
SELECT is((SELECT count(*)::int FROM public.audit_event WHERE kind = 'invitation.revoked'), 2, 'R2 step 4: ...and no extra revoked audit row survived (two: boot1, then boot2 revoked by the UPPER@QA.TEST bootstrap; the refused x2 call added none)');
SELECT is(pg_temp.run_as('poly_operator', '00000000-0000-4000-8000-0000000142f1', NULL, pg_temp.issue('x3@qa.test', false)), 'ERR:42501', 'O2: a forged app.user_id (a withSystem- or tenant-shaped context) is refused 42501 (mutation: the user-context check is missing)');
SELECT is(pg_temp.run_as('poly_operator', '00000000-0000-4000-8000-0000000142f1', NULL, pg_temp.issue('x3@qa.test', true)), 'ERR:42501', 'O2: ...for bootstrap too, before the state check');
SELECT is(pg_temp.run_as('poly_operator', '', 'SELECT set_config(''app.user_id'', ''00000000-0000-4000-8000-0000000142f1'', true)', pg_temp.issue('x4@qa.test', false)), 'ERR:42501', 'O2: app.user_id set after the role switch, same refusal');
SELECT is(pg_temp.run_as('poly_app', '', NULL, pg_temp.issue('x5@qa.test', false)), 'ERR:42501', 'C12: poly_app lacks EXECUTE');
SELECT is(pg_temp.run_as('poly_govern', '', NULL, pg_temp.issue('x5@qa.test', false)), 'ERR:42501', 'C12: poly_govern lacks EXECUTE');
SELECT is(pg_temp.run_as('poly_authz', '', NULL, pg_temp.issue('x5@qa.test', false)), 'ERR:42501', 'C12: poly_authz lacks EXECUTE');
SELECT is((SELECT count(*)::int FROM public.invitation WHERE email IN ('x3@qa.test', 'x4@qa.test', 'x5@qa.test')), 0, 'C12: no refused call left a row');

-- ---------------------------------------------------------------- C13: grants and shape
SELECT is((SELECT bool_or(CASE WHEN p = 'DELETE' THEN has_table_privilege('poly_worker', t, p) ELSE has_table_privilege('poly_worker', t, p) OR has_any_column_privilege('poly_worker', t, p) END) FROM unnest(ARRAY['public.invitation', 'public.audit_event']) t, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) p), false, 'C13: poly_worker holds no INSERT/UPDATE/DELETE on invitation or audit_event, table or column (mutation: a direct grant)');
SELECT is((SELECT string_agg(attname::text, ',' ORDER BY attname COLLATE "C") FROM pg_attribute WHERE attrelid = 'public.invitation'::regclass AND attnum > 0 AND NOT attisdropped AND has_column_privilege('poly_govern', attrelid, attnum, 'INSERT')),
  'email,expires_at,issued_via,role,token_hash', 'C13: poly_govern''s INSERT columns on invitation are exactly email, role, token_hash, expires_at, issued_via');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000142f0',
    NULL, $q$INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at, issued_via) VALUES ('00000000-0000-4000-8000-0000000142e1', 'ia@qa.test', 'viewer', '00000000-0000-4000-8000-0000000142f0', sha256('ia'::bytea), now() + interval '1 day', 'operator') RETURNING 'x'$q$),
  'ERR:42501', 'C13: a poly_app INSERT that supplies issued_via is refused 42501 (mutation: issued_via added to poly_app''s column grant)');
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000142f0',
    NULL, $q$INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at) VALUES ('00000000-0000-4000-8000-0000000142e1', 'ib@qa.test', 'viewer', '00000000-0000-4000-8000-0000000142f0', sha256('ib'::bytea), now() + interval '1 day') RETURNING issued_via$q$),
  'owner', 'C13: an owner-issued row reads issued_via = owner');
SELECT is((SELECT coalesce(string_agg(rolname::text, ',' ORDER BY rolname COLLATE "C"), '') FROM pg_roles WHERE has_column_privilege(oid, 'public.invitation', 'issued_via', 'UPDATE') AND NOT rolsuper AND rolname NOT LIKE 'pg\_%' AND oid <> (SELECT relowner FROM pg_class WHERE oid = 'public.invitation'::regclass)), '', 'C13: no role can UPDATE issued_via');
SELECT is(pg_temp.sx($f$INSERT INTO public.invitation (entity_id, email, role, token_hash, expires_at, issued_via) VALUES ('00000000-0000-4000-8000-0000000142e1', 'sh1@qa.test', 'viewer', sha256('sh1'::bytea), now() + interval '1 day', 'operator')$f$), 'ERR:23514', 'C13: an operator row with an entity_id fails 23514');
SELECT is(pg_temp.sx($f$INSERT INTO public.invitation (email, role, inviter_user_id, token_hash, expires_at, issued_via) VALUES ('sh2@qa.test', 'viewer', '00000000-0000-4000-8000-0000000142f0', sha256('sh2'::bytea), now() + interval '1 day', 'operator')$f$), 'ERR:23514', 'C13: an operator row with an inviter_user_id fails 23514');
SELECT is(pg_temp.sx($f$INSERT INTO public.invitation (email, role, token_hash, expires_at, issued_via) VALUES ('sh3@qa.test', 'owner', sha256('sh3'::bytea), now() + interval '1 day', 'operator')$f$), 'ERR:23514', 'C13: an operator row with role owner fails 23514');
SELECT is(pg_temp.sx($f$INSERT INTO public.invitation (email, role, token_hash, expires_at, issued_via) VALUES ('sh4@qa.test', 'viewer', sha256('sh4'::bytea), now() + interval '1 day', 'bootstrap')$f$), 'ERR:23505', 'C13: a second live bootstrap row fails 23505 (mutation: the unique index is missing)');
SELECT is(pg_temp.sx($f$INSERT INTO public.invitation (email, role, token_hash, expires_at, issued_via) VALUES ('sh5@qa.test', 'viewer', sha256('sh5'::bytea), now() + interval '1 day', 'other')$f$), 'ERR:23514', 'C13: an unknown issued_via fails 23514');
SELECT is(pg_temp.sx($f$INSERT INTO public.invitation (email, role, inviter_user_id, entity_id, token_hash, expires_at, issued_via) VALUES ('sh6@qa.test', 'viewer', '00000000-0000-4000-8000-0000000142f0', '00000000-0000-4000-8000-0000000142e1', sha256('sh6'::bytea), now() + interval '1 day', 'owner')$f$), 'ok', 'R1/O3: the shape check is one-directional, an owner row keeps its entity and inviter');
SELECT is(pg_temp.sx($f$INSERT INTO public.invitation (email, role, inviter_user_id, token_hash, expires_at) VALUES ('sh7@qa.test', 'viewer', '00000000-0000-4000-8000-0000000142f0', sha256('sh7'::bytea), now() + interval '1 day')$f$), 'ok', 'R1/O3 (room for POLY-144): a no-entity row with an inviter is admitted when issued_via = owner');

-- ---------------------------------------------------------------- C14: revocation scope (app.user_id empty, G1)
SELECT is(pg_temp.sx($f$INSERT INTO public.invitation (id, email, role, token_hash, expires_at, issued_via, claimed_user_id, claimed_at) VALUES ('00000000-0000-4000-8000-0000000142b1', 'cb@qa.test', 'viewer', sha256('cb'::bytea), now() + interval '1 day', 'bootstrap', '00000000-0000-4000-8000-0000000142f1', now())$f$), 'ok', 'fixture: a claimed bootstrap row (not live, so the unique index admits it)');
SELECT is(pg_temp.sx($f$INSERT INTO public.invitation (id, email, role, token_hash, expires_at, issued_via) VALUES ('00000000-0000-4000-8000-0000000142b2', 'op@qa.test', 'viewer', sha256('op'::bytea), now() + interval '1 day', 'operator')$f$), 'ok', 'fixture: a live operator row');
SELECT isnt(pg_temp.run_as('poly_govern', '', NULL, $q$WITH u AS (UPDATE public.invitation SET revoked_at = now() WHERE id = '00000000-0000-4000-8000-0000000142b2' RETURNING 1) SELECT count(*)::text FROM u$q$), '1', 'C14: poly_govern cannot revoke a non-bootstrap row (mutation: the policy lacks issued_via = bootstrap)');
SELECT is((SELECT revoked_at IS NULL FROM public.invitation WHERE id = '00000000-0000-4000-8000-0000000142b2'), true, 'C14: ...the operator row is still unrevoked');
SELECT isnt(pg_temp.run_as('poly_govern', '', NULL, $q$WITH u AS (UPDATE public.invitation SET revoked_at = now() WHERE id = '00000000-0000-4000-8000-0000000142b1' RETURNING 1) SELECT count(*)::text FROM u$q$), '1', 'C14: poly_govern cannot revoke a claimed bootstrap row (mutation: the policy lacks claimed_at IS NULL)');
SELECT is((SELECT revoked_at IS NULL FROM public.invitation WHERE id = '00000000-0000-4000-8000-0000000142b1'), true, 'C14: ...the claimed row is still unrevoked');
SELECT is(pg_temp.run_as('poly_govern', '', NULL, $q$WITH u AS (UPDATE public.invitation SET revoked_at = now() WHERE issued_via = 'bootstrap' AND claimed_at IS NULL AND revoked_at IS NULL RETURNING 1) SELECT count(*)::text FROM u$q$), '1', 'C14: poly_govern can revoke the live unclaimed bootstrap row (positive control)');
SELECT is(pg_temp.sx($f$UPDATE public.invitation SET revoked_at = NULL WHERE issued_via = 'bootstrap' AND revoked_at IS NOT NULL$f$), 'ERR:42501', 'C14: set-once still refuses un-revoking (S10)');

-- ---------------------------------------------------------------- C15 (pgTAP part): closure
SELECT is((SELECT array_agg(rolname::text ORDER BY rolname COLLATE "C") FROM pg_roles
    WHERE has_any_column_privilege(oid, 'public.invitation', 'INSERT') AND NOT rolsuper AND rolname NOT LIKE 'pg\_%' AND oid <> (SELECT relowner FROM pg_class WHERE oid = 'public.invitation'::regclass)),
  ARRAY['poly_app', 'poly_govern'], 'C15: INSERT on invitation is held by poly_app and poly_govern alone');
SELECT is((SELECT array_agg(proname::text ORDER BY proname COLLATE "C") FROM pg_proc WHERE pronamespace = 'app'::regnamespace
    AND prosrc ~* 'insert\s+into\s+("?public"?\.)?"?invitation"?([^a-z_]|$)'), ARRAY['issue_operator_invitation'], 'C15: exactly one app function inserts into invitation');
SELECT is((SELECT array_agg(proname::text ORDER BY proname COLLATE "C") FROM pg_proc WHERE pronamespace = 'app'::regnamespace
    AND prosrc ~* 'insert\s+into\s+("?public"?\.)?"?user"?([^a-z_]|$)'), NULL::text[], 'C15: no app function inserts into user');
SELECT is((SELECT array_agg(proname::text ORDER BY proname COLLATE "C") FROM pg_proc WHERE pronamespace = 'app'::regnamespace
    AND prosrc ~* 'set\s[^;]*revoked_at\s*='), ARRAY['issue_operator_invitation'], 'G1/C15: exactly one app function writes revoked_at');

-- ---------------------------------------------------------------- C13 (POLY-146 AC3): poly_operator, catalog-exact (ruling R2)
SELECT results_eq($$SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolconnlimit, rolinherit FROM pg_roles WHERE rolname = 'poly_operator'$$,
  $$VALUES (true, false, false, false, false, false, -1, true)$$, 'POLY-146 AC3: poly_operator is LOGIN with the five NOs and no CONNECTION LIMIT (mutation: role missing or over-privileged)');
SELECT is((SELECT count(*)::int FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'poly_operator'), 0, 'POLY-146 AC3: no per-role settings');
SELECT is((SELECT count(*)::int FROM pg_auth_members m, pg_roles r WHERE r.rolname = 'poly_operator' AND (m.member = r.oid OR m.roleid = r.oid)), 0, 'POLY-146 AC3: poly_operator is in no role and holds no member (mutation: a membership grants the issuer or more)');
SELECT is((SELECT coalesce(string_agg(a.privilege_type, ',' ORDER BY a.privilege_type), '') FROM pg_database d, aclexplode(d.datacl) a WHERE d.datname = current_database() AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'poly_operator')), 'CONNECT', 'POLY-146 AC3: the database ACL gives poly_operator CONNECT and nothing else');
SELECT is((SELECT coalesce(string_agg(n.nspname || ':' || a.privilege_type, ',' ORDER BY n.nspname, a.privilege_type), '') FROM pg_namespace n, aclexplode(n.nspacl) a WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'poly_operator')), 'app:USAGE', 'POLY-146 AC3: the only schema ACL entry for poly_operator is USAGE on app (mutation: USAGE on public or drizzle)');
SELECT is((SELECT coalesce(string_agg(p.oid::regprocedure::text, ',' ORDER BY p.oid::regprocedure::text), '') FROM pg_proc p, aclexplode(p.proacl) a WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'poly_operator') AND a.privilege_type = 'EXECUTE'), 'app.issue_operator_invitation(text,bytea,boolean)', 'POLY-146 AC3: EXECUTE on the issuer alone');
SELECT is((SELECT count(*)::int FROM pg_class c, aclexplode(c.relacl) a WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'poly_operator')), 0, 'POLY-146 AC3: no relation or sequence ACL entry names poly_operator');
SELECT is((SELECT count(*)::int FROM pg_attribute at, aclexplode(at.attacl) a WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'poly_operator')), 0, 'POLY-146 AC3: no column ACL entry names poly_operator');
SELECT is((SELECT count(*)::int FROM pg_default_acl d, aclexplode(d.defaclacl) a WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'poly_operator')), 0, 'POLY-146 AC3: no default ACL names poly_operator');
SELECT is((SELECT count(*)::int FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = 'poly_operator')) + (SELECT count(*)::int FROM pg_proc WHERE proowner = (SELECT oid FROM pg_roles WHERE rolname = 'poly_operator')), 0, 'POLY-146 AC3: poly_operator owns nothing');
SELECT is((SELECT count(*)::int FROM pg_policy p WHERE (SELECT oid FROM pg_roles WHERE rolname = 'poly_operator') = ANY (p.polroles)), 0, 'POLY-146 AC3: no policy names poly_operator');
SELECT is(pg_temp.run_as('poly_operator', '', NULL, $q$SELECT count(*)::text FROM public.invitation$q$), 'ERR:42501', 'POLY-146 AC3: poly_operator cannot read invitation');
SELECT is(pg_temp.run_as('poly_operator', '', NULL, $q$SELECT count(*)::text FROM drizzle.__drizzle_migrations$q$), 'ERR:42501', 'POLY-146 AC3: poly_operator cannot read the migrations table');

SELECT * FROM finish();
ROLLBACK;
