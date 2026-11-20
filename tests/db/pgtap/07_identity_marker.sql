-- POLY-147 (ruling 2027afdb, R1, R2, R5, R8, R10; seceng conditions). The identity marker and its definers, as catalog facts and
-- as the role-level behaviour pgTAP can reach. One transaction, rolled back. Behaviour that needs a fresh transaction id (a
-- definer's success path, the exact-call refusals, savepoints, purge) is in tests/db/identity-marker.test.ts: here a superuser
-- writes the marker (pg_temp.set_id), which no production role can. Each message names the mutation that turns it red.
BEGIN;
SELECT no_plan();

CREATE FUNCTION pg_temp.set_id(uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM app.tx_identity WHERE xid = pg_current_xact_id();
  IF uid <> '' THEN INSERT INTO app.tx_identity (xid, user_id, session_id, kind) VALUES (pg_current_xact_id(), uid::uuid, NULL, 'session'); END IF;
END $$;
-- runs q as role (after the marker for uid, '' = none); returns the single text value, or 'ERR:<sqlstate>'
CREATE FUNCTION pg_temp.run_as(role text, uid text, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM pg_temp.set_id(uid);
  EXECUTE format('SET LOCAL ROLE %I', role);
  EXECUTE q INTO r;
  RESET ROLE;
  PERFORM pg_temp.set_id('');
  RETURN coalesce(r, '');
EXCEPTION WHEN OTHERS THEN RETURN 'ERR:' || SQLSTATE;
END $$;
-- the exact EXECUTE grantees of a function, owner excluded, PUBLIC named
CREATE FUNCTION pg_temp.grantees(f text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END, ',' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END COLLATE "C"), '')
  FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  WHERE p.oid = f::regprocedure AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner
$$;
CREATE FUNCTION pg_temp.fn(nm text) RETURNS regprocedure LANGUAGE sql AS $$
  SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'app'::regnamespace AND p.proname = nm
$$;

-- ---------------------------------------------------------------- K1: the table
SELECT has_table('app', 'tx_identity', 'app.tx_identity exists (mutation: migration 0011 absent)');
SELECT is((SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'tx_identity'),
  'xid:xid8:NO,user_id:uuid:NO,session_id:uuid:YES,kind:text:NO,created_at:timestamp with time zone:NO', 'K1: columns xid8, user_id, session_id (null), kind, created_at, in this order');
SELECT is((SELECT array_agg(a.attname::text) FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey) WHERE i.indrelid = 'app.tx_identity'::regclass AND i.indisprimary), ARRAY['xid'], 'K1: xid is the primary key (a second marker per transaction stays impossible)');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'app.tx_identity'::regclass AND contype = 'f'), 0, 'R1: no foreign key (it would lock the user row on every request)');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'app.tx_identity'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~ 'session' AND NOT pg_get_constraintdef(oid) ~ 'web' AND pg_get_constraintdef(oid) ~ 'signup' AND pg_get_constraintdef(oid) ~ 'system:'), 1, 'R1: a CHECK limits kind to signup, auth, session and system:<job> (no web since POLY-149)');
SELECT is((SELECT pg_get_userbyid(relowner)::text FROM pg_class WHERE oid = 'app.tx_identity'::regclass), 'poly_owner', 'R1: owned by poly_owner');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'app.tx_identity'::regclass), 'R1: RLS enabled and FORCEd (mutation: not forced)');
SELECT is((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END || ':' || a.privilege_type, ',' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END COLLATE "C", a.privilege_type COLLATE "C")
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid = 'app.tx_identity'::regclass AND a.grantee <> c.relowner),
  'poly_app:SELECT,poly_auth:SELECT,poly_authz:INSERT,poly_authz:SELECT,poly_govern:SELECT,poly_graph:SELECT,poly_journal:SELECT,poly_purge:DELETE,poly_purge:SELECT,poly_rollup:SELECT,poly_stake:SELECT,poly_worker:SELECT',
  'R1: the exact ACL minus the owner: SELECT for ten roles (POLY-152: poly_auth), INSERT poly_authz, DELETE poly_purge; no UPDATE, TRUNCATE, REFERENCES, TRIGGER; PUBLIC, poly_operator, poly_backup absent');
