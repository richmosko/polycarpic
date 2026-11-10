-- POLY-83 catalog invariants: roles (ARCH §3.3, SECURITY C-79, C-85). Runs after bootstrap + migrate.
BEGIN;
SELECT no_plan();

SELECT has_role(r) FROM unnest(ARRAY['poly_owner','poly_migrator','poly_app','poly_worker','poly_authz','poly_purge',
  'poly_rollup','poly_graph','poly_stake','poly_govern','poly_journal','poly_backup']) r;

SELECT is((SELECT count(*)::int FROM pg_roles WHERE rolname ~ '^poly_' AND rolname <> 'poly_backup'), 11,
  'exactly eleven poly_* roles besides poly_backup');
SELECT is((SELECT count(*)::int FROM pg_roles WHERE rolname ~ '^poly_' AND (rolbypassrls OR rolsuper)
  AND rolname <> 'poly_backup'), 0, 'no poly_* role other than poly_backup bypasses RLS or is superuser');
SELECT is((SELECT array_agg(rolname::text ORDER BY rolname) FROM pg_roles WHERE rolname ~ '^poly_' AND rolcanlogin
  AND rolname <> 'poly_backup'), ARRAY['poly_app','poly_migrator','poly_worker'],
  'LOGIN roles are poly_migrator, poly_app, poly_worker');
SELECT is((SELECT array_agg(rolname::text ORDER BY rolname) FROM pg_roles WHERE rolname ~ '^poly_' AND NOT rolcanlogin),
  ARRAY['poly_authz','poly_govern','poly_graph','poly_journal','poly_owner','poly_purge','poly_rollup','poly_stake'],
  'NOLOGIN roles are the eight owner/definer roles');
SELECT is((SELECT count(*)::int FROM pg_roles WHERE rolname ~ '^poly_' AND (rolcreaterole OR rolcreatedb OR rolreplication)
  AND rolname <> 'poly_backup'), 0, 'no non-backup poly_* role has CREATEROLE/CREATEDB/REPLICATION');

-- poly_backup, C-79
SELECT results_eq($$SELECT rolcanlogin, rolreplication, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole, rolconnlimit
  FROM pg_roles WHERE rolname='poly_backup'$$, $$VALUES (true,true,true,false,false,false,3)$$,
  'poly_backup: LOGIN REPLICATION BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 3');
SELECT ok(EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
  WHERE r.rolname='poly_backup' AND 'default_transaction_read_only=on' = ANY (s.setconfig)),
  'poly_backup default_transaction_read_only = on');
SELECT ok(pg_has_role('poly_backup','pg_read_all_data','MEMBER'), 'poly_backup is a member of pg_read_all_data');
SELECT is((SELECT array_agg(b.rolname::text ORDER BY b.rolname) FROM pg_auth_members m
  JOIN pg_roles b ON b.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE u.rolname='poly_backup'),
  ARRAY['pg_read_all_data'], 'poly_backup belongs to no role other than pg_read_all_data');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants WHERE grantee='poly_backup'
  AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')), 0, 'poly_backup holds no table write grant');
SELECT is((SELECT count(*)::int FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
  WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname='poly_backup')
  AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')),
  0, 'poly_backup has no write ACL entry in pg_class');
SELECT is((SELECT count(*)::int FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname='poly_backup')),
  0, 'poly_backup owns nothing');

-- poly_owner and the definer-owner roles (C-85)
SELECT results_eq($$SELECT rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname='poly_owner'$$,
  $$VALUES (false,false)$$, 'poly_owner is NOLOGIN NOBYPASSRLS');
SELECT is((SELECT array_agg(u.rolname::text ORDER BY u.rolname) FROM pg_auth_members m
  JOIN pg_roles o ON o.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE o.rolname='poly_owner'),
  ARRAY['poly_migrator'], 'poly_migrator is the only member of poly_owner');
SELECT is((SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles u ON u.oid=m.member
  WHERE u.rolname='poly_migrator' AND (m.inherit_option OR NOT m.set_option OR m.admin_option)), 0,
  'every grant to poly_migrator has inherit_option false, set_option true, admin_option false');
