-- POLY-84 (ruling R1-R3, R7): the catalog probe for C-13 and its canaries. One query, pg_temp.battery_gaps, guards the
-- real chain and every canary, so the canaries prove the query that guards. Canaries are permanent tables, created
-- and dropped by this file's BEGIN ... ROLLBACK. Superuser-only catalog reads; behaviour as a login role is in battery.test.ts.
BEGIN;
SELECT no_plan();

-- THE EXEMPTION LIST (SECURITY C-13). Adding an entry needs SecEng review of the diff. Nothing is exempted by pattern
-- or schema. two_factor and passkey joined with migration 0004 (POLY-86); a listed-but-absent entry fails below.
CREATE FUNCTION pg_temp.exemptions() RETURNS text[] LANGUAGE sql AS $f$
  SELECT ARRAY['public."user"', 'public.session', 'public.account', 'public.verification', 'public.two_factor', 'public.passkey', 'drizzle.__drizzle_migrations']
$f$;

-- One row per gap. Scope: every relation outside pg_catalog, information_schema, pg_toast, minus temporary relations
-- (session-private; no poly_* role holds TEMP, asserted in 03). Exempt relations are compared by oid.
-- POLY-62 O4: the column-grant allowlist. A column INSERT or UPDATE privilege that poly_app or poly_worker holds on an in-scope
-- table must be named here; a table-level grant counts as every column. Adding an entry needs SecEng review of the diff.
CREATE FUNCTION pg_temp.col_allow() RETURNS text[] LANGUAGE sql AS $f$
  SELECT ARRAY['update:public.entity.name', 'update:public.entity.tax_classification', 'update:public.membership.role',
    'update:public.invitation.revoked_at', 'update:public.notification.read_at',
    'insert:public.entity.type_id', 'insert:public.entity.name', 'insert:public.entity.tax_classification', 'insert:public.entity.self_user_id',
    'insert:public.invitation.entity_id', 'insert:public.invitation.email', 'insert:public.invitation.role', 'insert:public.invitation.inviter_user_id',
    'insert:public.invitation.token_hash', 'insert:public.invitation.expires_at',
    'insert:public.entity_type.name', 'insert:public.entity_type.kind', 'insert:public.entity_type.owner_user_id']
$f$;

CREATE FUNCTION pg_temp.battery_gaps(exempt text[], colallow text[] DEFAULT pg_temp.col_allow()) RETURNS TABLE (rel regclass, reason text) LANGUAGE sql AS $f$
  WITH ex AS (SELECT to_regclass(e)::oid AS oid FROM unnest(exempt) e),
  scope AS (
    SELECT c.*, n.nspname AS nsp FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND c.relpersistence <> 't'
      AND NOT EXISTS (SELECT 1 FROM ex WHERE ex.oid = c.oid))
  SELECT c.oid::regclass, g.reason FROM scope c CROSS JOIN LATERAL (VALUES
    ('rls_disabled',  c.relkind IN ('r', 'p') AND NOT c.relrowsecurity),
    ('not_forced',    c.relkind IN ('r', 'p') AND NOT c.relforcerowsecurity),
    ('no_policy',     c.relkind IN ('r', 'p') AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)),
    ('for_all_policy', c.relkind IN ('r', 'p') AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polcmd = '*')),
    ('no_truncate_trigger', c.relkind IN ('r', 'p') AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid
       AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A') AND (t.tgtype & 1) = 0 AND (t.tgtype & 2) = 2 AND (t.tgtype & 32) = 32)),
    -- POLY-62 R7. pk_not_uuid: C-18, keys are UUIDs.
    ('pk_not_uuid',   c.relkind IN ('r', 'p') AND EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
       WHERE i.indrelid = c.oid AND i.indisprimary AND a.atttypid <> 'uuid'::regtype)),
    -- raw_context_read: the nullif context form lives only in app.current_user_id(); a policy may not read the setting itself.
    ('raw_context_read', c.relkind IN ('r', 'p') AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
       AND (pg_get_expr(p.polqual, p.polrelid) ILIKE '%current_setting%' OR pg_get_expr(p.polwithcheck, p.polrelid) ILIKE '%current_setting%'))),
    -- column_grant_not_allowlisted (O4, replaces a denylist): every column INSERT / UPDATE the app or worker holds must be on the allowlist.
    ('column_grant_not_allowlisted', c.relkind IN ('r', 'p') AND EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN unnest(ARRAY['poly_app', 'poly_worker']) r CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE']) pr
       WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege(r, c.oid, a.attnum, pr)
         AND NOT (lower(pr) || ':' || c.nsp || '.' || c.relname || '.' || a.attname) = ANY (colallow))),
    -- policy_public (N1): every policy names its roles; none applies to PUBLIC.
    ('policy_public', c.relkind IN ('r', 'p') AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND 0 = ANY (p.polroles))),
    -- policy_trivial_for_app (N1): a policy for the app or worker whose qual or check is the constant true admits every row.
    ('policy_trivial_for_app', c.relkind IN ('r', 'p') AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
       AND (0 = ANY (p.polroles) OR p.polroles && ARRAY(SELECT oid FROM pg_roles WHERE rolname IN ('poly_app', 'poly_worker')))
       AND (pg_get_expr(p.polqual, p.polrelid) = 'true' OR pg_get_expr(p.polwithcheck, p.polrelid) = 'true'))),
    ('matview',       c.relkind = 'm'),
    ('foreign_table', c.relkind = 'f'),
    ('view_not_security_invoker', c.relkind = 'v'
       AND NOT (coalesce(c.reloptions, '{}') && ARRAY['security_invoker=true', 'security_invoker=on'])
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'))
  ) g(reason, hit) WHERE g.hit