SELECT is((SELECT count(*)::int FROM pg_roles r, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE r.rolname IN ('poly_operator', 'poly_migrator') AND has_table_privilege(r.oid, 'app.tx_identity', p)), 0, 'R1: poly_operator and poly_migrator hold no privilege on the marker');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE polrelid = 'app.tx_identity'::regclass), 4, 'R1: exactly four policies');
SELECT is((SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'app.tx_identity'::regclass AND polname = 'tx_identity_own' AND polcmd = 'r'), '(xid = pg_current_xact_id_if_assigned())', 'R1: the read policy is xid = pg_current_xact_id_if_assigned() (mutation: pg_current_xact_id(), which assigns an id)');
SELECT is((SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polrelid = 'app.tx_identity'::regclass AND polname = 'tx_identity_enter' AND polcmd = 'a'), '(xid = pg_current_xact_id())', 'R1: the insert policy checks xid = pg_current_xact_id()');
SELECT is((SELECT array_agg(polname::text ORDER BY polname COLLATE "C") FROM pg_policy WHERE polrelid = 'app.tx_identity'::regclass), ARRAY['tx_identity_enter', 'tx_identity_own', 'tx_identity_purge', 'tx_identity_purge_read'], 'R1: the four policies by name');
SELECT matches((SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'app.tx_identity'::regclass AND polname = 'tx_identity_purge'), 'pg_xact_status\(xid\) IS DISTINCT FROM ''in progress''', 'R1: the purge policy repeats the in-progress guard (IS DISTINCT FROM, never <>)');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE polrelid = 'app.tx_identity'::regclass AND 0 = ANY (polroles)), 0, 'R1: no policy applies to PUBLIC');

SELECT is((SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid = 'app.tx_identity'::regclass AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')
    AND (t.tgtype & 1) = 0 AND (t.tgtype & 2) = 2 AND (t.tgtype & 32) = 32 AND t.tgname = 'tx_identity_no_truncate' AND t.tgfoid = 'app.refuse_truncate()'::regprocedure), 1,
  'R1 (seceng review 4): a BEFORE TRUNCATE statement trigger on the marker table runs app.refuse_truncate() (mutation: the trigger is missing; there is no TRUNCATE exemption)');

CREATE FUNCTION pg_temp.super_truncate() RETURNS text LANGUAGE plpgsql AS $$ BEGIN TRUNCATE app.tx_identity; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN 'ERR:' || SQLSTATE; END $$;
SELECT is(pg_temp.super_truncate(), 'ERR:42501', 'R1 addendum: a TRUNCATE gives 42501 even for a superuser (mutation: the trigger is missing)');

-- ---------------------------------------------------------------- R1 hardening
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['poly_app', 'poly_worker', 'poly_operator']) r WHERE has_database_privilege(r, current_database(), 'TEMP')), 0, 'R1: no runtime role holds TEMP (pg_temp cannot shadow a relation in a definer)');
SELECT is(current_setting('max_prepared_transactions'), '0', 'S1: max_prepared_transactions = 0, so a marked transaction cannot be parked (mutation: the setting is raised)');

-- ---------------------------------------------------------------- R2: the definers (seceng S2)
SELECT is(to_regprocedure('app.enter_asserted_user(uuid, uuid)')::text, NULL, 'POLY-149: enter_asserted_user does not exist');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'app' AND tablename = 'tx_identity' AND 'poly_owner' = ANY (roles)), 0, 'POLY-149 Addendum 7: no tx_identity policy names poly_owner (the delete in 0017 creates its policy and drops it in the same file)');
SELECT is((SELECT pg_get_function_identity_arguments(pg_temp.fn('enter_job'))), 'p_job text, p_entity uuid, p_connection uuid', 'R2: enter_job(p_job text, p_entity uuid, p_connection uuid)');
SELECT is((SELECT pg_get_function_identity_arguments(pg_temp.fn('enter_new_user'))), 'uuid', 'R2: enter_new_user(uuid), the unnamed argument kept');
SELECT is((SELECT pg_get_function_identity_arguments(pg_temp.fn('purge_tx_identity'))), '', 'R2: purge_tx_identity() takes no argument, so the caller cannot choose the age');
SELECT is((SELECT pg_get_function_result(pg_temp.fn('purge_tx_identity'))), 'integer', 'R2: purge_tx_identity returns the row count');
SELECT is((SELECT string_agg(p.proname || ':' || pg_get_userbyid(p.proowner) || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), 'none') || ':' || pg_get_function_result(p.oid), ',' ORDER BY p.proname COLLATE "C")
    FROM pg_proc p WHERE p.pronamespace = 'app'::regnamespace AND p.proname IN ('enter_job', 'enter_new_user', 'purge_tx_identity')),
  'enter_job:poly_authz:true:search_path="":text,enter_new_user:poly_authz:true:search_path="":void,purge_tx_identity:poly_purge:true:search_path="":integer',
  'R2: owners poly_authz / poly_purge, SECURITY DEFINER, search_path pinned empty, results text, void, integer');