SELECT is((SELECT array_agg(o.rolname::text ORDER BY o.rolname) FROM pg_auth_members m
  JOIN pg_roles o ON o.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE u.rolname='poly_migrator'),
  ARRAY['poly_authz','poly_govern','poly_graph','poly_journal','poly_owner','poly_purge','poly_rollup','poly_stake'],
  'poly_migrator holds exactly the owner and seven definer-owner roles');
SELECT is((SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles o ON o.oid=m.roleid
  WHERE o.rolname ~ '^poly_(authz|purge|rollup|graph|stake|govern|journal)$' AND m.member <>
  (SELECT oid FROM pg_roles WHERE rolname='poly_migrator')), 0, 'only poly_migrator is a member of any definer-owner role');

-- poly_migrator owns nothing (C-85)
SELECT is((SELECT count(*)::int FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname='poly_migrator')),0,'migrator owns no pg_class');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname='poly_migrator')),0,'migrator owns no pg_proc');
SELECT is((SELECT count(*)::int FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname='poly_migrator')),0,'migrator owns no pg_namespace');
SELECT is((SELECT count(*)::int FROM pg_type WHERE typowner=(SELECT oid FROM pg_roles WHERE rolname='poly_migrator')),0,'migrator owns no pg_type');
SELECT ok(NOT has_database_privilege('poly_migrator', current_database(), 'CREATE'), 'poly_migrator holds no CREATE on the database');

-- tracking schema
SELECT is((SELECT pg_get_userbyid(nspowner)::text FROM pg_namespace WHERE nspname='drizzle'),'poly_owner','drizzle schema owned by poly_owner');
SELECT is((SELECT pg_get_userbyid(relowner)::text FROM pg_class WHERE oid='drizzle.__drizzle_migrations'::regclass),'poly_owner','tracking table owned by poly_owner');
SELECT ok(has_schema_privilege('poly_app','drizzle','USAGE') AND has_schema_privilege('poly_worker','drizzle','USAGE'),'app and worker have USAGE on drizzle');
SELECT ok(NOT has_schema_privilege('poly_app','drizzle','CREATE') AND NOT has_schema_privilege('poly_worker','drizzle','CREATE'),'app and worker have no CREATE on drizzle');
SELECT ok(has_table_privilege('poly_app','drizzle.__drizzle_migrations','SELECT') AND has_table_privilege('poly_worker','drizzle.__drizzle_migrations','SELECT'),'app and worker SELECT the tracking table');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['poly_app','poly_worker']) r, unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  WHERE has_table_privilege(r,'drizzle.__drizzle_migrations',p)),0,'app and worker hold SELECT only on the tracking table');

-- public schema, app.job_targets
SELECT ok(NOT has_schema_privilege('poly_app','public','CREATE'),'poly_app has no CREATE on public');
SELECT ok(NOT has_schema_privilege('poly_worker','public','CREATE'),'poly_worker has no CREATE on public');
SELECT ok(has_function_privilege('poly_worker','app.job_targets(text)','EXECUTE'),'poly_worker executes app.job_targets');
SELECT ok(NOT has_function_privilege('poly_app','app.job_targets(text)','EXECUTE'),'poly_app cannot execute app.job_targets');
SELECT ok(NOT has_function_privilege('public','app.job_targets(text)','EXECUTE'),'PUBLIC cannot execute app.job_targets');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid='app.job_targets(text)'::regprocedure),'app.job_targets is SECURITY DEFINER');
SELECT is((SELECT array_agg(a.grantee::regrole::text ORDER BY a.grantee::regrole::text) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
  WHERE p.oid='app.job_targets(text)'::regprocedure AND a.privilege_type='EXECUTE' AND a.grantee <> p.proowner),
  ARRAY['poly_worker'], 'EXECUTE on app.job_targets is granted to poly_worker alone');

