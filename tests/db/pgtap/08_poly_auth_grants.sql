-- POLY-152 (ruling R2, seceng #16, §5.3): poly_auth's grants are catalog-exact, read twice: what is granted to the role, and what the
-- role EFFECTIVELY holds (has_*_privilege, which includes PUBLIC). A missing or an extra privilege fails. Each message names the mutation
-- that turns it red. One transaction, rolled back; canaries inside it.
BEGIN;
SELECT no_plan();

SELECT has_role('poly_auth');
SELECT results_eq($$SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname='poly_auth'$$,
  $$VALUES (true,false,false,false,false,false)$$, 'poly_auth: LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
CREATE FUNCTION pg_temp.auth_memberships() RETURNS int LANGUAGE sql AS $f$
  SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = 'poly_auth' $f$;
CREATE FUNCTION pg_temp.auth_can_become() RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname), '{}') FROM pg_roles r
  WHERE r.rolname <> 'poly_auth' AND (pg_has_role('poly_auth', r.oid, 'MEMBER') OR pg_has_role('poly_auth', r.oid, 'USAGE') OR pg_has_role('poly_auth', r.oid, 'SET')) $f$;
SELECT is(pg_temp.auth_memberships(), 0, 'poly_auth is a member of no role');
SELECT is(pg_temp.auth_can_become(), '{}'::text[], 'poly_auth can neither be, inherit nor SET ROLE to any other role (INHERIT FALSE, SET TRUE included)');
SELECT ok(has_database_privilege('poly_auth', current_database(), 'CONNECT'), 'poly_auth has CONNECT');
SELECT ok(NOT has_database_privilege('poly_auth', current_database(), 'TEMPORARY'), 'poly_auth holds no TEMP');
SELECT ok(NOT has_database_privilege('poly_auth', current_database(), 'CREATE'), 'poly_auth holds no CREATE on the database');
SELECT ok(NOT has_language_privilege('poly_auth', 'plpgsql', 'USAGE'), 'poly_auth holds no plpgsql USAGE (the PUBLIC revoke covers it)');
SELECT ok(has_schema_privilege('poly_auth', 'public', 'USAGE') AND has_schema_privilege('poly_auth', 'app', 'USAGE') AND has_schema_privilege('poly_auth', 'drizzle', 'USAGE'),
  'poly_auth has USAGE on public, app, drizzle');
SELECT ok(NOT has_schema_privilege('poly_auth', 'public', 'CREATE') AND NOT has_schema_privilege('poly_auth', 'app', 'CREATE'), 'poly_auth cannot CREATE in public or app');

-- The allowed table-level and column-level privileges (R2's table). Anything else fails, both directions.
CREATE TEMP TABLE want_tbl (rel text, priv text);
INSERT INTO want_tbl VALUES ('public.user','SELECT'), ('public.session','SELECT'), ('public.session','DELETE');
INSERT INTO want_tbl SELECT r, p FROM unnest(ARRAY['public.account','public.verification','public.two_factor','public.passkey']) r, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p;
INSERT INTO want_tbl VALUES ('app.tx_identity','SELECT'), ('drizzle.__drizzle_migrations','SELECT');
CREATE TEMP TABLE want_col (rel text, col text, priv text);
INSERT INTO want_col SELECT 'public.user', c, 'INSERT' FROM unnest(ARRAY['id','name','email','email_verified','image','two_factor_enabled','created_at','updated_at']) c;
INSERT INTO want_col SELECT 'public.user', c, 'UPDATE' FROM unnest(ARRAY['name','email','email_verified','image','updated_at']) c;
INSERT INTO want_col SELECT 'public.session', c, 'INSERT' FROM unnest(ARRAY['id','expires_at','token','created_at','updated_at','ip_address','user_agent','user_id']) c;
INSERT INTO want_col SELECT 'public.session', c, 'UPDATE' FROM unnest(ARRAY['expires_at','token','updated_at','ip_address','user_agent']) c;

-- EFFECTIVE table privileges (PUBLIC included) over every relation in public, app, drizzle, minus the list.
CREATE FUNCTION pg_temp.tbl_extra() RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM (
    SELECT n.nspname||'.'||c.relname||' '||p AS x FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    WHERE n.nspname IN ('public','app','drizzle') AND c.relkind IN ('r','p','v','m','f') AND has_table_privilege('poly_auth', c.oid, p) AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
    EXCEPT SELECT rel||' '||priv FROM want_tbl
  ) q $f$;
CREATE FUNCTION pg_temp.tbl_missing() RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(rel||' '||priv ORDER BY rel, priv), '{}') FROM want_tbl WHERE NOT has_table_privilege('poly_auth', rel, priv) $f$;
SELECT is(pg_temp.tbl_extra(), '{}'::text[], 'effective: poly_auth holds no table privilege outside the list (tenant tables, email_challenge and enrolment_grant included)');
SELECT is(pg_temp.tbl_missing(), '{}'::text[], 'effective: every listed table privilege is held');