SELECT is((SELECT string_agg(p.proname, ',' ORDER BY p.proname COLLATE "C") FROM pg_proc p WHERE p.pronamespace = 'app'::regnamespace AND p.proname IN ('enter_job', 'enter_new_user') AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')), 'enter_job,enter_new_user', 'R2: the identity definers enter_job and enter_new_user are plpgsql');
SELECT is(pg_temp.grantees(pg_temp.fn('enter_job')::text), 'poly_worker', 'J1: EXECUTE on enter_job: poly_worker alone');
SELECT is(pg_temp.grantees('app.enter_new_user(uuid)'), 'poly_auth', 'K3: EXECUTE on enter_new_user: poly_auth alone (POLY-152 R8)');
SELECT is(pg_temp.grantees(pg_temp.fn('purge_tx_identity')::text), 'poly_worker', 'K4: EXECUTE on purge_tx_identity: poly_worker alone');
SELECT is(pg_temp.grantees(pg_temp.fn('current_session_id')::text), 'poly_app,poly_auth,poly_authz,poly_govern', 'R1: EXECUTE on current_session_id: poly_app, poly_govern and, from POLY-153 R2, poly_authz (the owner of my_sessions and revoke_my_session) (the definer owner whose POLY-89 functions read the marker session; seceng fffd8abb); never PUBLIC, poly_authz or poly_worker');
SELECT is(pg_temp.grantees('app.job_targets(text)'), '', 'J1: job_targets has no EXECUTE grantee but its owner');
SELECT ok(has_function_privilege('poly_app', 'app.current_user_id()', 'EXECUTE') AND has_function_privilege('poly_worker', 'app.current_user_id()', 'EXECUTE') AND NOT has_function_privilege('public', 'app.current_user_id()', 'EXECUTE'), 'R1: current_user_id grants unchanged: poly_app and poly_worker, not PUBLIC');
SELECT is((SELECT string_agg(p.proname || '=>' || pg_temp.grantees(p.oid::regprocedure::text), ';' ORDER BY p.proname COLLATE "C") FROM pg_proc p WHERE p.pronamespace = 'app'::regnamespace AND p.proname LIKE 'enter\_%'),
  'enter_auth_session=>poly_auth;enter_job=>poly_worker;enter_new_user=>poly_auth;enter_session=>poly_app', 'I1: every app.enter_* function, with its exact EXECUTE set; an unlisted enter_* fails here');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'app'::regnamespace AND p.proname ~ '^(enter_|purge_tx)' AND pg_get_function_arguments(p.oid) ~* 'kind'), 0, 'J3: no definer takes a kind argument; the kind comes from the body');

-- ---------------------------------------------------------------- R11: no "run a SQL string" built-in for PUBLIC
CREATE FUNCTION pg_temp.sqlstr() RETURNS SETOF pg_proc LANGUAGE sql AS $$
  SELECT p.* FROM pg_proc p WHERE p.pronamespace = 'pg_catalog'::regnamespace
    AND (p.proname ~ '^(query|table|cursor|schema|database)_to_xml' OR p.proname = 'ts_stat' OR p.oid = 'pg_catalog.ts_rewrite(tsquery, text)'::regprocedure)
$$;
SELECT is((SELECT count(*)::int FROM pg_temp.sqlstr()), 17, 'R11: 17 functions match the pattern on this Postgres (a function a later version adds under these names fails here until listed)');
SELECT is((SELECT count(*)::int FROM pg_temp.sqlstr() p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner), 0,
  'R11: no grantee but the owner holds EXECUTE on any of them, PUBLIC absent (mutation: the REVOKE lines are missing from roles.sql)');
SELECT is((SELECT count(*)::int FROM pg_temp.sqlstr() p, unnest(ARRAY['poly_app', 'poly_worker', 'poly_operator']) r WHERE has_function_privilege(r, p.oid, 'EXECUTE')), 0, 'R11: poly_app, poly_worker and poly_operator cannot execute any of them');

