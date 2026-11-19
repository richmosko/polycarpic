-- POLY-149 (ruling R1; seceng F2): what poly_app holds after the revocation (0017), pinned exactly in both directions and read twice: what is
-- granted to the role, and what it EFFECTIVELY holds (has_*_privilege, PUBLIC included). A missing or an extra privilege fails. poly_app holds
-- nothing on BetterAuth's six tables, app.session_handle, app.sign_in_record, app.second_step_streak or app.email_challenge, and its EXECUTE set
-- on `app` is the ten functions the web tier needs. The planted-grant tests (tests/db/sign-in-controls-pins.test.ts) show each check bites.
-- One transaction, rolled back.
BEGIN;
SELECT no_plan();

SELECT is((SELECT count(*)::int FROM pg_auth_members m WHERE m.member = 'poly_app'::regrole), 0, 'poly_app is a member of no role');

-- Table-level privileges (0003, 0007, 0009 tenant grants and SELECT on app.tx_identity): the list after 0017.
CREATE TEMP TABLE want_tbl (rel text, priv text);
INSERT INTO want_tbl VALUES ('app.tx_identity','SELECT'), ('drizzle.__drizzle_migrations','SELECT'),
  ('public.audit_event','SELECT'), ('public.entity','SELECT'), ('public.membership','DELETE'), ('public.membership','SELECT'), ('public.notification','SELECT');
CREATE TEMP TABLE want_col (rel text, col text, priv text);
INSERT INTO want_col VALUES
  ('public.entity','name','INSERT'), ('public.entity','name','UPDATE'), ('public.entity','self_user_id','INSERT'), ('public.entity','tax_classification','INSERT'),
  ('public.entity','tax_classification','UPDATE'), ('public.entity','type_id','INSERT'),
  ('public.entity_type','created_at','SELECT'), ('public.entity_type','id','SELECT'), ('public.entity_type','kind','INSERT'), ('public.entity_type','kind','SELECT'),
  ('public.entity_type','name','INSERT'), ('public.entity_type','name','SELECT'), ('public.entity_type','owner_user_id','INSERT'), ('public.entity_type','system_key','SELECT'),
  ('public.invitation','accepted_at','SELECT'), ('public.invitation','claimed_at','SELECT'), ('public.invitation','claimed_user_id','SELECT'), ('public.invitation','created_at','SELECT'),
  ('public.invitation','email','INSERT'), ('public.invitation','email','SELECT'), ('public.invitation','entity_id','INSERT'), ('public.invitation','entity_id','SELECT'),
  ('public.invitation','expires_at','INSERT'), ('public.invitation','expires_at','SELECT'), ('public.invitation','id','SELECT'), ('public.invitation','inviter_user_id','INSERT'),
  ('public.invitation','inviter_user_id','SELECT'), ('public.invitation','issued_via','SELECT'), ('public.invitation','revoked_at','SELECT'), ('public.invitation','revoked_at','UPDATE'),
  ('public.invitation','role','INSERT'), ('public.invitation','role','SELECT'), ('public.invitation','token_hash','INSERT'),
  ('public.membership','role','UPDATE'), ('public.notification','read_at','UPDATE');

CREATE FUNCTION pg_temp.tbl_extra() RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM (
    SELECT n.nspname||'.'||c.relname||' '||p AS x FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    WHERE n.nspname IN ('public','app','drizzle') AND c.relkind IN ('r','p','v','m','f') AND has_table_privilege('poly_app', c.oid, p) AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
    EXCEPT SELECT rel||' '||priv FROM want_tbl) q $f$;
CREATE FUNCTION pg_temp.tbl_missing() RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(rel||' '||priv ORDER BY rel, priv), '{}') FROM want_tbl WHERE NOT has_table_privilege('poly_app', rel, priv) $f$;
SELECT is(pg_temp.tbl_extra(), '{}'::text[], 'effective: poly_app holds no table privilege outside the list (the six BetterAuth tables, session_handle, sign_in_record, second_step_streak included)');
SELECT is(pg_temp.tbl_missing(), '{}'::text[], 'effective: every listed table privilege is held');

CREATE FUNCTION pg_temp.col_extra() RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM (
    SELECT n.nspname||'.'||c.relname||'.'||a.attname||' '||p AS x FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
    WHERE n.nspname IN ('public','app','drizzle') AND c.relkind IN ('r','p','v','m','f') AND has_column_privilege('poly_app', c.oid, a.attnum, p) AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
    EXCEPT SELECT rel||'.'||col||' '||priv FROM want_col
    EXCEPT SELECT n.nspname||'.'||c.relname||'.'||a.attname||' '||t.priv FROM want_tbl t
      JOIN pg_class c ON c.oid = t.rel::regclass JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) q $f$;
CREATE FUNCTION pg_temp.col_missing() RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(rel||'.'||col||' '||priv ORDER BY rel, col, priv), '{}') FROM want_col WHERE NOT has_column_privilege('poly_app', rel, col, priv) $f$;
SELECT is(pg_temp.col_extra(), '{}'::text[], 'effective: poly_app holds no column privilege outside the list (app.email_challenge included)');
SELECT is(pg_temp.col_missing(), '{}'::text[], 'effective: every listed column privilege is held');

