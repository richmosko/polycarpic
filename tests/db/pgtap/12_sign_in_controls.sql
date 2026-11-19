-- POLY-149 (ruling R2, R3, R5; seceng T-L5, T-S3): the catalog of the two deploy-gate controls. The growing second-step lock (app.second_step_streak,
-- the guard trigger on public.two_factor) and the sign-in record (app.sign_in_record, the session trigger, the append-only trigger, the purge).
-- Read twice where it matters: granted, and effective (has_*_privilege, PUBLIC included). Each message names the mutation that turns it red;
-- tests/db/sign-in-controls-pins.test.ts runs the plants against clones and shows each one turns this file red. One transaction, rolled back.
BEGIN;
SELECT no_plan();

CREATE TEMP TABLE logins (r text);
INSERT INTO logins VALUES ('poly_app'), ('poly_auth'), ('poly_worker'), ('poly_operator'), ('poly_migrator'), ('poly_backup');
CREATE TEMP TABLE privs (p text);
INSERT INTO privs VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER');

-- ===== app.sign_in_record =====
SELECT has_table('app', 'sign_in_record', 'app.sign_in_record exists');
SELECT is((SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = to_regclass('app.sign_in_record')), 'poly_owner', 'sign_in_record is owned by poly_owner');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = to_regclass('app.sign_in_record')), 'sign_in_record has RLS enabled and forced');
SELECT is((SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'sign_in_record'),
  ARRAY['id','kind','user_id','session_id','created_at','ip_address','user_agent','lock_minutes'], 'sign_in_record has exactly the eight columns of R3 (no column for a typed code)');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid = to_regclass('app.sign_in_record') AND contype = 'f'), 0, 'sign_in_record has no foreign key (a row outlives its account; deleting a user cannot erase it)');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.sign_in_record') AND contype = 'c' AND pg_get_constraintdef(oid) ~ 'second_step_lock'), 'kind and lock_minutes are CHECKed together');
SELECT is((SELECT count(*)::int FROM pg_index WHERE indrelid = to_regclass('app.sign_in_record') AND NOT indisprimary), 2, 'two indexes besides the primary key: (user_id, created_at) and (created_at)');
SELECT is((SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'app' AND tablename = 'sign_in_record'),
  ARRAY['sign_in_record_append','sign_in_record_purge','sign_in_record_purge_read'], 'sign_in_record has exactly the append, purge and purge-read policies');
SELECT is((SELECT array_agg(DISTINCT r::text ORDER BY r::text) FROM pg_policies p, unnest(p.roles) r WHERE schemaname = 'app' AND tablename = 'sign_in_record'), ARRAY['poly_govern','poly_purge'], 'the policies name poly_govern and poly_purge only');
SELECT is((SELECT array_agg(DISTINCT grantee::text ORDER BY grantee::text) FROM information_schema.role_table_grants WHERE table_schema = 'app' AND table_name = 'sign_in_record' AND grantee <> 'poly_owner'),
  ARRAY['poly_govern','poly_purge'], 'granted: sign_in_record grants name poly_govern (INSERT) and poly_purge (SELECT, DELETE) only');
SELECT is((SELECT count(*)::int FROM logins JOIN privs ON true WHERE to_regclass('app.sign_in_record') IS NOT NULL AND has_table_privilege(r, 'app.sign_in_record', p)), 0,
  'effective: no login role holds INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on sign_in_record (PUBLIC included)');
SELECT is((SELECT count(*)::int FROM logins l WHERE r <> 'poly_backup' AND to_regclass('app.sign_in_record') IS NOT NULL AND (has_table_privilege(r, 'app.sign_in_record', 'SELECT')
  OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('app.sign_in_record') AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege(r, a.attrelid, a.attnum, 'SELECT')))), 0,
  'effective: poly_app, poly_auth, poly_worker, poly_operator and poly_migrator read nothing of sign_in_record (table or column)');
