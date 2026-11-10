-- POLY-84 (ruling R6): what 01_roles.sql lacks. Superuser catalog reads; canaries inside BEGIN ... ROLLBACK.
BEGIN;
SELECT no_plan();

-- the seven C-10 roles own no pg_class row (poly_owner owns tables by design)
SELECT is((SELECT count(*)::int FROM pg_class c WHERE pg_get_userbyid(c.relowner) IN
  ('poly_authz', 'poly_purge', 'poly_rollup', 'poly_graph', 'poly_stake', 'poly_govern', 'poly_journal')), 0, 'the seven C-10 roles own no relation');

-- login roles hold no TRUNCATE, REFERENCES or TRIGGER on any relation outside pg_catalog / information_schema (directly, via PUBLIC, via membership)
CREATE FUNCTION pg_temp.login_priv_gaps() RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(r || ' ' || p || ' ' || c.oid::regclass::text ORDER BY r, p, c.oid::regclass::text), '{}')
  FROM unnest(ARRAY['poly_app', 'poly_worker', 'poly_migrator', 'poly_backup']) r
  CROSS JOIN unnest(ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']) p
  CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relpersistence <> 't'
    AND has_table_privilege(r, c.oid, p)
$f$;
SELECT is(pg_temp.login_priv_gaps(), '{}'::text[], 'no login role holds TRUNCATE, REFERENCES or TRIGGER on any relation');

-- no poly_* role holds TEMP on the database (R1's temp-relation exclusion rests on this), except poly_owner: it owns
-- the database (roles.sql), so it holds every database privilege implicitly. It is NOLOGIN and reached only by
-- poly_migrator's SET ROLE inside a migration. Measured against the ruling's "none of the twelve"; reported to the architect.
CREATE FUNCTION pg_temp.temp_holders() RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(rolname::text ORDER BY rolname), '{}') FROM pg_roles
  WHERE rolname ~ '^poly_' AND rolname <> 'poly_owner' AND has_database_privilege(oid, current_database(), 'TEMPORARY')
$f$;
SELECT is(pg_temp.temp_holders(), '{}'::text[],
  'no poly_* role but the database owner holds TEMP');
SELECT is((SELECT rolcanlogin FROM pg_roles WHERE rolname = 'poly_owner'), false, 'the database owner poly_owner cannot log in');
SELECT is((SELECT count(*)::int FROM pg_roles WHERE rolname ~ '^poly_'), 12, 'twelve poly_* roles are checked');

-- the installed extensions are exactly plpgsql and the harness's pgTAP, so the extension-member exclusion cannot hide another
SELECT is((SELECT array_agg(extname::text ORDER BY extname) FROM pg_extension), ARRAY['pgtap', 'plpgsql'], 'extensions are exactly {plpgsql, pgtap}');

-- canaries: each check can fail
CREATE TABLE public.qa_canary_priv (id int);
GRANT TRUNCATE ON public.qa_canary_priv TO poly_app;
SELECT is(pg_temp.login_priv_gaps(), ARRAY['poly_app TRUNCATE qa_canary_priv'], 'canary: TRUNCATE granted to poly_app is caught');
REVOKE TRUNCATE ON public.qa_canary_priv FROM poly_app;
GRANT REFERENCES ON public.qa_canary_priv TO PUBLIC;
SELECT is(cardinality(pg_temp.login_priv_gaps()), 4, 'canary: REFERENCES granted to PUBLIC reaches all four login roles');
REVOKE REFERENCES ON public.qa_canary_priv FROM PUBLIC;
CREATE ROLE qa_canary_grp NOLOGIN;
GRANT TRUNCATE ON public.qa_canary_priv TO qa_canary_grp;
GRANT qa_canary_grp TO poly_worker;
SELECT is(pg_temp.login_priv_gaps(), ARRAY['poly_worker TRUNCATE qa_canary_priv'], 'canary: TRUNCATE inherited through a role membership is caught');
REVOKE qa_canary_grp FROM poly_worker;
ALTER TABLE public.qa_canary_priv OWNER TO poly_authz;
SELECT is((SELECT count(*)::int FROM pg_class c WHERE pg_get_userbyid(c.relowner) = 'poly_authz'), 1, 'canary: a table owned by a C-10 role is seen');
DO $c$ BEGIN EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO poly_app', current_database()); END $c$;
SELECT is(pg_temp.temp_holders(), ARRAY['poly_app'], 'canary: TEMP granted to a poly_* role is caught');
DROP TABLE public.qa_canary_priv;
SELECT is(pg_temp.login_priv_gaps(), '{}'::text[], 'canaries dropped; clean again');

SELECT * FROM finish();
ROLLBACK;
