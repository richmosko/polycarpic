-- POLY-152 (architect 9f6dd25a, seceng ruling-review §7 @ 1aad2af0): what 0014 gives poly_govern, pinned exactly in both directions.
-- poly_govern owns provision_person, claim/accept_invitations and the POLY-89 sync trigger, so its column grants are the reach of those
-- definers. Read twice: has_column_privilege (effective, PUBLIC included) and the policies naming it. Each message names the mutation that
-- turns it red. One transaction, rolled back; the planted-grant tests in pgtap.test.ts show the file bites.
BEGIN;
SELECT no_plan();

-- public."user": no table-level privilege; the column privileges are 0007's, POLY-89's (second_step_at, two_factor_enabled: sync_second_step)
-- and 0014's single SELECT (name). The list is the measured catalog at 0014; an added column fails, a lost one fails.
CREATE TEMP TABLE want_user (col text, priv text);
INSERT INTO want_user VALUES
  ('id','SELECT'), ('email','SELECT'), ('email_verified','SELECT'), ('signup_txid','SELECT'), ('signup_txid','UPDATE'), -- 0007:11-12
  ('name','SELECT'),                                                                                                      -- 0014 (provision_person reads user.name)
  ('second_step_at','SELECT'), ('second_step_at','UPDATE'), ('two_factor_enabled','SELECT'), ('two_factor_enabled','UPDATE'); -- POLY-89 (sync_second_step)
CREATE FUNCTION pg_temp.col_gaps(rel regclass, want regclass) RETURNS text[] LANGUAGE plpgsql AS $f$
DECLARE r text[];
BEGIN
  EXECUTE format($q$
    SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM (
      SELECT a.attname||' '||p||' EXTRA' AS x FROM pg_attribute a CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
       WHERE a.attrelid = %L::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('poly_govern', a.attrelid, a.attnum, p)
         AND NOT EXISTS (SELECT 1 FROM %s w WHERE w.col = a.attname AND w.priv = p)
      UNION ALL
      SELECT w.col||' '||w.priv||' MISSING' FROM %s w WHERE NOT has_column_privilege('poly_govern', %L::regclass, w.col, w.priv)
    ) q$q$, rel, want, want, rel) INTO r;
  RETURN r;
END $f$;
SELECT is(pg_temp.col_gaps('public."user"', 'want_user'), '{}'::text[], 'poly_govern on user: exactly the listed column privileges, none extra and none missing');
SELECT ok(NOT has_table_privilege('poly_govern', 'public."user"', 'SELECT') AND NOT has_table_privilege('poly_govern', 'public."user"', 'UPDATE')
  AND NOT has_table_privilege('poly_govern', 'public."user"', 'INSERT') AND NOT has_table_privilege('poly_govern', 'public."user"', 'DELETE'), 'poly_govern holds no table-level privilege on user');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename = '"user"' OR tablename = 'user'), 0, 'user has no policy (so the column grants are the whole reach)');

-- public.entity: INSERT (type_id, name, self_user_id), SELECT (id, self_user_id) (0014:54-63) and, POLY-90 R6, UPDATE (founding_owner_user_id):
-- the privilege a row lock needs, bound by a policy whose WITH CHECK is false.
CREATE TEMP TABLE want_entity (col text, priv text);
INSERT INTO want_entity VALUES ('type_id','INSERT'), ('name','INSERT'), ('self_user_id','INSERT'), ('id','SELECT'), ('self_user_id','SELECT'), ('founding_owner_user_id','UPDATE');
SELECT is(pg_temp.col_gaps('public.entity', 'want_entity'), '{}'::text[], 'poly_govern on entity: exactly INSERT (type_id, name, self_user_id), SELECT (id, self_user_id) and UPDATE (founding_owner_user_id)');
SELECT ok(NOT has_table_privilege('poly_govern', 'public.entity', 'SELECT') AND NOT has_table_privilege('poly_govern', 'public.entity', 'UPDATE')
  AND NOT has_table_privilege('poly_govern', 'public.entity', 'INSERT') AND NOT has_table_privilege('poly_govern', 'public.entity', 'DELETE'), 'poly_govern holds no table-level privilege on entity');

-- public.entity_type: SELECT (id, system_key).
CREATE TEMP TABLE want_type (col text, priv text);
INSERT INTO want_type VALUES ('id','SELECT'), ('system_key','SELECT');
SELECT is(pg_temp.col_gaps('public.entity_type', 'want_type'), '{}'::text[], 'poly_govern on entity_type: exactly SELECT (id, system_key)');
SELECT ok(NOT has_table_privilege('poly_govern', 'public.entity_type', 'SELECT') AND NOT has_table_privilege('poly_govern', 'public.entity_type', 'INSERT')
  AND NOT has_table_privilege('poly_govern', 'public.entity_type', 'UPDATE'), 'poly_govern holds no table-level privilege on entity_type');

-- Policies naming poly_govern on those tables: exactly the five, with their command and predicate.
SELECT is((SELECT array_agg(tablename||'.'||policyname||':'||cmd||':'||coalesce(qual, '')||':'||coalesce(with_check, '') ORDER BY policyname)
    FROM pg_policies WHERE tablename IN ('entity', 'entity_type') AND 'poly_govern' = ANY (roles)),
  ARRAY['entity.entity_govern_lock:UPDATE:true:false',
        'entity.entity_govern_lock_read:SELECT:true:',
        'entity.entity_provision_insert:INSERT::(self_user_id = app.current_user_id())',
        'entity.entity_provision_read:SELECT:(self_user_id = app.current_user_id()):',
        'entity_type.entity_type_govern_read:SELECT:(system_key = ''person''::text):'],
  'policies naming poly_govern on entity and entity_type are exactly the lock pair (POLY-90: the UPDATE check is false until POLY-112), entity_provision_insert, entity_provision_read, entity_type_govern_read');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename IN ('entity', 'entity_type') AND policyname !~ '^(entity_provision|entity_type_govern|entity_govern_lock)' AND ('poly_govern' = ANY (roles) OR 'public' = ANY (roles))), 0,
  'no other policy on entity or entity_type applies to poly_govern or to PUBLIC');

ROLLBACK;