SELECT is((SELECT count(*)::int FROM logins JOIN privs ON true JOIN pg_attribute a ON a.attrelid = to_regclass('app.sign_in_record') AND a.attnum > 0 AND NOT a.attisdropped
  WHERE p IN ('INSERT','UPDATE','REFERENCES') AND has_column_privilege(r, a.attrelid, a.attnum, p)), 0, 'effective: no login role holds a writing column privilege on sign_in_record');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('app.sign_in_record') AND t.tgname = 'sign_in_record_10_immutable' AND NOT t.tgisinternal AND t.tgenabled = 'O'
  AND t.tgtype & 1 = 1 AND t.tgtype & 2 = 2 AND t.tgtype & 8 = 8 AND t.tgtype & 16 = 16), 'sign_in_record_10_immutable is enabled, BEFORE UPDATE OR DELETE, FOR EACH ROW');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('app.sign_in_record') AND t.tgname = 'sign_in_record_no_truncate' AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype & 32 = 32), 'sign_in_record_no_truncate is enabled, BEFORE TRUNCATE');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('app.sign_in_record') AND t.tgname = 'sign_in_record_05_refuse' AND NOT t.tgisinternal AND t.tgenabled = 'O'
  AND t.tgtype & 1 = 0 AND t.tgtype & 2 = 2 AND t.tgtype & 8 = 8 AND t.tgtype & 16 = 16), 'sign_in_record_05_refuse is enabled, BEFORE UPDATE OR DELETE, FOR EACH STATEMENT (Addendum 3: the owner is refused even when no row is visible)');
SELECT is((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure('app.sign_in_record_immutable()')), false, 'sign_in_record_immutable is an invoker (so current_user is the deleting role)');
SELECT is((SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = to_regprocedure('app.sign_in_record_immutable()')), 'poly_owner', 'sign_in_record_immutable is owned by poly_owner');
SELECT ok(to_regprocedure('app.sign_in_record_immutable()') IS NOT NULL AND 'search_path=""' = ANY (coalesce((SELECT proconfig FROM pg_proc WHERE oid = to_regprocedure('app.sign_in_record_immutable()')), '{}')), 'sign_in_record_immutable pins search_path');
SELECT is((SELECT array_agg(r ORDER BY r) FROM logins WHERE to_regprocedure('app.sign_in_record_immutable()') IS NOT NULL AND has_function_privilege(r, to_regprocedure('app.sign_in_record_immutable()'), 'EXECUTE')), NULL::text[], 'effective: no login role executes sign_in_record_immutable (PUBLIC included)');

-- ===== app.second_step_streak =====
SELECT has_table('app', 'second_step_streak', 'app.second_step_streak exists');
SELECT is((SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = to_regclass('app.second_step_streak')), 'poly_owner', 'second_step_streak is owned by poly_owner');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = to_regclass('app.second_step_streak')), 'second_step_streak has RLS enabled and forced');
SELECT is((SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'second_step_streak'), ARRAY['user_id','locks','updated_at'], 'second_step_streak has user_id, locks, updated_at (keyed by user, not by factor row)');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.second_step_streak') AND contype = 'f' AND confrelid = 'public."user"'::regclass AND confdeltype = 'c'), 'user_id references public."user" ON DELETE CASCADE');
SELECT is((SELECT array_agg(DISTINCT grantee::text ORDER BY grantee::text) FROM information_schema.role_table_grants WHERE table_schema = 'app' AND table_name = 'second_step_streak' AND grantee <> 'poly_owner'), ARRAY['poly_govern'], 'granted: second_step_streak grants name poly_govern only');
SELECT is((SELECT array_agg(DISTINCT r::text ORDER BY r::text) FROM pg_policies p, unnest(p.roles) r WHERE schemaname = 'app' AND tablename = 'second_step_streak'), ARRAY['poly_govern'], 'the second_step_streak policies name poly_govern only');
SELECT is((SELECT count(*)::int FROM logins JOIN (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p) q ON true WHERE to_regclass('app.second_step_streak') IS NOT NULL AND has_table_privilege(r, 'app.second_step_streak', p) AND NOT (r = 'poly_backup' AND p = 'SELECT')), 0,
  'effective: no login role holds any privilege on second_step_streak (PUBLIC included); poly_backup reads it through pg_read_all_data, SELECT only (Principal decision 1)');
SELECT is((SELECT count(*)::int FROM logins JOIN (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p) q ON true JOIN pg_attribute a ON a.attrelid = to_regclass('app.second_step_streak') AND a.attnum > 0 AND NOT a.attisdropped
  WHERE has_column_privilege(r, a.attrelid, a.attnum, p) AND NOT (r = 'poly_backup' AND p = 'SELECT')), 0, 'effective: no login role holds a column privilege on second_step_streak (poly_backup reads through pg_read_all_data, SELECT only)');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('app.second_step_streak') AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype & 32 = 32), 'second_step_streak has an enabled BEFORE TRUNCATE trigger');

