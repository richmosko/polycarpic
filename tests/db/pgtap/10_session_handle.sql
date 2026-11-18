-- POLY-153 (ruling R1, R2, R3, R5.2, R6; seceng §2.2 / T6): the session handle's catalog. app.session_handle is poly_authz's alone;
-- poly_app gains four EXECUTEs and poly_auth one; and the deferred constraint trigger that makes "every committed session has a handle"
-- true is pinned, because attach_session_handle's safety (H2) rests on it. Read twice where it matters: granted, and effective.
-- tests/db/session-handle-pins.test.ts runs the plants (trigger dropped, trigger disabled, a grant added) against fresh clones and
-- shows each one turns this file red. One transaction, rolled back.
BEGIN;
SELECT no_plan();

-- R1: the table.
SELECT has_table('app', 'session_handle', 'app.session_handle exists');
SELECT is((SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'app.session_handle'::regclass), 'poly_owner', 'session_handle is owned by poly_owner');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'app.session_handle'::regclass), 'session_handle has RLS enabled and forced');
SELECT is((SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'session_handle'),
  ARRAY['session_id','handle_hash','created_at'], 'session_handle has exactly session_id, handle_hash, created_at (no plain handle column)');
SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey) WHERE i.indrelid = 'app.session_handle'::regclass AND i.indisprimary),
  ARRAY['session_id'], 'the primary key is session_id (one handle per session, for life)');
SELECT ok(EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey) WHERE i.indrelid = 'app.session_handle'::regclass AND i.indisunique AND NOT i.indisprimary AND a.attname = 'handle_hash'), 'handle_hash is UNIQUE');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'app.session_handle'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~ 'octet_length.*= 32'), 'handle_hash is CHECKed to 32 bytes');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'app.session_handle'::regclass AND contype = 'f' AND confrelid = 'public.session'::regclass AND confdeltype = 'c'), 'session_id references public.session ON DELETE CASCADE');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'app.session_handle'::regclass AND NOT tgisinternal AND tgtype & 32 = 32), 'a BEFORE TRUNCATE trigger is attached (refuse_truncate)');

-- R1/R2: no login role holds anything on the table, effective (PUBLIC included); poly_authz holds SELECT and INSERT and nothing else.
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['poly_app','poly_auth','poly_worker','poly_operator','poly_migrator']) r
  CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_table_privilege(r, 'app.session_handle', p)), 0,
  'effective: no runtime login role holds any privilege on app.session_handle (R1)');
-- R12: a backup reader holds hashes (poly_backup reads every table through pg_read_all_data), which no function accepts as a handle; it never writes.
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege('poly_backup', 'app.session_handle', p)), 0,
  'effective: poly_backup holds no write privilege on app.session_handle (SELECT only, as a backup reader, R12)');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['poly_app','poly_auth','poly_worker','poly_operator']) r
  CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
  JOIN pg_attribute a ON a.attrelid = 'app.session_handle'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  WHERE has_column_privilege(r, 'app.session_handle', a.attname, p)), 0, 'effective: no login role holds a column privilege on app.session_handle');
SELECT ok(has_table_privilege('poly_authz', 'app.session_handle', 'SELECT') AND has_table_privilege('poly_authz', 'app.session_handle', 'INSERT'), 'poly_authz holds SELECT and INSERT on session_handle');
SELECT ok(NOT has_table_privilege('poly_authz', 'app.session_handle', 'UPDATE') AND NOT has_table_privilege('poly_authz', 'app.session_handle', 'DELETE') AND NOT has_table_privilege('poly_authz', 'app.session_handle', 'TRUNCATE'),
  'poly_authz holds no UPDATE, DELETE or TRUNCATE on session_handle');
SELECT is((SELECT array_agg(grantee::text ORDER BY grantee::text) FROM information_schema.role_table_grants WHERE table_schema = 'app' AND table_name = 'session_handle' AND grantee NOT IN ('poly_owner')),
  ARRAY['poly_authz','poly_authz'], 'granted: session_handle grants name poly_authz only (SELECT, INSERT)');
SELECT is((SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'app' AND tablename = 'session_handle'),
  ARRAY['session_handle_attach','session_handle_read'], 'session_handle has exactly the read and attach policies');