-- EFFECTIVE column privileges, minus the list and minus what a held table-level privilege already implies.
CREATE FUNCTION pg_temp.col_extra() RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM (
    SELECT n.nspname||'.'||c.relname||'.'||a.attname||' '||p AS x FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
    WHERE n.nspname IN ('public','app','drizzle') AND c.relkind IN ('r','p','v','m','f') AND has_column_privilege('poly_auth', c.oid, a.attnum, p) AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
    EXCEPT SELECT rel||'.'||col||' '||priv FROM want_col
    EXCEPT SELECT n.nspname||'.'||c.relname||'.'||a.attname||' '||t.priv FROM want_tbl t
      JOIN pg_class c ON c.oid = t.rel::regclass JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
  ) q $f$;
CREATE FUNCTION pg_temp.col_missing() RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(rel||'.'||col||' '||priv ORDER BY rel, col, priv), '{}') FROM want_col WHERE NOT has_column_privilege('poly_auth', rel, col, priv) $f$;
SELECT is(pg_temp.col_extra(), '{}'::text[], 'effective: poly_auth holds no column privilege outside the list');
SELECT is(pg_temp.col_missing(), '{}'::text[], 'effective: every listed column privilege is held');
SELECT ok(NOT has_column_privilege('poly_auth', 'public.session', 'recent_auth_at', 'INSERT') AND NOT has_column_privilege('poly_auth', 'public.session', 'recent_auth_at', 'UPDATE'),
  'pinned absent: INSERT and UPDATE on session.recent_auth_at (R4)');
SELECT ok(NOT has_column_privilege('poly_auth', 'public.user', 'two_factor_enabled', 'UPDATE'), 'pinned absent: UPDATE on user.two_factor_enabled');
SELECT ok(NOT has_column_privilege('poly_auth', 'public.user', 'second_step_at', 'UPDATE') AND NOT has_column_privilege('poly_auth', 'public.user', 'second_step_at', 'INSERT'),
  'pinned absent: user.second_step_at is SELECT only');

-- Sequences: none.
SELECT is((SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname IN ('public','app','drizzle')
  AND (has_sequence_privilege('poly_auth', c.oid, 'USAGE') OR has_sequence_privilege('poly_auth', c.oid, 'SELECT') OR has_sequence_privilege('poly_auth', c.oid, 'UPDATE'))), 0,
  'effective: poly_auth holds no sequence privilege in public, app, drizzle');

-- EFFECTIVE EXECUTE over every function in public, app, drizzle (PUBLIC included): exactly the twenty-four (POLY-137 R9.2 adds method_held and cancel_method_hold).
CREATE TEMP TABLE want_fn (sig text);
INSERT INTO want_fn VALUES ('app.current_user_id()'), ('app.current_session_id()'),
  ('app.enter_new_user(uuid)'), ('app.claim_invitations(bytea,text)'), ('app.accept_invitations(bytea)'), ('app.provision_person()'), ('app.enter_auth_session(text)'),
  ('app.step_up_fresh()'), ('app.enrol_proof(text)'), ('app.enrolment_grant_live()'), ('app.check_factor_removal(uuid,text,uuid)'), ('app.set_two_factor_enabled(boolean)'),
  ('app.consume_passkey_grant()'), ('app.take_recent_auth_stamp(uuid)'), ('app.issue_email_challenge(text)'), ('app.confirm_email_challenge(text)'), ('app.attach_session_handle(uuid,text)'),
  ('app.begin_step_up(text,bytea)'), ('app.complete_step_up(text,uuid,bigint)'), ('app.note_totp_step(uuid,bigint)'), ('app.record_step_up_failure()'), ('app.step_up_challenge_hash(uuid)'), -- POLY-150 Addendum 3 A3/A3.4/A4 and Addendum 6
  ('app.method_held(text,uuid)'), ('app.cancel_method_hold(text)'); -- POLY-137 R3.4, R3.7