-- ===== the guard triggers on public.two_factor and the session trigger =====
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.two_factor'::regclass AND t.tgname = 'two_factor_15_lock' AND NOT t.tgisinternal AND t.tgenabled = 'O'
  AND t.tgtype & 1 = 1 AND t.tgtype & 2 = 2 AND t.tgtype & 16 = 16 AND t.tgtype & 4 = 0 AND t.tgtype & 8 = 0), 'two_factor_15_lock exists, tgenabled = O, BEFORE UPDATE, FOR EACH ROW');
SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_trigger t JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[]) WHERE t.tgrelid = 'public.two_factor'::regclass AND t.tgname = 'two_factor_15_lock'),
  ARRAY['failed_verification_count','locked_until'], 'two_factor_15_lock fires on UPDATE OF failed_verification_count, locked_until');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.two_factor'::regclass AND t.tgname = 'two_factor_16_lock_delete' AND NOT t.tgisinternal AND t.tgenabled = 'O'
  AND t.tgtype & 1 = 1 AND t.tgtype & 2 = 2 AND t.tgtype & 8 = 8), 'two_factor_16_lock_delete exists, tgenabled = O, BEFORE DELETE, FOR EACH ROW');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.session'::regclass AND t.tgname = 'session_80_sign_in_record' AND NOT t.tgisinternal AND t.tgenabled = 'O'
  AND t.tgtype & 1 = 1 AND t.tgtype & 2 = 0 AND t.tgtype & 4 = 4), 'session_80_sign_in_record exists, tgenabled = O, AFTER INSERT, FOR EACH ROW on public.session');

-- Function owners, kind, and EXECUTE (effective, PUBLIC included).
CREATE TEMP TABLE want_fn (sig text, owner text, secdef boolean, exec text[]);
INSERT INTO want_fn VALUES
  ('app.guard_second_step_lock()', 'poly_govern', true, ARRAY[]::text[]),
  ('app.guard_second_step_lock_delete()', 'poly_govern', false, ARRAY[]::text[]),
  ('app.record_session_sign_in()', 'poly_govern', true, ARRAY[]::text[]),
  ('app.sign_in_address(text)', 'poly_govern', false, ARRAY[]::text[]),
  ('app.purge_sign_in_record()', 'poly_purge', true, ARRAY['poly_worker']);
SELECT is((SELECT array_agg(sig ORDER BY sig) FROM want_fn WHERE to_regprocedure(sig) IS NULL), NULL::text[], 'the five new functions exist');
SELECT is((SELECT array_agg(sig || ' ' || pg_get_userbyid(p.proowner) ORDER BY sig) FROM want_fn w JOIN pg_proc p ON p.oid = to_regprocedure(w.sig) WHERE pg_get_userbyid(p.proowner) <> w.owner OR p.prosecdef <> w.secdef), NULL::text[],
  'each new function has the ruled owner and kind (definer, except the delete guard, an invoker)');
SELECT is((SELECT p.provolatile FROM pg_proc p WHERE p.oid = to_regprocedure('app.sign_in_address(text)')), 'i', 'sign_in_address is IMMUTABLE');
SELECT is((SELECT array_agg(sig ORDER BY sig) FROM want_fn w JOIN pg_proc p ON p.oid = to_regprocedure(w.sig) WHERE NOT ('search_path=""' = ANY (coalesce(p.proconfig, '{}')))), NULL::text[], 'each new function (the two invokers included) pins search_path = ''''');
SELECT is((SELECT array_agg(sig || ' ' || l.r ORDER BY sig, l.r) FROM want_fn w CROSS JOIN logins l WHERE to_regprocedure(w.sig) IS NOT NULL AND has_function_privilege(l.r, to_regprocedure(w.sig), 'EXECUTE') AND NOT (l.r = ANY (w.exec))), NULL::text[],
  'effective: no login role executes a new function it is not listed for (PUBLIC included)');
SELECT is((SELECT array_agg(sig || ' ' || r ORDER BY sig, r) FROM want_fn w CROSS JOIN unnest(w.exec) r WHERE to_regprocedure(w.sig) IS NULL OR NOT has_function_privilege(r, to_regprocedure(w.sig), 'EXECUTE')), NULL::text[], 'effective: every listed EXECUTE is held (poly_worker runs the purge)');

-- ===== T-S3: what the "no foreign key, no cascade" design relies on =====
SELECT is((SELECT array_agg(r ORDER BY r) FROM logins WHERE has_table_privilege(r, 'public."user"', 'DELETE')), NULL::text[], 'effective: no login role holds DELETE on public."user" (so deleting a user cannot reset the doubling or erase the record)');
SELECT is((SELECT array_agg(r ORDER BY r) FROM logins WHERE has_column_privilege(r, 'public."user"', 'id', 'UPDATE')), NULL::text[], 'effective: no login role may UPDATE user.id');
SELECT is((SELECT array_agg(r ORDER BY r) FROM logins WHERE has_table_privilege(r, 'public."user"', 'TRUNCATE')), NULL::text[], 'effective: no login role may TRUNCATE public."user"');

-- ===== T-L5: no clock a role can change (Addendum 5) =====
-- Scope: every function outside pg_catalog and information_schema, minus extension members (so pgTAP's own functions, and this file's pg_temp helpers, do not count).
CREATE VIEW pg_temp.scope_fn AS
  SELECT p.oid, p.oid::regprocedure::text AS sig, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_temp%' AND n.nspname NOT LIKE 'pg_toast%'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');
-- 1. every current_setting call names one of four settings; the name is a literal
SELECT is((SELECT coalesce(array_agg(DISTINCT sig || ' reads ' || m[1] ORDER BY sig || ' reads ' || m[1]), '{}') FROM pg_temp.scope_fn f, LATERAL regexp_matches(f.prosrc, 'current_setting\s*\(\s*''([^'']+)''', 'g') m
  WHERE m[1] NOT IN ('app.actor','poly.client_ip','poly.user_agent','role')), '{}'::text[], 'no function reads a setting other than app.actor, poly.client_ip, poly.user_agent and role (a clock override would be one)');