SELECT is((SELECT array_agg(DISTINCT r::text ORDER BY r::text) FROM pg_policies p, unnest(p.roles) r WHERE schemaname = 'app' AND tablename = 'session_handle'), ARRAY['poly_authz'], 'both policies name poly_authz only');

-- R2: the EXECUTE lists, effective.
CREATE TEMP TABLE new_fn (sig text, roles text[]);
INSERT INTO new_fn VALUES
  ('app.enter_session(text)', ARRAY['poly_app']), ('app.my_sessions()', ARRAY['poly_app']), ('app.revoke_my_session(uuid)', ARRAY['poly_app']), ('app.recent_auth_ok()', ARRAY['poly_app']),
  ('app.attach_session_handle(uuid,text)', ARRAY['poly_auth']), ('app.session_needs_handle()', ARRAY[]::text[]);
SELECT is((SELECT array_agg(sig ORDER BY sig) FROM new_fn WHERE to_regprocedure(sig) IS NULL), NULL::text[], 'all six new functions exist');
SELECT is((SELECT array_agg(sig || ' ' || r ORDER BY sig, r) FROM new_fn n CROSS JOIN unnest(ARRAY['poly_app','poly_auth','poly_worker','poly_operator','poly_backup']) r
  WHERE to_regprocedure(sig) IS NOT NULL AND has_function_privilege(r, to_regprocedure(sig), 'EXECUTE') AND NOT (r = ANY (n.roles))), NULL::text[],
  'effective: no login role executes a new function it is not listed for (PUBLIC included)');
SELECT is((SELECT array_agg(sig || ' ' || r ORDER BY sig, r) FROM new_fn n CROSS JOIN unnest(n.roles) r
  WHERE to_regprocedure(sig) IS NULL OR NOT has_function_privilege(r, to_regprocedure(sig), 'EXECUTE')), NULL::text[], 'effective: every listed EXECUTE is held');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' AND p.proname = 'enter_session'), 1, 'enter_session has one overload only (no function takes a hash)');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' AND pg_get_function_identity_arguments(p.oid) ~ 'bytea'
  AND (has_function_privilege('poly_app', p.oid, 'EXECUTE') OR has_function_privilege('poly_auth', p.oid, 'EXECUTE')) AND p.proname NOT IN ('claim_invitations','accept_invitations')), 0,
  'no function a login role can execute takes a bytea other than the two invitation definers (no entry by hash)');
