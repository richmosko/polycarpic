-- POLY-62 (ruling R2-R4, R7): catalog facts of the tenancy core. Superuser reads of pg_catalog only; behaviour as a login role
-- is in tenancy.test.ts. Each assertion names the mutation that turns it red in its message.
BEGIN;
SELECT no_plan();

-- six tables, owned by poly_owner, RLS enabled and forced
SELECT is((SELECT array_agg(relname::text ORDER BY relname COLLATE "C") FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
    AND relname IN ('entity_type', 'entity', 'membership', 'invitation', 'notification', 'audit_event')),
  ARRAY['audit_event', 'entity', 'entity_type', 'invitation', 'membership', 'notification'], 'the six tenancy tables exist');
SELECT is((SELECT array_agg(relname::text ORDER BY relname COLLATE "C") FROM pg_class WHERE relnamespace = 'public'::regnamespace
    AND relname IN ('entity_type', 'entity', 'membership', 'invitation', 'notification', 'audit_event')
    AND relrowsecurity AND relforcerowsecurity AND pg_get_userbyid(relowner) = 'poly_owner'),
  ARRAY['audit_event', 'entity', 'entity_type', 'invitation', 'membership', 'notification'], 'all six: ENABLE + FORCE RLS, owned by poly_owner (mutation: drop FORCE on one)');

-- the five system types and their kinds (R2)
SELECT is((SELECT array_agg(system_key || ':' || kind ORDER BY system_key COLLATE "C") FROM public.entity_type WHERE system_key IS NOT NULL),
  ARRAY['business:base', 'holding:parent', 'household:parent', 'person:base', 'trust:base'], 'five system entity types seeded with their kinds');
SELECT is((SELECT count(*)::int FROM public.entity_type WHERE owner_user_id IS NULL), 5, 'only system types have no owner');

-- primary keys are uuid with a default (criterion 3)
SELECT is((SELECT count(*)::int FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indisprimary AND i.indrelid IN ('public.entity_type'::regclass, 'public.entity'::regclass, 'public.membership'::regclass,
      'public.invitation'::regclass, 'public.notification'::regclass, 'public.audit_event'::regclass) AND a.atttypid = 'uuid'::regtype), 6, 'six uuid primary keys');
SELECT is((SELECT self_user_id_unique FROM (SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'public.entity'::regclass AND i.indisunique AND a.attname = 'self_user_id' AND i.indnatts = 1) AS self_user_id_unique) s), true,
  'entity.self_user_id is unique (mutation: drop the unique constraint)');
SELECT is((SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.entity'::regclass AND attname = 'self_user_id'), false, 'self_user_id is nullable');
SELECT has_column('public', 'entity', 'purged_at', 'entity.purged_at exists for the tombstone');

-- authz functions: STABLE SECURITY DEFINER, owned by poly_authz, search_path pinned (criterion 4)
SELECT is((SELECT array_agg(p.proname::text || ':' || p.provolatile || ':' || p.prosecdef || ':' || pg_get_userbyid(p.proowner) || ':' || ('search_path=""' = ANY (p.proconfig)) ORDER BY p.proname COLLATE "C")
    FROM pg_proc p WHERE p.pronamespace = 'app'::regnamespace AND p.proname IN ('has_role', 'visible_entities', 'owner_count')),
  ARRAY['has_role:s:true:poly_authz:true', 'owner_count:s:true:poly_authz:true', 'visible_entities:s:true:poly_authz:true'],
  'has_role / visible_entities / owner_count: STABLE, SECURITY DEFINER, poly_authz, search_path pinned (mutation: VOLATILE)');
SELECT is((SELECT array_agg(g ORDER BY g COLLATE "C") FROM (SELECT p.proname::text || '=>' || pg_get_userbyid(a.grantee) AS g
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.pronamespace = 'app'::regnamespace AND p.proname IN ('has_role', 'visible_entities', 'owner_count') AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) x),
  ARRAY['has_role=>poly_app', 'has_role=>poly_worker', 'owner_count=>poly_app', 'owner_count=>poly_worker', 'visible_entities=>poly_app', 'visible_entities=>poly_worker'],
  'EXECUTE on the three goes to poly_app and poly_worker only, not PUBLIC');

-- membership is read by the definers through a role-targeted policy
SELECT is((SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = 'public.membership'::regclass AND p.polcmd = 'r'
    AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'poly_authz')]::oid[]), 1,
  'membership has a SELECT policy TO poly_authz alone (mutation: TO PUBLIC, or none)');