SELECT is((SELECT array_agg(sig ORDER BY sig) FROM pg_temp.scope_fn f WHERE prosrc ~* 'current_setting' AND (SELECT count(*) FROM regexp_matches(prosrc, 'current_setting', 'gi')) <> (SELECT count(*) FROM regexp_matches(prosrc, 'current_setting\s*\(\s*''[^'']+''', 'gi'))), NULL::text[],
  'every current_setting call has a literal name (no dynamic setting name)');
-- 2. `role` is read by exactly the three POLY-89 commit-time trigger functions
SELECT is((SELECT coalesce(array_agg(sig ORDER BY sig), '{}') FROM pg_temp.scope_fn WHERE prosrc ~* 'current_setting\s*\(\s*''role''' ),
  ARRAY['app.require_enrolled_inviter()','app.require_second_step_for_role()','app.two_factor_consistent()'], 'current_setting(''role'') is read only by two_factor_consistent, require_second_step_for_role and require_enrolled_inviter');
-- 3. the lock's own path reads only poly.client_ip and poly.user_agent
SELECT is((SELECT coalesce(array_agg(sig || ' reads ' || m[1] ORDER BY sig || ' reads ' || m[1]), '{}') FROM pg_temp.scope_fn f, LATERAL regexp_matches(f.prosrc, 'current_setting\s*\(\s*''([^'']+)''', 'g') m
  WHERE sig IN ('app.guard_second_step_lock()','app.guard_second_step_lock_delete()','app.record_session_sign_in()','app.sign_in_address(text)') AND m[1] NOT IN ('poly.client_ip','poly.user_agent')), '{}'::text[],
  'the guard, the delete guard, the record writer and sign_in_address read only poly.client_ip and poly.user_agent');
-- 4. no set_config, no pg_settings, no pg_show_all_settings anywhere in scope; no dynamic EXECUTE in the four
SELECT is((SELECT array_agg(sig ORDER BY sig) FROM pg_temp.scope_fn WHERE prosrc ~* 'set_config'), NULL::text[], 'no function calls set_config (a clock override would need it)');
SELECT is((SELECT array_agg(sig ORDER BY sig) FROM pg_temp.scope_fn WHERE prosrc ~* 'pg_settings|pg_show_all_settings'), NULL::text[], 'no function reads pg_settings or pg_show_all_settings');
SELECT is((SELECT array_agg(sig ORDER BY sig) FROM pg_temp.scope_fn WHERE sig IN ('app.guard_second_step_lock()','app.guard_second_step_lock_delete()','app.record_session_sign_in()','app.sign_in_address(text)') AND prosrc ~* '\mexecute\M'), NULL::text[],
  'the four lock and record functions contain no dynamic EXECUTE (a string run that way escapes every text scan)');
SELECT is((SELECT p.prosrc !~* 'clock_timestamp' FROM pg_proc p WHERE p.oid = to_regprocedure('app.guard_second_step_lock()')), false, 'the guard reads clock_timestamp(), not now() and no setting');

ROLLBACK;