SELECT is((SELECT array_agg(p.proname || ':' || pg_get_userbyid(p.proowner) || ':' || p.prosecdef::text || ':' || ('search_path=""' = ANY (coalesce(p.proconfig, '{}')))::text ORDER BY p.proname)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' AND p.proname IN ('enter_session','my_sessions','revoke_my_session','recent_auth_ok','attach_session_handle','session_needs_handle')),
  ARRAY['attach_session_handle:poly_authz:true:true','enter_session:poly_authz:true:true','my_sessions:poly_authz:true:true',
        'recent_auth_ok:poly_authz:true:true','revoke_my_session:poly_authz:true:true','session_needs_handle:poly_authz:true:true'],
  'the six are SECURITY DEFINER, owned by poly_authz, search_path = ''''');

-- R2: poly_authz's added grants (and the two it must not get).
SELECT ok(has_table_privilege('poly_authz', 'public.session', 'DELETE'), 'poly_authz may DELETE sessions (revoke)');
SELECT ok(NOT has_table_privilege('poly_authz', 'public.session', 'INSERT') AND NOT has_column_privilege('poly_authz', 'public.session', 'user_id', 'INSERT'), 'poly_authz holds no INSERT on public.session');
SELECT is((SELECT array_agg(c ORDER BY c) FROM unnest(ARRAY['id','user_id','token','expires_at','created_at','recent_auth_at','user_agent','ip_address','updated_at']) c WHERE NOT has_column_privilege('poly_authz', 'public.session', c, 'SELECT')),
  NULL::text[], 'poly_authz reads the session columns the definers need');
SELECT is((SELECT array_agg(c ORDER BY c) FROM unnest(ARRAY['expires_at','updated_at']) c WHERE NOT has_column_privilege('poly_authz', 'public.session', c, 'UPDATE')), NULL::text[], 'poly_authz may UPDATE (expires_at, updated_at)');
SELECT is((SELECT array_agg(c ORDER BY c) FROM unnest(ARRAY['id','user_id','token','created_at','recent_auth_at','user_agent','ip_address']) c WHERE has_column_privilege('poly_authz', 'public.session', c, 'UPDATE')),
  NULL::text[], 'poly_authz may UPDATE nothing else on session (recent_auth_at in particular)');
SELECT ok(has_column_privilege('poly_authz', 'public.user', 'id', 'SELECT') AND has_column_privilege('poly_authz', 'public.user', 'name', 'SELECT') AND has_column_privilege('poly_authz', 'public.user', 'image', 'SELECT'), 'poly_authz reads user (id, name, image)');
SELECT ok(has_function_privilege('poly_authz', 'app.current_session_id()', 'EXECUTE'), 'poly_authz executes current_session_id');
SELECT is((SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p
  WHERE n.nspname = 'public' AND ((c.relname IN ('entity','membership','invitation','audit_event','notification') AND p <> 'SELECT') OR (c.relname IN ('entity','invitation','audit_event','notification') AND p = 'SELECT'))
  AND has_table_privilege('poly_authz', c.oid, p)), 0, 'poly_authz gains nothing on the tenant tables: no write anywhere, and SELECT only on membership, which 0003 gave it (R2: this loop adds none)');

-- H2 (R3): poly_auth cannot re-point a session that has a handle; no login role may rewrite a session's id or user.
SELECT ok(NOT has_column_privilege('poly_auth', 'public.session', 'id', 'UPDATE') AND NOT has_column_privilege('poly_auth', 'public.session', 'user_id', 'UPDATE'), 'pinned absent: poly_auth UPDATE (id) and UPDATE (user_id) on session');
SELECT ok(NOT has_column_privilege('poly_app', 'public.session', 'id', 'UPDATE') AND NOT has_column_privilege('poly_app', 'public.session', 'user_id', 'UPDATE'), 'pinned absent: poly_app UPDATE (id) and UPDATE (user_id) on session');

-- §2.2 / T6: the deferred check is pinned. attach_session_handle refuses every committed session only because no session commits
-- without a handle; drop or disable the trigger and it becomes a way to attach a chosen handle to any session that lacks one.
SELECT is((SELECT count(*)::int FROM pg_trigger WHERE tgrelid = 'public.session'::regclass AND tgname = 'session_needs_handle'), 1, 'session_needs_handle exists on public.session');
SELECT ok((SELECT tgconstraint <> 0 FROM pg_trigger WHERE tgrelid = 'public.session'::regclass AND tgname = 'session_needs_handle'), 'session_needs_handle is a constraint trigger');
SELECT ok((SELECT tgdeferrable AND tginitdeferred FROM pg_trigger WHERE tgrelid = 'public.session'::regclass AND tgname = 'session_needs_handle'), 'session_needs_handle is DEFERRABLE INITIALLY DEFERRED');
SELECT is((SELECT tgenabled::text FROM pg_trigger WHERE tgrelid = 'public.session'::regclass AND tgname = 'session_needs_handle'), 'O', 'session_needs_handle is enabled (tgenabled = O, fires in every session_replication_role origin)');
SELECT ok((SELECT (tgtype & 1) = 1 AND (tgtype & 4) = 4 AND (tgtype & 2) = 0 FROM pg_trigger WHERE tgrelid = 'public.session'::regclass AND tgname = 'session_needs_handle'), 'it fires AFTER INSERT FOR EACH ROW');
SELECT is((SELECT p.oid::regprocedure::text FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = 'public.session'::regclass AND t.tgname = 'session_needs_handle'), 'app.session_needs_handle()', 'it calls app.session_needs_handle()');
SELECT is((SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = 'app.session_needs_handle()'::regprocedure), 'poly_authz', 'session_needs_handle() is owned by poly_authz');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['poly_app','poly_auth','poly_worker','poly_operator','poly_backup']) r WHERE has_function_privilege(r, 'app.session_needs_handle()', 'EXECUTE')), 0, 'effective: no login role executes session_needs_handle()');
SELECT is((SELECT count(*)::int FROM information_schema.routine_privileges WHERE routine_schema = 'app' AND routine_name = 'session_needs_handle' AND grantee NOT IN ('poly_authz')), 0, 'granted: session_needs_handle() is granted to no role but its owner');

ROLLBACK;