-- The six BetterAuth tables and the three new ones, named: no privilege of any kind, table or column.
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['public."user"','public.session','public.account','public.verification','public.two_factor','public.passkey','app.session_handle','app.sign_in_record','app.second_step_streak','app.email_challenge']) t
  CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE to_regclass(t) IS NOT NULL AND has_table_privilege('poly_app', to_regclass(t), p)), 0,
  'effective: no table privilege on the six BetterAuth tables, session_handle, sign_in_record, second_step_streak, email_challenge');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['public."user"','public.session','public.account','public.verification','public.two_factor','public.passkey','app.session_handle','app.sign_in_record','app.second_step_streak','app.email_challenge']) t
  JOIN pg_attribute a ON a.attrelid = to_regclass(t) AND a.attnum > 0 AND NOT a.attisdropped
  CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p WHERE has_column_privilege('poly_app', to_regclass(t), a.attnum, p)), 0,
  'effective: no column privilege on any of those either');

SELECT is((SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname IN ('public','app','drizzle')
  AND (has_sequence_privilege('poly_app', c.oid, 'USAGE') OR has_sequence_privilege('poly_app', c.oid, 'SELECT') OR has_sequence_privilege('poly_app', c.oid, 'UPDATE'))), 0,
  'effective: poly_app holds no sequence privilege in public, app, drizzle');

-- EFFECTIVE EXECUTE over every function in public, app, drizzle (PUBLIC included): exactly the ten (seceng F2).
CREATE TEMP TABLE want_fn (sig text);
INSERT INTO want_fn VALUES ('app.current_user_id()'), ('app.current_session_id()'), ('app.has_role(uuid,text)'), ('app.visible_entities()'), ('app.owner_count(uuid)'),
  ('app.second_step_required()'), ('app.enter_session(text)'), ('app.my_sessions()'), ('app.recent_auth_ok()'), ('app.revoke_my_session(uuid)');
CREATE FUNCTION pg_temp.fn_extra() RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM (
    SELECT p.oid::regprocedure::text AS x FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','app','drizzle') AND has_function_privilege('poly_app', p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    EXCEPT SELECT to_regprocedure(sig)::text FROM want_fn WHERE to_regprocedure(sig) IS NOT NULL) q $f$;
SELECT is(pg_temp.fn_extra(), '{}'::text[], 'effective: poly_app executes no function outside the ten (PUBLIC included; enter_asserted_user and every enter_* but enter_session are out)');
SELECT is((SELECT array_agg(sig ORDER BY sig) FROM want_fn WHERE to_regprocedure(sig) IS NULL OR NOT has_function_privilege('poly_app', to_regprocedure(sig), 'EXECUTE')), NULL::text[],
  'effective: poly_app executes every one of the ten (a missing or ungranted function is listed)');
SELECT is(to_regprocedure('app.enter_asserted_user(uuid, uuid)')::text, NULL, 'app.enter_asserted_user does not exist (dropped, so a grant can never bring it back)');

-- Granted to the role itself (the second reading).
SELECT is((SELECT array_agg(DISTINCT table_schema||'.'||table_name ORDER BY table_schema||'.'||table_name) FROM information_schema.role_table_grants WHERE grantee='poly_app'),
  ARRAY['app.tx_identity','drizzle.__drizzle_migrations','public.audit_event','public.entity','public.membership','public.notification'],
  'granted: table grants name only the tenant tables, tx_identity and __drizzle_migrations');
SELECT is((SELECT array_agg(DISTINCT table_schema||'.'||table_name ORDER BY table_schema||'.'||table_name) FROM information_schema.role_column_grants WHERE grantee='poly_app' AND table_schema||'.'||table_name NOT IN ('public.audit_event','public.entity','public.membership','public.notification','app.tx_identity','drizzle.__drizzle_migrations')),
  ARRAY['public.entity_type','public.invitation'], 'granted: column grants beyond the table-level ones are on entity_type and invitation only (no BetterAuth table, no email_challenge)');
SELECT is((SELECT array_agg(DISTINCT routine_schema||'.'||routine_name ORDER BY routine_schema||'.'||routine_name) FROM information_schema.routine_privileges WHERE grantee='poly_app'),
  ARRAY['app.current_session_id','app.current_user_id','app.enter_session','app.has_role','app.my_sessions','app.owner_count','app.recent_auth_ok','app.revoke_my_session','app.second_step_required','app.visible_entities'],
  'granted: routine_privileges lists exactly the ten functions');
SELECT is((SELECT array_agg(schemaname||'.'||tablename||' '||policyname ORDER BY 1) FROM pg_policies WHERE 'poly_app' = ANY (roles) AND tablename IN ('email_challenge','session','user','account','verification','two_factor','passkey','session_handle','sign_in_record','second_step_streak')), NULL::text[],
  'no policy naming poly_app on email_challenge or any BetterAuth table (email_challenge_own is dropped)');
SELECT is((SELECT count(*)::int FROM pg_default_acl d WHERE d.defaclacl::text LIKE '%poly_app=%'), 0, 'no default privilege grants anything to poly_app');

-- Canaries: a grant through PUBLIC and a direct one are each caught, so the checks above can fail.
CREATE TABLE public.qa_canary_149 (id int);
GRANT SELECT ON public.qa_canary_149 TO PUBLIC;
SELECT is(pg_temp.tbl_extra(), ARRAY['public.qa_canary_149 SELECT'], 'canary: a SELECT granted through PUBLIC is caught by the effective check');
REVOKE SELECT ON public.qa_canary_149 FROM PUBLIC;
GRANT SELECT ON public.qa_canary_149 TO poly_app;
SELECT is(pg_temp.tbl_extra(), ARRAY['public.qa_canary_149 SELECT'], 'canary: a direct SELECT is caught');
ROLLBACK;
