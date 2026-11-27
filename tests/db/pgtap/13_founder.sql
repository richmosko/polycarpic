-- POLY-90 (ruling R1-R7, addenda 1-2; T-R6d, T-R6f): catalog facts of the founder rules and the 1 -> 2 revocation. Behaviour as a
-- login role is in founder.test.ts and owner-transition.test.ts. Each message names the mutation that turns it red.
-- One transaction, rolled back.
BEGIN;
SELECT no_plan();
CREATE FUNCTION pg_temp.src(fn text) RETURNS text LANGUAGE sql AS $f$
  SELECT lower(regexp_replace(coalesce((SELECT string_agg(prosrc, ' ') FROM pg_proc WHERE pronamespace = 'app'::regnamespace AND proname = fn), ''), '--[^\n]*', '', 'g'))
$f$;

-- ---------------------------------------------------------------- R1: the column
SELECT is((SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.entity'::regclass AND a.attname = 'founding_owner_user_id'), 'app.current_user_id()',
  'R1: entity.founding_owner_user_id defaults to app.current_user_id() (mutation: no default)');
SELECT is((SELECT a.attnotnull FROM pg_attribute a WHERE a.attrelid = 'public.entity'::regclass AND a.attname = 'founding_owner_user_id'), false,
  'Addendum 1: no NOT NULL; the tombstone check carries it');
SELECT is((SELECT c.confrelid::regclass::text || ':' || c.confdeltype::text FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.conrelid = 'public.entity'::regclass AND c.contype = 'f' AND a.attname = 'founding_owner_user_id'), '"user":a',
  'R1: the founder references user, ON DELETE no action');
SELECT is((SELECT array_agg(conname::text ORDER BY conname COLLATE "C") FROM pg_constraint WHERE conrelid = 'public.entity'::regclass AND contype = 'c' AND convalidated
    AND conname IN ('entity_founder_tombstone_check', 'entity_person_founder_check')), ARRAY['entity_founder_tombstone_check', 'entity_person_founder_check'],
  'Addendum 1: both founder checks exist and are validated (mutation: drop one, or NOT VALID)');
SELECT is((SELECT array_agg(r.rolname || ':' || p ORDER BY r.rolname COLLATE "C", p) FROM pg_roles r CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE']) p
    WHERE r.rolname LIKE 'poly\_%' AND NOT r.rolsuper AND r.oid <> (SELECT relowner FROM pg_class WHERE oid = 'public.entity'::regclass)
      AND has_column_privilege(r.oid, 'public.entity', 'founding_owner_user_id', p)), ARRAY['poly_govern:UPDATE'],
  'R1/R6: the only grant on the founder column is poly_govern UPDATE (the row lock) (mutation: INSERT or UPDATE to another role)');

-- ---------------------------------------------------------------- R5 / S4: invitation
SELECT is((SELECT array_agg(rolname::text ORDER BY rolname COLLATE "C") FROM pg_roles WHERE NOT rolsuper AND rolname NOT LIKE 'pg\_%'
    AND oid <> (SELECT relowner FROM pg_class WHERE oid = 'public.invitation'::regclass) AND has_column_privilege(oid, 'public.invitation', 'issued_via', 'UPDATE')),
  NULL::text[], 'R5: no role holds UPDATE (issued_via) (mutation: grant it to any role)');
SELECT is((SELECT array_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') ORDER BY policyname COLLATE "C")
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'invitation' AND policyname IN ('invitation_govern_update', 'invitation_bootstrap_revoke')),
  ARRAY['invitation_bootstrap_revoke:UPDATE:poly_govern:((issued_via = ''bootstrap''::text) AND (claimed_at IS NULL)):((issued_via = ''bootstrap''::text) AND (claimed_at IS NULL) AND (revoked_at IS NOT NULL))',
        'invitation_govern_update:UPDATE:poly_govern:true:(claimed_user_id = app.current_user_id())'],
  'T-R6f (S4): invitation_govern_update and invitation_bootstrap_revoke keep their 0007 / 0009 text; a failing revoke is fixed in the new policy, never by loosening these');
SELECT is((SELECT array_agg(p || ':' || a.attname ORDER BY p COLLATE "C", a.attname COLLATE "C") FROM pg_attribute a CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'REFERENCES']) p
    WHERE a.attrelid = 'public.invitation'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('poly_govern', a.attrelid, a.attnum, p)),
  ARRAY['INSERT:email', 'INSERT:expires_at', 'INSERT:issued_via', 'INSERT:role', 'INSERT:token_hash',
        'UPDATE:accepted_at', 'UPDATE:claimed_at', 'UPDATE:claimed_user_id', 'UPDATE:revoked_at'],
  'T-R6f (S4): poly_govern''s column grants on invitation are exactly those of 0007 + 0009');