CREATE FUNCTION pg_temp.fn_extra() RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM (
    SELECT p.oid::regprocedure::text AS x FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','app','drizzle') AND has_function_privilege('poly_auth', p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    EXCEPT SELECT sig FROM want_fn) q $f$;
SELECT is(pg_temp.fn_extra(), '{}'::text[], 'effective: poly_auth executes no function outside the twenty-four (PUBLIC included)');
SELECT is((SELECT array_agg(sig ORDER BY sig) FROM want_fn WHERE to_regprocedure(sig) IS NULL OR NOT has_function_privilege('poly_auth', to_regprocedure(sig), 'EXECUTE')), NULL::text[],
  'effective: poly_auth executes every one of the twenty-four (a missing or ungranted function is listed)');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app'
  AND p.proname IN ('enter_job','has_role','visible_entities','owner_count','second_step_required','issue_operator_invitation','reset_second_step','purge_tx_identity')
  AND has_function_privilege('poly_auth', p.oid, 'EXECUTE')), 0, 'pinned absent: enter_job, has_role, visible_entities, owner_count, second_step_required, issue_operator_invitation, reset_second_step, purge_tx_identity');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('enter_auth_session','provision_person')
  AND (has_function_privilege('poly_app', p.oid, 'EXECUTE') OR has_function_privilege('poly_worker', p.oid, 'EXECUTE') OR has_function_privilege('poly_operator', p.oid, 'EXECUTE'))), 0,
  'poly_app, poly_worker, poly_operator never execute enter_auth_session or provision_person');

-- POLY-153: the handle table and its readers are not poly_auth's; it attaches a handle only through the definer (R1, R3).
SELECT ok(NOT has_table_privilege('poly_auth', 'app.session_handle', 'SELECT') AND NOT has_table_privilege('poly_auth', 'app.session_handle', 'INSERT'), 'pinned absent: any privilege on app.session_handle (the spike gave SELECT and INSERT; the definer removes both)');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('enter_session','my_sessions','revoke_my_session','recent_auth_ok','session_needs_handle') AND has_function_privilege('poly_auth', p.oid, 'EXECUTE')), 0,
  'pinned absent: enter_session, my_sessions, revoke_my_session, recent_auth_ok, session_needs_handle');

-- Granted to the role itself (the second reading).
SELECT is((SELECT array_agg(DISTINCT table_schema||'.'||table_name ORDER BY table_schema||'.'||table_name) FROM information_schema.role_table_grants WHERE grantee='poly_auth'),
  ARRAY['app.tx_identity','drizzle.__drizzle_migrations','public.account','public.passkey','public.session','public.two_factor','public.user','public.verification'],
  'granted: table grants on exactly the BetterAuth six, tx_identity and __drizzle_migrations');
SELECT is((SELECT count(*)::int FROM information_schema.role_column_grants WHERE grantee='poly_auth' AND table_name NOT IN ('user','session','account','verification','two_factor','passkey','tx_identity','__drizzle_migrations')), 0, 'granted: column grants only on the BetterAuth six, tx_identity and __drizzle_migrations (table-level grants list per column)');
SELECT is((SELECT array_agg(DISTINCT routine_schema||'.'||routine_name ORDER BY routine_schema||'.'||routine_name) FROM information_schema.routine_privileges WHERE grantee='poly_auth'),
  ARRAY['app.accept_invitations','app.attach_session_handle','app.begin_step_up','app.cancel_method_hold','app.check_factor_removal','app.claim_invitations','app.complete_step_up','app.confirm_email_challenge','app.consume_passkey_grant','app.current_session_id','app.current_user_id','app.enrol_proof',
        'app.enrolment_grant_live','app.enter_auth_session','app.enter_new_user','app.issue_email_challenge','app.method_held','app.note_totp_step','app.provision_person','app.record_step_up_failure','app.set_two_factor_enabled','app.step_up_challenge_hash','app.step_up_fresh','app.take_recent_auth_stamp'],
  'granted: routine_privileges lists exactly the twenty-four functions');
SELECT is((SELECT array_agg(tablename::text ORDER BY tablename) FROM pg_policies WHERE 'poly_auth' = ANY (roles)), ARRAY['tx_identity'],
  'no policy names poly_auth except tx_identity_own');
SELECT is((SELECT count(*)::int FROM pg_default_acl d WHERE d.defaclacl::text LIKE '%poly_auth=%'), 0, 'no default privilege grants anything to poly_auth');

-- Canaries: a grant through PUBLIC and a direct one are each caught, so the checks above can fail.
CREATE TABLE public.qa_canary_152 (id int);
GRANT SELECT ON public.qa_canary_152 TO PUBLIC;
SELECT is(pg_temp.tbl_extra(), ARRAY['public.qa_canary_152 SELECT'], 'canary: a SELECT granted through PUBLIC is caught by the effective check');
REVOKE SELECT ON public.qa_canary_152 FROM PUBLIC;
GRANT SELECT ON public.qa_canary_152 TO poly_auth;
SELECT is(pg_temp.tbl_extra(), ARRAY['public.qa_canary_152 SELECT'], 'canary: a direct SELECT is caught');
ROLLBACK;