-- ---------------------------------------------------------------- K2: a forged setting grants nothing
INSERT INTO public."user" (id, name, email, email_verified) VALUES ('00000000-0000-4000-8000-0000000147a1', 'K2 owner', 'k2owner@qa.test', true);
-- POLY-89: the fixture owner is enrolled (a verified factor and the flag) before creating a Business
INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s', 'b', '00000000-0000-4000-8000-0000000147a1', true);
UPDATE public."user" SET two_factor_enabled = true WHERE id = '00000000-0000-4000-8000-0000000147a1';
SELECT pg_temp.set_id('00000000-0000-4000-8000-0000000147a1');
INSERT INTO public.entity (id, type_id, name, tax_classification) VALUES ('00000000-0000-4000-8000-0000000147e1',
  (SELECT id FROM public.entity_type WHERE system_key = 'business'), 'qa-K2', 'business_pass_through');
INSERT INTO public.entity_type (name, kind, owner_user_id) VALUES ('K2 Club', 'base', '00000000-0000-4000-8000-0000000147a1');
INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at)
  VALUES ('00000000-0000-4000-8000-0000000147e1', 'k2inv@qa.test', 'viewer', '00000000-0000-4000-8000-0000000147a1', sha256('k2'::bytea), now() + interval '1 day');
INSERT INTO public.notification (entity_id, recipient_user_id, kind) VALUES ('00000000-0000-4000-8000-0000000147e1', '00000000-0000-4000-8000-0000000147a1', 'qa.k2');
SELECT pg_temp.set_id('');
SELECT is(pg_temp.run_as(r, '00000000-0000-4000-8000-0000000147a1', format($q$SELECT (SELECT count(*) FROM public.%I WHERE %s) > 0$q$, t, CASE WHEN t = 'entity_type' THEN 'name = ''K2 Club''' ELSE 'true' END)), 'true',
  'K2 control: with the marker, ' || r || ' sees rows of ' || t || ', so each zero below is the forged setting not counting')
  FROM unnest(ARRAY['poly_app', 'poly_worker']) r, unnest(ARRAY['entity', 'membership', 'invitation', 'audit_event', 'notification', 'entity_type']) t;
SELECT is(pg_temp.run_as('poly_app', '00000000-0000-4000-8000-0000000147a1', $q$SELECT count(*)::text FROM public.entity$q$), '1', 'K2 control: with the marker, the owner sees the entity, so the zeros below are the forged setting not counting');
SELECT is(pg_temp.run_as('poly_app', '', $q$SELECT set_config('app.user_id', '00000000-0000-4000-8000-0000000147a1', true) || '|' || coalesce(app.current_user_id()::text, 'null')$q$), '00000000-0000-4000-8000-0000000147a1|null', 'K2: poly_app, forged app.user_id: current_user_id() is null (mutation: the body reads the setting)');
SELECT is(pg_temp.run_as('poly_worker', '', $q$SELECT set_config('app.user_id', '00000000-0000-4000-8000-0000000147a1', true) || '|' || coalesce(app.current_user_id()::text, 'null')$q$), '00000000-0000-4000-8000-0000000147a1|null', 'K2: poly_worker, forged app.user_id: current_user_id() is null');
SELECT is(pg_temp.run_as(r, '', format($q$SELECT (set_config('app.user_id', '00000000-0000-4000-8000-0000000147a1', true) IS NOT NULL AND (SELECT count(*) FROM public.%I WHERE %s) = 0)::text$q$, t, CASE WHEN t = 'entity_type' THEN 'name = ''K2 Club''' ELSE 'true' END)), 'true', 'K2: ' || r || ' with a forged setting reads zero rows of ' || t)
  FROM unnest(ARRAY['poly_app', 'poly_worker']) r, unnest(ARRAY['entity', 'membership', 'invitation', 'audit_event', 'notification', 'entity_type']) t;
SELECT is(pg_temp.run_as('poly_operator', '', $q$SELECT set_config('app.user_id', '00000000-0000-4000-8000-0000000147a1', true) || app.current_user_id()::text$q$), 'ERR:42501', 'K2 (OQ-2): poly_operator, forged setting: current_user_id() is refused 42501, no new grant');
SELECT is(pg_temp.run_as('poly_operator', '', $q$SELECT count(*)::text FROM app.tx_identity$q$), 'ERR:42501', 'K2 (OQ-2): poly_operator cannot read the marker table');