SELECT ok(NOT has_table_privilege('poly_govern', 'public.invitation', 'INSERT') AND NOT has_table_privilege('poly_govern', 'public.invitation', 'UPDATE')
  AND NOT has_table_privilege('poly_govern', 'public.invitation', 'DELETE'), 'T-R6f: and no table-level write on invitation');
SELECT is((SELECT array_agg(policyname || ':' || cmd ORDER BY policyname COLLATE "C") FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invitation' AND 'poly_govern' = ANY (roles) AND cmd = 'UPDATE'),
  ARRAY['invitation_bootstrap_revoke:UPDATE', 'invitation_govern_transition_revoke:UPDATE', 'invitation_govern_update:UPDATE'],
  'R6: exactly one new UPDATE policy for poly_govern on invitation');
SELECT ok((SELECT coalesce(qual ~ 'issued_via = ''owner''' AND qual ~ 'entity_id IS NOT NULL' AND qual ~ 'revoked_at IS NULL' AND qual ~ 'accepted_at IS NULL'
      AND with_check ~ 'issued_via = ''owner''' AND with_check ~ 'revoked_at IS NOT NULL', false)
    FROM pg_policies WHERE tablename = 'invitation' AND policyname = 'invitation_govern_transition_revoke'),
  'V-6: the transition policy admits only an outstanding direct entity row and only a revocation (mutation: USING (true) or WITH CHECK (true))');

-- ---------------------------------------------------------------- functions
SELECT is((SELECT array_agg(proname::text || ':' || prosecdef || ':' || pg_get_userbyid(proowner) || ':' || coalesce('search_path=""' = ANY (proconfig), false) ORDER BY proname COLLATE "C")
    FROM pg_proc WHERE pronamespace = 'app'::regnamespace AND proname IN ('founder_holds_owner', 'keep_own_person_owner', 'effective_owner_count', 'owner_transition')),
  ARRAY['effective_owner_count:true:poly_authz:true', 'founder_holds_owner:true:poly_authz:true', 'keep_own_person_owner:true:poly_authz:true', 'owner_transition:true:poly_govern:true'],
  'Addendum 1: the four definers, their owners and a pinned search_path');
SELECT is((SELECT provolatile::text FROM pg_proc WHERE pronamespace = 'app'::regnamespace AND proname = 'effective_owner_count'), 'v',
  'effective_owner_count is VOLATILE: its count is read after the lock');
SELECT is((SELECT array_agg(g ORDER BY g COLLATE "C") FROM (SELECT p.proname::text || '=>' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END AS g
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.pronamespace = 'app'::regnamespace AND p.proname IN ('founder_holds_owner', 'keep_own_person_owner', 'effective_owner_count', 'owner_transition')
      AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) x),
  ARRAY['effective_owner_count=>poly_govern'], 'only effective_owner_count is executable, by poly_govern alone');
SELECT ok(strpos(pg_temp.src('owner_transition'), 'for update') > 0 AND strpos(pg_temp.src('owner_transition'), 'for update') < strpos(pg_temp.src('owner_transition'), 'effective_owner_count'),
  'V-3: owner_transition locks the entity row before it counts owners (mutation: count first, or no lock)');
SELECT ok(pg_temp.src('owner_transition') <> '' AND regexp_replace(pg_temp.src('owner_transition'), 'effective_owner_count', '', 'g') !~ 'owner_count',
  'R6 never reads the caller-relative app.owner_count');
SELECT ok(pg_temp.src('owner_transition') <> '' AND pg_temp.src('owner_transition') !~ 'skip\s+locked|nowait|rolsuper',
  'V-4 / Addendum 1: no SKIP LOCKED, no NOWAIT, no superuser exemption in owner_transition');
SELECT ok(pg_temp.src(f) <> '' AND pg_temp.src(f) !~ 'rolsuper', 'L2: no superuser exemption in ' || f)
  FROM unnest(ARRAY['founder_holds_owner', 'keep_own_person_owner']) f;
SELECT ok(strpos(pg_temp.src(f), 'entity not available') > 0 AND pg_temp.src(f) ~ '42501', 'seam: ' || f || ' fails closed with entity not available (42501); no fixture can reach it')
  FROM unnest(ARRAY['keep_own_person_owner', 'owner_transition']) f;

-- ---------------------------------------------------------------- triggers
SELECT is((SELECT array_agg(c.relname || '.' || t.tgname || ':' || p.proname || ':' || t.tgtype || ':' || t.tgdeferrable || ':' || t.tginitdeferred || ':' || (t.tgconstraint <> 0) ORDER BY t.tgname COLLATE "C")
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal AND p.proname IN ('founder_holds_owner', 'keep_own_person_owner', 'owner_transition')),
  ARRAY['entity.entity_z91_founder_holds_owner:founder_holds_owner:21:true:true:true',
        'membership.membership_15_own_person_owner:keep_own_person_owner:27:false:false:false',
        'membership.membership_80_owner_transition:owner_transition:21:false:false:false',
        'membership.membership_91_founder_holds_owner:founder_holds_owner:25:true:true:true'],
  'R2, R4, R6: timing and events (21 = AFTER ROW INSERT OR UPDATE, 27 = BEFORE ROW UPDATE OR DELETE, 25 = AFTER ROW UPDATE OR DELETE); the founder triggers are deferred constraint triggers');
SELECT is((SELECT count(*)::int FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgname IN
    ('entity_z91_founder_holds_owner', 'membership_15_own_person_owner', 'membership_80_owner_transition', 'membership_91_founder_holds_owner')), 4, 'all four are enabled');

-- ---------------------------------------------------------------- T-R6d: the definer owner may lock any entity row and change none
CREATE FUNCTION pg_temp.tried(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  SET LOCAL ROLE poly_govern;
  EXECUTE q INTO r;
  RESET ROLE;
  RETURN coalesce(r, '(none)');
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
INSERT INTO public."user" (id, name, email) VALUES ('00000000-0000-4000-8000-000000009001', 'F', 'f13@qa.test');
INSERT INTO app.tx_identity (xid, user_id, session_id, kind) VALUES (pg_current_xact_id(), '00000000-0000-4000-8000-000000009001', NULL, 'session');
INSERT INTO public.entity (type_id, name, self_user_id) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'person'), 'qa13', '00000000-0000-4000-8000-000000009001');
CREATE TEMP TABLE e13 AS SELECT id FROM public.entity WHERE name = 'qa13';
GRANT SELECT ON e13 TO poly_govern;
DELETE FROM app.tx_identity WHERE xid = pg_current_xact_id();
SELECT is(pg_temp.tried('SELECT id::text FROM public.entity WHERE id = (SELECT id FROM e13) FOR UPDATE'), (SELECT id::text FROM e13),
  'T-R6d positive: poly_govern, no user in context, can lock an entity row (mutation: either lock policy missing)');
SELECT is(pg_temp.tried('UPDATE public.entity SET founding_owner_user_id = founding_owner_user_id WHERE id = (SELECT id FROM e13) RETURNING id::text'),
  '42501 new row violates row-level security policy for table "entity"',
  'T-R6d: and can update none (mutation: entity_govern_lock WITH CHECK (true))');

SELECT * FROM finish();
ROLLBACK;
