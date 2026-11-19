-- The deploy gate behind INFRA §7.1 step 16. Read-only: one SELECT. It prints one `FAIL ...` line per broken
-- control and nothing else; when none is broken it prints the single line `gate: pass`. Run through gate-check.sh,
-- which turns any FAIL (or any error, or a missing `gate: pass`) into a non-zero exit.
-- "Login role" = every role that can log in and is not a superuser; the effective privilege (membership and PUBLIC
-- included) is read with has_*_privilege. poly_backup's read of the sign-in record, through pg_read_all_data, is the
-- one allowed exception (it reads every table); poly_backup's writes are not.
WITH logins AS (
  SELECT rolname::text AS r FROM pg_roles WHERE rolcanlogin AND NOT rolsuper
), runtime AS (
  SELECT r FROM logins WHERE r <> 'poly_backup'
), tbls(t) AS (
  VALUES ('app.second_step_streak'), ('app.sign_in_record')
), betterauth(t) AS (
  VALUES ('public."user"'), ('public.session'), ('public.account'), ('public.verification'),
         ('public.two_factor'), ('public.passkey')
), trig(tbl, name) AS (
  VALUES ('public.two_factor', 'two_factor_15_lock'), ('public.two_factor', 'two_factor_16_lock_delete'),
         ('public.session', 'session_80_sign_in_record'),
         ('app.sign_in_record', 'sign_in_record_10_immutable'), ('app.sign_in_record', 'sign_in_record_no_truncate')
), definers(sig, owner) AS (
  VALUES ('app.guard_second_step_lock()', 'poly_govern'), ('app.record_session_sign_in()', 'poly_govern')
), app_ten(sig) AS (
  VALUES ('app.current_user_id()'), ('app.current_session_id()'), ('app.has_role(uuid,text)'),
         ('app.visible_entities()'), ('app.owner_count(uuid)'), ('app.second_step_required()'),
         ('app.enter_session(text)'), ('app.my_sessions()'), ('app.recent_auth_ok()'),
         ('app.revoke_my_session(uuid)')
), f(line) AS (
  -- 1. the two tables exist, RLS enabled and forced
  SELECT 'FAIL table ' || t || ': missing' FROM tbls WHERE to_regclass(t) IS NULL
  UNION ALL
  SELECT 'FAIL table ' || t || ': row-level security is not enabled and forced'
  FROM tbls JOIN pg_class c ON c.oid = to_regclass(t) WHERE NOT (c.relrowsecurity AND c.relforcerowsecurity)
  -- 2. the triggers exist and are enabled
  UNION ALL
  SELECT 'FAIL trigger ' || name || ' on ' || tbl || ': ' ||
         CASE WHEN g.oid IS NULL THEN 'missing' ELSE 'tgenabled = ' || g.tgenabled::text || ', not O' END
  FROM trig LEFT JOIN pg_trigger g ON g.tgrelid = to_regclass(tbl) AND g.tgname = name AND NOT g.tgisinternal
  WHERE g.oid IS NULL OR g.tgenabled <> 'O'
  -- 3. the two trigger definers: owner, SECURITY DEFINER, executable by no login role
  UNION ALL
  SELECT 'FAIL function ' || sig || ': missing' FROM definers WHERE to_regprocedure(sig) IS NULL
  UNION ALL
  SELECT 'FAIL function ' || sig || ': owner is ' || pg_get_userbyid(p.proowner) || ', not ' || owner
  FROM definers JOIN pg_proc p ON p.oid = to_regprocedure(sig) WHERE pg_get_userbyid(p.proowner) <> owner
  UNION ALL
  SELECT 'FAIL function ' || sig || ': not SECURITY DEFINER'
  FROM definers JOIN pg_proc p ON p.oid = to_regprocedure(sig) WHERE NOT p.prosecdef
  UNION ALL
  SELECT 'FAIL function ' || sig || ': ' || r || ' can execute it'
  FROM definers CROSS JOIN logins WHERE to_regprocedure(sig) IS NOT NULL AND has_function_privilege(r, to_regprocedure(sig), 'EXECUTE')
  -- 4. the purge: owner poly_purge, SECURITY DEFINER, executable by poly_worker only
  UNION ALL
  SELECT 'FAIL function app.purge_sign_in_record(): missing' WHERE to_regprocedure('app.purge_sign_in_record()') IS NULL
  UNION ALL
  SELECT 'FAIL function app.purge_sign_in_record(): owner is ' || pg_get_userbyid(p.proowner) || ', not poly_purge'
  FROM pg_proc p WHERE p.oid = to_regprocedure('app.purge_sign_in_record()') AND pg_get_userbyid(p.proowner) <> 'poly_purge'
  UNION ALL
  SELECT 'FAIL function app.purge_sign_in_record(): not SECURITY DEFINER'
  FROM pg_proc p WHERE p.oid = to_regprocedure('app.purge_sign_in_record()') AND NOT p.prosecdef
  UNION ALL
  SELECT 'FAIL function app.purge_sign_in_record(): ' || r || ' can execute it'
  FROM logins WHERE to_regprocedure('app.purge_sign_in_record()') IS NOT NULL AND r <> 'poly_worker'
    AND has_function_privilege(r, to_regprocedure('app.purge_sign_in_record()'), 'EXECUTE')
  UNION ALL
  SELECT 'FAIL function app.purge_sign_in_record(): poly_worker cannot execute it'
  WHERE to_regprocedure('app.purge_sign_in_record()') IS NOT NULL
    AND NOT has_function_privilege('poly_worker', to_regprocedure('app.purge_sign_in_record()'), 'EXECUTE')
  -- 5. no login role writes either table (INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER; table or column level)
  UNION ALL
  SELECT 'FAIL ' || t || ': ' || r || ' holds ' || p
  FROM tbls CROSS JOIN logins CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'REFERENCES', 'DELETE', 'TRUNCATE', 'TRIGGER']) p
  WHERE to_regclass(t) IS NOT NULL
    AND CASE WHEN p IN ('INSERT', 'UPDATE', 'REFERENCES') THEN has_any_column_privilege(r, to_regclass(t), p)
             ELSE has_table_privilege(r, to_regclass(t), p) END
  -- 6. no runtime role reads the sign-in record (poly_backup is the one reader)
  UNION ALL
  SELECT 'FAIL app.sign_in_record: ' || r || ' can read it'
  FROM runtime WHERE to_regclass('app.sign_in_record') IS NOT NULL
    AND has_any_column_privilege(r, to_regclass('app.sign_in_record'), 'SELECT')
  -- 7. the asserted-user entry is gone
  UNION ALL
  SELECT 'FAIL function ' || p.oid::regprocedure::text || ': exists'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' AND p.proname = 'enter_asserted_user'
  -- 8. poly_app holds nothing on the six BetterAuth tables, the handle table, the record or the streak
  UNION ALL
  SELECT 'FAIL ' || t || ': poly_app holds ' || p
  FROM (SELECT t FROM betterauth UNION ALL SELECT 'app.session_handle' UNION ALL SELECT 'app.sign_in_record'
        UNION ALL SELECT 'app.second_step_streak') x(t)
  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES', 'DELETE', 'TRUNCATE', 'TRIGGER']) p
  WHERE to_regclass(t) IS NOT NULL
    AND CASE WHEN p IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') THEN has_any_column_privilege('poly_app', to_regclass(t), p)
             ELSE has_table_privilege('poly_app', to_regclass(t), p) END
  UNION ALL
  SELECT 'FAIL ' || t || ': missing' FROM (SELECT t FROM betterauth UNION ALL SELECT 'app.session_handle') x(t) WHERE to_regclass(t) IS NULL
  -- 9. poly_app's EXECUTE set on app is exactly the ten
  UNION ALL
  SELECT 'FAIL function ' || p.oid::regprocedure::text || ': poly_app can execute it'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app' AND has_function_privilege('poly_app', p.oid, 'EXECUTE')
    AND p.oid::regprocedure::text NOT IN (SELECT sig FROM app_ten)
  UNION ALL
  SELECT 'FAIL function ' || sig || ': poly_app cannot execute it (or it is missing)'
  FROM app_ten WHERE to_regprocedure(sig) IS NULL OR NOT has_function_privilege('poly_app', to_regprocedure(sig), 'EXECUTE')
  -- 10. no login role can delete a user
  UNION ALL
  SELECT 'FAIL public."user": ' || r || ' holds DELETE' FROM logins WHERE has_table_privilege(r, 'public."user"', 'DELETE')
)
SELECT line FROM f
UNION ALL SELECT 'gate: pass' WHERE NOT EXISTS (SELECT 1 FROM f);
