-- POLY-84 (ruling R1-R3, R7): the catalog probe for C-13 and its canaries. One query, pg_temp.battery_gaps, guards the
-- real chain and every canary, so the canaries prove the query that guards. Canaries are permanent tables, created
-- and dropped by this file's BEGIN ... ROLLBACK. Superuser-only catalog reads; behaviour as a login role is in battery.test.ts.
BEGIN;
SELECT no_plan();

-- THE EXEMPTION LIST (SECURITY C-13). Adding an entry needs SecEng review of the diff. Nothing is exempted by pattern
-- or schema. twoFactor and passkey join when their migrations land (POLY-86); a listed-but-absent entry fails below.
CREATE FUNCTION pg_temp.exemptions() RETURNS text[] LANGUAGE sql AS $f$
  SELECT ARRAY['public."user"', 'public.session', 'public.account', 'public.verification', 'drizzle.__drizzle_migrations']
$f$;

-- One row per gap. Scope: every relation outside pg_catalog, information_schema, pg_toast, minus temporary relations
-- (session-private; no poly_* role holds TEMP, asserted in 03). Exempt relations are compared by oid.
CREATE FUNCTION pg_temp.battery_gaps(exempt text[]) RETURNS TABLE (rel regclass, reason text) LANGUAGE sql AS $f$ SELECT NULL::regclass, NULL::text WHERE false $f$;  -- RED stub
CREATE FUNCTION pg_temp.gaps_of(rels text[], exempt text[]) RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(rel::text || ':' || reason ORDER BY rel::text COLLATE "C", reason COLLATE "C"), '{}')
  FROM pg_temp.battery_gaps(exempt) WHERE rel::text = ANY (rels)
$f$;

-- R2: each exemption exists, so a stale or misspelled entry fails instead of exempting nothing
SELECT ok(to_regclass(e) IS NOT NULL, 'exemption exists: ' || e) FROM unnest(pg_temp.exemptions()) e;
SELECT is(cardinality(pg_temp.exemptions()), 5, 'the exemption list is the five M1 entries');

-- the real chain: zero gaps (every M1 relation is exempt), and without the list the exempt tables do show up
SELECT is((SELECT coalesce(array_agg(rel::text || ':' || reason), '{}') FROM pg_temp.battery_gaps(pg_temp.exemptions())), '{}'::text[],
  'C-13: the real chain has no RLS / FORCE / policy / TRUNCATE-trigger / view gap');
SELECT ok((SELECT count(DISTINCT rel) FROM pg_temp.battery_gaps('{}')) >= 5, 'without the list the probe reports the exempt tables: the list is what keeps the chain clean');

-- canaries -------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.qa_canary_truncate_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only'; END $$;
-- positive control: ENABLE + FORCE + one SELECT policy + BEFORE TRUNCATE
CREATE TABLE public.qa_canary_ok (id int, owner_user_id uuid);
ALTER TABLE public.qa_canary_ok ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_canary_ok FORCE ROW LEVEL SECURITY;
CREATE POLICY s ON public.qa_canary_ok FOR SELECT USING (owner_user_id = app.current_user_id());
CREATE TRIGGER t BEFORE TRUNCATE ON public.qa_canary_ok FOR EACH STATEMENT EXECUTE FUNCTION public.qa_canary_truncate_fn();
-- RLS on, not forced
CREATE TABLE public.qa_canary_noforce (id int);
ALTER TABLE public.qa_canary_noforce ENABLE ROW LEVEL SECURITY;
CREATE POLICY s ON public.qa_canary_noforce FOR SELECT USING (true);
CREATE TRIGGER t BEFORE TRUNCATE ON public.qa_canary_noforce FOR EACH STATEMENT EXECUTE FUNCTION public.qa_canary_truncate_fn();
-- RLS off
CREATE TABLE public.qa_canary_off (id int);
-- FOR ALL policy
CREATE TABLE public.qa_canary_forall (id int);
ALTER TABLE public.qa_canary_forall ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_canary_forall FORCE ROW LEVEL SECURITY;
CREATE POLICY p ON public.qa_canary_forall FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER t BEFORE TRUNCATE ON public.qa_canary_forall FOR EACH STATEMENT EXECUTE FUNCTION public.qa_canary_truncate_fn();
-- compliant but for TRUNCATE: a row trigger, an AFTER trigger and a disabled trigger do not count
CREATE TABLE public.qa_canary_notrunc (id int);
ALTER TABLE public.qa_canary_notrunc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_canary_notrunc FORCE ROW LEVEL SECURITY;
CREATE POLICY s ON public.qa_canary_notrunc FOR SELECT USING (true);
CREATE TRIGGER t_row BEFORE DELETE ON public.qa_canary_notrunc FOR EACH ROW EXECUTE FUNCTION public.qa_canary_truncate_fn();
CREATE TRIGGER t_after AFTER TRUNCATE ON public.qa_canary_notrunc FOR EACH STATEMENT EXECUTE FUNCTION public.qa_canary_truncate_fn();
CREATE TRIGGER t_off BEFORE TRUNCATE ON public.qa_canary_notrunc FOR EACH STATEMENT EXECUTE FUNCTION public.qa_canary_truncate_fn();
ALTER TABLE public.qa_canary_notrunc DISABLE TRIGGER t_off;
-- partitioned parent compliant, partition child bare (a policy on the parent does not cover a direct query on a child)
CREATE TABLE public.qa_canary_part (id int) PARTITION BY LIST (id);
ALTER TABLE public.qa_canary_part ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_canary_part FORCE ROW LEVEL SECURITY;
CREATE POLICY s ON public.qa_canary_part FOR SELECT USING (true);
CREATE TRIGGER t BEFORE TRUNCATE ON public.qa_canary_part FOR EACH STATEMENT EXECUTE FUNCTION public.qa_canary_truncate_fn();
CREATE TABLE public.qa_canary_part_child PARTITION OF public.qa_canary_part FOR VALUES IN (1);
-- matview, views
CREATE MATERIALIZED VIEW public.qa_canary_mv AS SELECT 1 AS x;
CREATE VIEW public.qa_canary_view AS SELECT 1 AS x;
CREATE VIEW public.qa_canary_view_inv WITH (security_invoker = true) AS SELECT 1 AS x;
CREATE VIEW public.qa_canary_view_on WITH (security_invoker = on) AS SELECT 1 AS x;
-- a temporary relation is out of scope
CREATE TEMP TABLE qa_canary_temp (id int);

SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_ok'], pg_temp.exemptions()), '{}'::text[], 'positive control: ENABLE + FORCE + SELECT policy + BEFORE TRUNCATE has no gap');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_noforce'], pg_temp.exemptions()), ARRAY['qa_canary_noforce:not_forced'], 'RLS on but not FORCEd: exactly not_forced');
SELECT ok(pg_temp.gaps_of(ARRAY['qa_canary_off'], pg_temp.exemptions()) @> ARRAY['qa_canary_off:rls_disabled'], 'RLS off: rls_disabled');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_forall'], pg_temp.exemptions()), ARRAY['qa_canary_forall:for_all_policy'], 'a FOR ALL policy: exactly for_all_policy');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_notrunc'], pg_temp.exemptions()), ARRAY['qa_canary_notrunc:no_truncate_trigger'],
  'only an enabled statement-level BEFORE TRUNCATE trigger counts');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_part', 'qa_canary_part_child'], pg_temp.exemptions()),
  ARRAY['qa_canary_part_child:no_policy', 'qa_canary_part_child:no_truncate_trigger', 'qa_canary_part_child:not_forced', 'qa_canary_part_child:rls_disabled'],
  'a partitioned parent passes, its bare partition fails');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_mv'], pg_temp.exemptions()), ARRAY['qa_canary_mv:matview'], 'a materialized view fails unless exempted');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_view', 'qa_canary_view_inv', 'qa_canary_view_on'], pg_temp.exemptions()),
  ARRAY['qa_canary_view:view_not_security_invoker'], 'a view without security_invoker fails; true and on pass');
SELECT is((SELECT count(*)::int FROM pg_temp.battery_gaps(pg_temp.exemptions()) WHERE rel::text LIKE '%qa_canary_temp'), 0, 'a temporary relation is out of scope');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_off', 'qa_canary_noforce', 'qa_canary_mv'],
  pg_temp.exemptions() || ARRAY['public.qa_canary_off', 'public.qa_canary_noforce', 'public.qa_canary_mv']), '{}'::text[],
  'a canary passed in an extended exempt array has no gap');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_off'], pg_temp.exemptions() || ARRAY['public.qa_canary_%', 'public', 'qa_canary_o']),
  ARRAY['qa_canary_off:no_policy', 'qa_canary_off:no_truncate_trigger', 'qa_canary_off:not_forced', 'qa_canary_off:rls_disabled'],
  'a pattern, a bare schema or a name prefix exempts nothing');

-- R7: every user trigger function refuses a direct call (0A000); the canary proves the loop sees one
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.proname = 'qa_canary_truncate_fn'), 1, 'the canary trigger function exists');
SELECT throws_ok(format('SELECT %s()', p.oid::regproc), '0A000'::char(5), 'trigger functions can only be called as triggers', 'trigger function refuses a direct call: ' || p.oid::regprocedure)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prorettype = 'pg_catalog.trigger'::regtype AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e');

-- cleanup, then the chain is clean again
DROP TABLE public.qa_canary_part_child, public.qa_canary_part, public.qa_canary_ok, public.qa_canary_noforce, public.qa_canary_off,
  public.qa_canary_forall, public.qa_canary_notrunc;
DROP MATERIALIZED VIEW public.qa_canary_mv;
DROP VIEW public.qa_canary_view, public.qa_canary_view_inv, public.qa_canary_view_on;
DROP FUNCTION public.qa_canary_truncate_fn();
SELECT is((SELECT coalesce(array_agg(rel::text), '{}') FROM pg_temp.battery_gaps(pg_temp.exemptions())), '{}'::text[], 'canaries dropped; the chain is clean again');

SELECT * FROM finish();
ROLLBACK;