-- ---------------------------------------------------------------- no production role can write the marker
SELECT is(pg_temp.run_as(r, '', s), 'ERR:42501', 'K1: ' || r || ' cannot ' || split_part(s, ' ', 1) || ' the marker table')
  FROM unnest(ARRAY['poly_app', 'poly_worker']) r,
       unnest(ARRAY['INSERT INTO app.tx_identity (xid, user_id, kind) VALUES (pg_current_xact_id(), ''00000000-0000-4000-8000-0000000147a1'', ''web'')',
                    'UPDATE app.tx_identity SET user_id = ''00000000-0000-4000-8000-0000000147a1''',
                    'DELETE FROM app.tx_identity',
                    'TRUNCATE app.tx_identity']) s;
SELECT is(pg_temp.run_as('poly_purge', '', $q$SELECT count(*)::text FROM (SELECT 1 FROM app.tx_identity WHERE false) s$q$), '0', 'K1 control: poly_purge may read the marker table');
SELECT is(pg_temp.run_as('poly_authz', '', $q$UPDATE app.tx_identity SET kind = 'web'$q$), 'ERR:42501', 'K1: even the definer owner holds no UPDATE');
SELECT is(pg_temp.run_as('poly_authz', '', $q$DELETE FROM app.tx_identity$q$), 'ERR:42501', 'K1: ...and no DELETE (only the purge definer owner has it)');

-- ---------------------------------------------------------------- no app.session_id reader; only the marker functions read the marker
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('app', 'public') AND p.prosrc ILIKE '%app.session_id%'), 0, 'S9: no function body in app or public mentions app.session_id');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE pg_get_expr(polqual, polrelid) ILIKE '%app.session_id%' OR pg_get_expr(polwithcheck, polrelid) ILIKE '%app.session_id%'), 0, 'S9: no policy mentions app.session_id');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('app', 'public') AND p.prosrc ILIKE '%app.user_id%'), 0, 'K2: no function body mentions app.user_id any more');
SELECT is((SELECT string_agg(p.proname, ',' ORDER BY p.proname COLLATE "C") FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('app', 'public') AND p.prosrc ILIKE '%tx\_identity%'),
  'audit_membership,begin_step_up,complete_step_up,current_session_id,current_user_id,enter_auth_session,enter_job,enter_new_user,enter_session,my_second_step,my_sessions,provision_person,purge_tx_identity,recent_auth_ok,record_step_up_failure,revoke_my_session,step_up_challenge_hash,sync_second_step', 'R8: only these eighteen functions (POLY-150 Addendum 3 A3, 5 and 6: begin_step_up, complete_step_up, record_step_up_failure and step_up_challenge_hash read the marker for kind auth and the callers own session, and sync_second_step reads it for the audit actor; POLY-150: my_second_step reads the marker for kind session; POLY-153: enter_session, my_sessions, recent_auth_ok, revoke_my_session read the marker for kind session; POLY-152: enter_auth_session, provision_person per R3) read or write the marker table (mutation: a new reader)');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE pg_get_expr(polqual, polrelid) ILIKE '%tx\_identity%' AND polrelid <> 'app.tx_identity'::regclass), 0, 'R8: no policy outside the marker table reads it directly');
SELECT matches((SELECT prosrc FROM pg_proc WHERE oid = 'app.audit_membership()'::regprocedure), 'tx_identity', 'R1: audit_membership reads the actor label from the marker');

-- ---------------------------------------------------------------- R10: no plpgsql for the runtime roles
SELECT is((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END, ',' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END COLLATE "C")
    FROM pg_language l CROSS JOIN LATERAL aclexplode(l.lanacl) a WHERE l.lanname = 'plpgsql' AND a.privilege_type = 'USAGE' AND a.grantee <> l.lanowner),
  'poly_authz,poly_govern,poly_graph,poly_journal,poly_owner,poly_purge,poly_rollup,poly_stake', 'R10: USAGE on plpgsql is held by exactly the eight owner roles; PUBLIC absent (mutation: the REVOKE is missing)');
SELECT is((SELECT count(*)::int FROM pg_language WHERE laninline <> 0 AND lanname <> 'plpgsql'), 0, 'R10: no other language has an inline handler (no DO in another language)');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['poly_app', 'poly_worker', 'poly_operator', 'poly_backup', 'poly_migrator']) r WHERE has_language_privilege(r, 'plpgsql', 'USAGE')), 0, 'R10: no login role can use plpgsql');

SELECT * FROM finish();
ROLLBACK;
