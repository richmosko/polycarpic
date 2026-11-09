// (e) FORCE RLS, role-targeted pgPolicy (to:), definer function owned by non-owner NOLOGIN poly_authz; clean on regenerate (A-13).
import { Checker, needChain, q, psql } from './lib.mjs';

const t = new Checker('e', 'FORCE RLS + to: policies + definer fn owned by NOLOGIN poly_authz round-trip as poly_migrator (A-13)');
const s = needChain(t, { needGen2: true });
t.ok(s.h1 === s.h2, 'second generate is not clean (FORCE RLS / role policies / definer fn do not round-trip)');

const c = q(`select relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) from pg_class where oid = to_regclass('public.spike_vault')`).rows[0];
t.need(c, 'table public.spike_vault does not exist after migrate');
t.ok(c[0] === 't', 'RLS not enabled on spike_vault');
t.ok(c[1] === 't', 'FORCE ROW LEVEL SECURITY is not set on spike_vault (pg_class.relforcerowsecurity)');
t.ok(c[2] === 'poly_owner', `spike_vault is owned by ${c[2]}, expected poly_owner`);

const pols = Object.fromEntries(q(`select policyname, roles::text||'/'||cmd from pg_policies where schemaname='public' and tablename='spike_vault'`).rows);
t.ok(pols.spike_vault_authz_select === '{poly_authz}/SELECT', `policy spike_vault_authz_select is ${pols.spike_vault_authz_select ?? 'missing'}, expected {poly_authz}/SELECT`);
t.ok(pols.spike_vault_app_select === '{poly_app}/SELECT', `policy spike_vault_app_select is ${pols.spike_vault_app_select ?? 'missing'}, expected {poly_app}/SELECT`);

const f = q(`select pg_get_userbyid(proowner), prosecdef from pg_proc where oid = to_regprocedure('public.spike_authz_probe()')`).rows[0];
t.need(f, 'function public.spike_authz_probe() does not exist after migrate');
t.ok(f[0] === 'poly_authz', `spike_authz_probe() is owned by ${f[0]}, expected poly_authz`);
t.ok(f[1] === 't', 'spike_authz_probe() is not SECURITY DEFINER');
const r = q(`select rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname='poly_authz'`).rows[0];
t.ok(r[0] === 'f' && r[1] === 'f' && r[2] === 'f', 'poly_authz is not NOLOGIN NOSUPERUSER NOBYPASSRLS');
t.ok(c[2] !== f[0], 'definer function owner equals table owner');

// behaviour: seed as superuser (bypasses RLS), then read as each role
const seed = psql(`insert into public.spike_vault(id, owner_id, secret) values (gen_random_uuid(),'u1','a'),(gen_random_uuid(),'u1','b'),(gen_random_uuid(),'u2','c');`);
t.need(seed.ok, `cannot seed spike_vault: ${seed.err}`);
const app = psql(`set role poly_app; set app.user_id = 'u1'; select count(*) from public.spike_vault; select public.spike_authz_probe();`);
t.ok(app.ok, `poly_app could not read spike_vault / call spike_authz_probe(): ${app.err}`);
t.ok(app.rows[0]?.[0] === '2', `poly_app sees ${app.rows[0]?.[0]} rows through its policy, expected 2 (own rows only)`);
t.ok(app.rows[1]?.[0] === '3', `definer spike_authz_probe() returned ${app.rows[1]?.[0]}, expected 3 (poly_authz sees all via its to: policy)`);
const own = psql(`set role poly_owner; select count(*) from public.spike_vault;`);
t.ok(own.ok && own.rows[0][0] === '0', `table owner poly_owner sees ${own.rows[0]?.[0]} rows, expected 0 (FORCE RLS applies to the owner)`);
t.done();