$f$;
CREATE FUNCTION pg_temp.gaps_of(rels text[], exempt text[], colallow text[] DEFAULT pg_temp.col_allow()) RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(rel::text || ':' || reason ORDER BY rel::text COLLATE "C", reason COLLATE "C"), '{}')
  FROM pg_temp.battery_gaps(exempt, colallow) WHERE rel::text = ANY (rels)
$f$;

-- R2: each exemption exists, so a stale or misspelled entry fails instead of exempting nothing
SELECT ok(to_regclass(e) IS NOT NULL, 'exemption exists: ' || e) FROM unnest(pg_temp.exemptions()) e;
SELECT is(cardinality(pg_temp.exemptions()), 7, 'the exemption list is the seven entries: BetterAuth''s six tables and the migrations ledger');

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
CREATE POLICY s ON public.qa_canary_ok FOR SELECT TO poly_app USING (owner_user_id = app.current_user_id());
CREATE TRIGGER t BEFORE TRUNCATE ON public.qa_canary_ok FOR EACH STATEMENT EXECUTE FUNCTION public.qa_canary_truncate_fn();
-- RLS on, not forced
CREATE TABLE public.qa_canary_noforce (id int);
ALTER TABLE public.qa_canary_noforce ENABLE ROW LEVEL SECURITY;
CREATE POLICY s ON public.qa_canary_noforce FOR SELECT TO poly_app USING (app.current_user_id() IS NOT NULL);
CREATE TRIGGER t BEFORE TRUNCATE ON public.qa_canary_noforce FOR EACH STATEMENT EXECUTE FUNCTION public.qa_canary_truncate_fn();
-- RLS off
CREATE TABLE public.qa_canary_off (id int);
-- FOR ALL policy
CREATE TABLE public.qa_canary_forall (id int);
ALTER TABLE public.qa_canary_forall ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_canary_forall FORCE ROW LEVEL SECURITY;
CREATE POLICY p ON public.qa_canary_forall FOR ALL TO poly_app USING (app.current_user_id() IS NOT NULL) WITH CHECK (app.current_user_id() IS NOT NULL);
CREATE TRIGGER t BEFORE TRUNCATE ON public.qa_canary_forall FOR EACH STATEMENT EXECUTE FUNCTION public.qa_canary_truncate_fn();
-- compliant but for TRUNCATE: a row trigger, an AFTER trigger, a disabled and a replica-only trigger do not count
CREATE TABLE public.qa_canary_notrunc (id int);
ALTER TABLE public.qa_canary_notrunc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_canary_notrunc FORCE ROW LEVEL SECURITY;
CREATE POLICY s ON public.qa_canary_notrunc FOR SELECT TO poly_app USING (app.current_user_id() IS NOT NULL);
CREATE TRIGGER t_row BEFORE DELETE ON public.qa_canary_notrunc FOR EACH ROW EXECUTE FUNCTION public.qa_canary_truncate_fn();
CREATE TRIGGER t_after AFTER TRUNCATE ON public.qa_canary_notrunc FOR EACH STATEMENT EXECUTE FUNCTION public.qa_canary_truncate_fn();
CREATE TRIGGER t_off BEFORE TRUNCATE ON public.qa_canary_notrunc FOR EACH STATEMENT EXECUTE FUNCTION public.qa_canary_truncate_fn();
ALTER TABLE public.qa_canary_notrunc DISABLE TRIGGER t_off;
CREATE TRIGGER t_replica BEFORE TRUNCATE ON public.qa_canary_notrunc FOR EACH STATEMENT EXECUTE FUNCTION public.qa_canary_truncate_fn();
ALTER TABLE public.qa_canary_notrunc ENABLE REPLICA TRIGGER t_replica;
-- partitioned parent compliant, partition child bare (a policy on the parent does not cover a direct query on a child)
CREATE TABLE public.qa_canary_part (id int) PARTITION BY LIST (id);
ALTER TABLE public.qa_canary_part ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_canary_part FORCE ROW LEVEL SECURITY;
CREATE POLICY s ON public.qa_canary_part FOR SELECT TO poly_app USING (app.current_user_id() IS NOT NULL);
CREATE TRIGGER t BEFORE TRUNCATE ON public.qa_canary_part FOR EACH STATEMENT EXECUTE FUNCTION public.qa_canary_truncate_fn();
CREATE TABLE public.qa_canary_part_child PARTITION OF public.qa_canary_part FOR VALUES IN (1);
-- a bare partitioned parent (kind p) is in scope too
CREATE TABLE public.qa_canary_part_bare (id int) PARTITION BY LIST (id);
-- foreign table (needs a wrapper, no extension)
CREATE FOREIGN DATA WRAPPER qa_canary_fdw;
CREATE SERVER qa_canary_srv FOREIGN DATA WRAPPER qa_canary_fdw;
CREATE FOREIGN TABLE public.qa_canary_foreign (id int) SERVER qa_canary_srv;
-- matview, views
CREATE MATERIALIZED VIEW public.qa_canary_mv AS SELECT 1 AS x;
CREATE VIEW public.qa_canary_view AS SELECT 1 AS x;
CREATE VIEW public.qa_canary_view_inv WITH (security_invoker = true) AS SELECT 1 AS x;
CREATE VIEW public.qa_canary_view_on WITH (security_invoker = on) AS SELECT 1 AS x;
-- a temporary relation is out of scope
CREATE TEMP TABLE qa_canary_temp (id int);
-- POLY-62 canaries: each is compliant but for the one reason under test
CREATE TABLE public.qa_canary_pkint (id int PRIMARY KEY);
CREATE TABLE public.qa_canary_pkuuid (id uuid PRIMARY KEY);
CREATE TABLE public.qa_canary_rawctx (id uuid PRIMARY KEY, owner_user_id uuid);
CREATE TABLE public.qa_canary_updcol (id uuid PRIMARY KEY, owner_user_id uuid, note text);
CREATE TABLE public.qa_canary_updok (id uuid PRIMARY KEY, owner_user_id uuid, note text);
CREATE TABLE public.qa_canary_tblgrant (id uuid PRIMARY KEY, note text);
CREATE TABLE public.qa_canary_pubpol (id uuid PRIMARY KEY);
CREATE TABLE public.qa_canary_trivial (id uuid PRIMARY KEY);
CREATE TABLE public.qa_canary_trivok (id uuid PRIMARY KEY);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['qa_canary_pkint', 'qa_canary_pkuuid', 'qa_canary_rawctx', 'qa_canary_updcol', 'qa_canary_updok', 'qa_canary_tblgrant', 'qa_canary_pubpol', 'qa_canary_trivial', 'qa_canary_trivok'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE TRIGGER t BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.qa_canary_truncate_fn()', t);
    IF t NOT IN ('qa_canary_rawctx', 'qa_canary_pubpol', 'qa_canary_trivial', 'qa_canary_trivok') THEN
      EXECUTE format('CREATE POLICY s ON public.%I FOR SELECT TO poly_app USING (app.current_user_id() IS NOT NULL)', t);
    END IF;
  END LOOP;
END $$;
CREATE POLICY s ON public.qa_canary_rawctx FOR SELECT TO poly_app USING (owner_user_id = nullif(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY s ON public.qa_canary_pubpol FOR SELECT USING (app.current_user_id() IS NOT NULL);
CREATE POLICY s ON public.qa_canary_trivial FOR SELECT TO poly_app USING (true);
CREATE POLICY s ON public.qa_canary_trivok FOR SELECT TO poly_authz USING (true);
CREATE POLICY i ON public.qa_canary_trivok FOR INSERT TO poly_govern WITH CHECK (true);
GRANT UPDATE ON public.qa_canary_tblgrant TO poly_app;
GRANT UPDATE (owner_user_id) ON public.qa_canary_updcol TO poly_app;
GRANT UPDATE (note) ON public.qa_canary_updok TO poly_worker;

SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_ok'], pg_temp.exemptions()), '{}'::text[], 'positive control: ENABLE + FORCE + SELECT policy + BEFORE TRUNCATE has no gap');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_noforce'], pg_temp.exemptions()), ARRAY['qa_canary_noforce:not_forced'], 'RLS on but not FORCEd: exactly not_forced');
SELECT ok(pg_temp.gaps_of(ARRAY['qa_canary_off'], pg_temp.exemptions()) @> ARRAY['qa_canary_off:rls_disabled'], 'RLS off: rls_disabled');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_forall'], pg_temp.exemptions()), ARRAY['qa_canary_forall:for_all_policy'], 'a FOR ALL policy: exactly for_all_policy');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_notrunc'], pg_temp.exemptions()), ARRAY['qa_canary_notrunc:no_truncate_trigger'],
  'only an enabled statement-level BEFORE TRUNCATE trigger counts');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_part', 'qa_canary_part_child'], pg_temp.exemptions()),
  ARRAY['qa_canary_part_child:no_policy', 'qa_canary_part_child:no_truncate_trigger', 'qa_canary_part_child:not_forced', 'qa_canary_part_child:rls_disabled'],
  'a partitioned parent passes, its bare partition fails');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_part_bare'], pg_temp.exemptions()),
  ARRAY['qa_canary_part_bare:no_policy', 'qa_canary_part_bare:no_truncate_trigger', 'qa_canary_part_bare:not_forced', 'qa_canary_part_bare:rls_disabled'],
  'a bare partitioned parent (kind p) fails');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_foreign'], pg_temp.exemptions()), ARRAY['qa_canary_foreign:foreign_table'], 'a foreign table fails unless exempted');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_mv'], pg_temp.exemptions()), ARRAY['qa_canary_mv:matview'], 'a materialized view fails unless exempted');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_view', 'qa_canary_view_inv', 'qa_canary_view_on'], pg_temp.exemptions()),
  ARRAY['qa_canary_view:view_not_security_invoker'], 'a view without security_invoker fails; true and on pass');
