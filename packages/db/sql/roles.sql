-- Role bootstrap (ARCH §3.3, SECURITY C-79, C-85; POLY-83 ruling R1). Run by a superuser against the target database, before `migrate`:
-- provision.sh in production, the test harness in CI. Idempotent: every statement converges to the same end state.
-- Not part of the Drizzle chain, because poly_migrator holds no CREATEROLE (and must not).
-- Passwords are not set here; provisioning sets LOGIN passwords with ALTER ROLE from the mounted secret files.

DO $roles$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('poly_owner',    false),
      ('poly_migrator', true),
      ('poly_app',      true),
      ('poly_worker',   true),
      ('poly_operator', true),
      ('poly_auth',     true),
      ('poly_authz',    false),
      ('poly_purge',    false),
      ('poly_rollup',   false),
      ('poly_graph',    false),
      ('poly_stake',    false),
      ('poly_govern',   false),
      ('poly_journal',  false)
    ) AS t(name, login)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.name) THEN
      EXECUTE format('CREATE ROLE %I', r.name);
    END IF;
    EXECUTE format(
      'ALTER ROLE %I %s NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      r.name, CASE WHEN r.login THEN 'LOGIN' ELSE 'NOLOGIN' END);
  END LOOP;

  -- poly_backup (C-79): the one role that bypasses RLS, read-only, for the backup job alone.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'poly_backup') THEN
    CREATE ROLE poly_backup;
  END IF;
  ALTER ROLE poly_backup LOGIN REPLICATION BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 3;
  ALTER ROLE poly_backup SET default_transaction_read_only = on;
END
$roles$;

GRANT pg_read_all_data TO poly_backup;

-- POLY-147 (ruling R10): no plpgsql for the runtime roles. DO blocks and CREATE FUNCTION ... LANGUAGE plpgsql then fail for poly_app,
-- poly_worker, poly_operator, poly_backup and poly_migrator (42501). Calling an existing plpgsql function needs no USAGE, so every
-- definer and trigger runs as before; the roles that create them keep USAGE. Per database, idempotent.
REVOKE USAGE ON LANGUAGE plpgsql FROM PUBLIC;
GRANT USAGE ON LANGUAGE plpgsql TO poly_owner, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal;

-- POLY-147 (ruling R11): the built-ins that run a SQL string are not executable by PUBLIC. A second layer under the definers' exact-call
-- check: with them, one injected fragment could mark a user and read as them in a single statement. EXECUTE goes back to nobody;
-- a superuser bypasses the ACL. Idempotent. Re-run after any restore or major upgrade.
REVOKE EXECUTE ON FUNCTION pg_catalog.query_to_xml(text,boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.query_to_xmlschema(text,boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.query_to_xml_and_xmlschema(text,boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.table_to_xml(regclass,boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.table_to_xmlschema(regclass,boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.table_to_xml_and_xmlschema(regclass,boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.cursor_to_xml(refcursor,integer,boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.cursor_to_xmlschema(refcursor,boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.schema_to_xml(name,boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.schema_to_xmlschema(name,boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.schema_to_xml_and_xmlschema(name,boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.database_to_xml(boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.database_to_xmlschema(boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.database_to_xml_and_xmlschema(boolean,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.ts_stat(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.ts_stat(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pg_catalog.ts_rewrite(tsquery,text) FROM PUBLIC;

-- poly_migrator reaches poly_owner and each definer owner only by SET ROLE (ARCH §6.2, SECURITY C-85):
-- INHERIT FALSE means it cannot use their privileges without switching; no ADMIN OPTION.
GRANT poly_owner, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal
  TO poly_migrator WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;

-- The database belongs to poly_owner; poly_migrator holds no CREATE on it (the drizzle schema is created by poly_owner).
DO $db$
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO poly_owner', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO poly_migrator, poly_app, poly_worker, poly_operator, poly_auth, poly_backup', current_database());
END
$db$;

-- Every function starts unexecutable: grants are explicit (needs a superuser, since poly_owner is not a member of the definer roles).
ALTER DEFAULT PRIVILEGES FOR ROLE poly_owner, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- public: owned by poly_owner, no CREATE for anyone else (SecEng addition (b)).
ALTER SCHEMA public OWNER TO poly_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO poly_app, poly_auth, poly_worker, poly_authz, poly_purge, poly_rollup, poly_graph, poly_stake, poly_govern, poly_journal;