-- trigger functions: owners and security mode (R3)
SELECT is((SELECT array_agg(p.proname::text || ':' || p.prosecdef || ':' || pg_get_userbyid(p.proowner) ORDER BY p.proname COLLATE "C") FROM pg_proc p
    WHERE p.pronamespace = 'app'::regnamespace AND p.proname IN ('seat_creator', 'audit_membership')),
  ARRAY['audit_membership:true:poly_govern', 'seat_creator:true:poly_govern'], 'seat_creator and audit_membership are poly_govern definers');
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname COLLATE "C") FROM pg_proc p
    WHERE p.pronamespace = 'app'::regnamespace AND p.proname IN ('keep_an_owner', 'check_tax_classification', 'refuse_change', 'refuse_truncate') AND NOT p.prosecdef),
  ARRAY['check_tax_classification', 'keep_an_owner', 'refuse_change', 'refuse_truncate'], 'the four guard triggers run as invoker');

-- triggers are attached (mutation: drop any one)
SELECT is((SELECT array_agg(c.relname::text || '.' || p.proname::text ORDER BY c.relname COLLATE "C", p.proname COLLATE "C")
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace AND p.proname IN ('seat_creator', 'audit_membership', 'keep_an_owner', 'check_tax_classification', 'refuse_change')),
  ARRAY['audit_event.refuse_change', 'entity.check_tax_classification', 'entity.seat_creator', 'membership.audit_membership', 'membership.keep_an_owner'],
  'seat_creator, check_tax_classification, audit_membership, keep_an_owner and refuse_change are attached to their tables');
SELECT is((SELECT count(*)::int FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal AND p.proname = 'refuse_truncate' AND (t.tgtype & 32) = 32 AND (t.tgtype & 1) = 0 AND (t.tgtype & 2) = 2), 6, 'BEFORE TRUNCATE statement trigger on all six');

-- privileges: no DELETE anywhere for the app or the worker on entity, invitation, notification, audit_event; workers read only
SELECT is((SELECT array_agg(t || ':' || r ORDER BY t COLLATE "C", r COLLATE "C") FROM unnest(ARRAY['entity', 'invitation', 'notification', 'audit_event']) t
    CROSS JOIN unnest(ARRAY['poly_app', 'poly_worker']) r WHERE has_table_privilege(r, 'public.' || t, 'DELETE')), NULL::text[], 'nobody deletes entity, invitation, notification or audit_event');
SELECT is((SELECT array_agg(t ORDER BY t COLLATE "C") FROM unnest(ARRAY['entity_type', 'entity', 'membership', 'invitation', 'notification', 'audit_event']) t
    WHERE NOT has_table_privilege('poly_worker', 'public.' || t, 'SELECT')), NULL::text[], 'poly_worker can read all six');
SELECT is((SELECT array_agg(t || ':' || p ORDER BY t COLLATE "C", p COLLATE "C") FROM unnest(ARRAY['audit_event']) t CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
    WHERE has_table_privilege('poly_app', 'public.' || t, p)), NULL::text[], 'poly_app can only SELECT audit_event');

-- audit_event is inserted only by poly_govern's definer, outside the cascade
SELECT is((SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = 'public.audit_event'::regclass AND p.polcmd = 'a'
    AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'poly_govern')]::oid[]), 1, 'audit_event: one INSERT policy, TO poly_govern');
SELECT is((SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = 'public.membership'::regclass AND p.polcmd = 'a'
    AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'poly_govern')]::oid[]), 1, 'membership: the creator-seat INSERT policy TO poly_govern exists');

SELECT * FROM finish();
ROLLBACK;