-- nullif form (A-3)
SELECT matches(pg_get_functiondef('app.current_user_id()'::regprocedure), 'nullif\(\s*(pg_catalog\.)?current_setting\(\s*''app\.user_id''(::text)?,\s*true\s*\),\s*''''(::text)?\s*\)',
  'app.current_user_id() uses the nullif form');

-- ruling R1/R2/R3
SELECT is((SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles u ON u.oid=m.member
  WHERE u.rolname IN ('poly_owner','poly_authz','poly_purge','poly_rollup','poly_graph','poly_stake','poly_govern','poly_journal')), 0,
  'poly_owner and the seven definer-owner roles are members of nothing');
SELECT is((SELECT pg_get_userbyid(datdba)::text FROM pg_database WHERE datname=current_database()), 'poly_owner', 'poly_owner owns the database');
SELECT ok(NOT has_database_privilege('public', current_database(), 'CONNECT'), 'PUBLIC cannot CONNECT');
SELECT ok(has_database_privilege('poly_app', current_database(), 'CONNECT') AND has_database_privilege('poly_worker', current_database(), 'CONNECT')
  AND has_database_privilege('poly_migrator', current_database(), 'CONNECT') AND has_database_privilege('poly_backup', current_database(), 'CONNECT'), 'login roles can CONNECT');
SELECT is((SELECT count(*)::int FROM pg_namespace n, unnest(ARRAY['poly_authz','poly_purge','poly_rollup','poly_graph','poly_stake','poly_govern','poly_journal']) r
  WHERE has_schema_privilege(r, n.oid, 'CREATE') AND n.nspname !~ '^pg_'), 0, 'no definer-owner role holds CREATE on any schema at rest');
SELECT is((SELECT pg_get_userbyid(nspowner)::text FROM pg_namespace WHERE nspname='app'), 'poly_owner', 'schema app owned by poly_owner');
SELECT ok(NOT has_schema_privilege('public','app','USAGE'), 'PUBLIC has no USAGE on app');
SELECT ok(has_schema_privilege('poly_app','app','USAGE') AND has_schema_privilege('poly_worker','app','USAGE'), 'app and worker have USAGE on schema app');
SELECT ok(NOT has_schema_privilege('poly_app','app','CREATE'), 'poly_app has no CREATE on schema app');
SELECT ok(NOT has_schema_privilege('public','public','CREATE'), 'PUBLIC has no CREATE on public');
SELECT ok((SELECT NOT prosecdef AND provolatile = 's' AND proconfig IS NULL AND proowner = 'poly_owner'::regrole FROM pg_proc WHERE oid='app.current_user_id()'::regprocedure),
  'app.current_user_id() is invoker, STABLE, no SET clause, owned by poly_owner');
SELECT is((SELECT pg_get_userbyid(proowner)::text FROM pg_proc WHERE oid='app.job_targets(text)'::regprocedure), 'poly_authz', 'app.job_targets owned by poly_authz');
SELECT ok((SELECT proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid='app.job_targets(text)'::regprocedure), 'app.job_targets pins search_path to empty');
SELECT is((SELECT count(*)::int FROM app.job_targets('any_job')), 0, 'M1: job_targets returns zero rows for every job');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')
  AND has_function_privilege('public', p.oid, 'EXECUTE')), 0, 'no user function is executable by PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_default_acl d WHERE d.defaclobjtype='f' AND EXISTS
  (SELECT 1 FROM aclexplode(d.defaclacl) a WHERE a.grantee=0)), 0, 'no function default-ACL grants EXECUTE to PUBLIC');
SELECT is((SELECT count(DISTINCT d.defaclrole)::int FROM pg_default_acl d WHERE d.defaclobjtype='f'
  AND d.defaclrole IN ('poly_owner'::regrole,'poly_authz'::regrole,'poly_purge'::regrole,'poly_rollup'::regrole,'poly_graph'::regrole,'poly_stake'::regrole,'poly_govern'::regrole,'poly_journal'::regrole)), 8,
  'all eight owner/definer roles carry the function default-ACL revoke');
SELECT ok(EXISTS (SELECT 1 FROM pg_default_acl WHERE defaclrole = 'poly_owner'::regrole AND defaclobjtype='f'), 'poly_owner has a function default-ACL entry');

SELECT * FROM finish();
ROLLBACK;