SELECT is((SELECT count(*)::int FROM pg_temp.battery_gaps(pg_temp.exemptions()) WHERE rel::text LIKE '%qa_canary_temp'), 0, 'a temporary relation is out of scope');
-- POLY-62 R7 reasons. Mutation for each: delete its VALUES line from battery_gaps and the canary goes unreported.
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_pkint'], pg_temp.exemptions()), ARRAY['qa_canary_pkint:pk_not_uuid'], 'an integer primary key: exactly pk_not_uuid (C-18)');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_pkuuid'], pg_temp.exemptions()), '{}'::text[], 'a uuid primary key has no gap');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_rawctx'], pg_temp.exemptions()), ARRAY['qa_canary_rawctx:raw_context_read'], 'a policy reading current_setting itself: exactly raw_context_read');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_updcol'], pg_temp.exemptions()), ARRAY['qa_canary_updcol:column_grant_not_allowlisted'], 'poly_app holding UPDATE on a column off the allowlist: exactly column_grant_not_allowlisted');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_updok'], pg_temp.exemptions()), ARRAY['qa_canary_updok:column_grant_not_allowlisted'], 'poly_worker UPDATE (note) is a gap while it is not on the allowlist');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_updok'], pg_temp.exemptions(), pg_temp.col_allow() || ARRAY['update:public.qa_canary_updok.note']), '{}'::text[], 'the same grant is no gap once the allowlist names it');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_tblgrant'], pg_temp.exemptions()), ARRAY['qa_canary_tblgrant:column_grant_not_allowlisted'], 'a table-level UPDATE counts as every column');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_pubpol'], pg_temp.exemptions()), ARRAY['qa_canary_pubpol:policy_public'], 'a policy with no TO clause applies to PUBLIC: exactly policy_public');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_trivial'], pg_temp.exemptions()), ARRAY['qa_canary_trivial:policy_trivial_for_app'], 'a poly_app policy USING (true): exactly policy_trivial_for_app');
SELECT is(pg_temp.gaps_of(ARRAY['qa_canary_trivok'], pg_temp.exemptions()), '{}'::text[], 'USING (true) TO poly_authz and WITH CHECK (true) TO poly_govern are not a gap');
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
DROP TABLE public.qa_canary_pkint, public.qa_canary_pkuuid, public.qa_canary_rawctx, public.qa_canary_updcol, public.qa_canary_updok,
  public.qa_canary_tblgrant, public.qa_canary_pubpol, public.qa_canary_trivial, public.qa_canary_trivok;
DROP TABLE public.qa_canary_part_bare;
DROP FOREIGN TABLE public.qa_canary_foreign;
DROP SERVER qa_canary_srv;
DROP FOREIGN DATA WRAPPER qa_canary_fdw;
DROP MATERIALIZED VIEW public.qa_canary_mv;
DROP VIEW public.qa_canary_view, public.qa_canary_view_inv, public.qa_canary_view_on;
DROP FUNCTION public.qa_canary_truncate_fn();
SELECT is((SELECT coalesce(array_agg(rel::text), '{}') FROM pg_temp.battery_gaps(pg_temp.exemptions())), '{}'::text[], 'canaries dropped; the chain is clean again');

SELECT * FROM finish();
ROLLBACK;
