// (S) BetterAuth as a same-origin service: a second Node process from the same workspace serves /api/auth/* behind Caddy on the
// app origin, as poly_auth. The routing pool, the route allowlist, withContextFreeTx sign-up with provisionPerson and claim, and
// the twoFactor hold must work unchanged; the grant list poly_auth needs is read from the catalog, not from the spike's SQL.
import fs from 'node:fs';
import path from 'node:path';
import {
  BA_TABLES, CFG, Jar, Lines, PW, SPIKE, auth, betterAuthFrom, enrolTotp, get, installWriteLog, lit, magicLink, must, one, pinnedVersion, post,
  run, seedInvitation, seedUser, sessionOfJar, sessionsOf, signIn, writersOf,
} from './lib.mjs';

const L = new Lines('S', 'BetterAuth as a same-origin service');
const DEFINERS = JSON.parse(fs.readFileSync(path.resolve(SPIKE, '../../packages/db/sql/definers.json'), 'utf8')).map((d) => d.function);
const ALLOWED_WRITES = new Set([...BA_TABLES, 'app.session_handle']);
const pids = () => {
  const f = path.join(SPIKE, '.run', 'pids.json');
  if (!fs.existsSync(f)) throw new Error('spikes/POLY-148/.run/pids.json is missing (README: bin/up writes it)');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
};
const envOf = (pid) => run('ps', ['eww', '-p', String(pid)]).out;

const defs = [
  ['pinned-version', 'the service process loads the workspace better-auth pin', async (t) => {
    const p = pids();
    t.need(p.serviceEntry, '.run/pids.json names no serviceEntry (the file the service process runs)');
    const entry = path.resolve(SPIKE, p.serviceEntry);
    t.need(fs.existsSync(entry), `serviceEntry ${p.serviceEntry} does not exist`);
    const got = betterAuthFrom(entry);
    t.need(got, `better-auth does not resolve from ${p.serviceEntry} (directly or through @poly/auth)`);
    t.ok(got.version === pinnedVersion(), `the service resolves better-auth ${got.version}; the pin in packages/auth is ${pinnedVersion()}`);
    t.ok(run('ps', ['-o', 'command=', '-p', String(p.service)]).out.includes(path.basename(entry)), `process ${p.service} is not running ${p.serviceEntry}`);
  }],
  ['routed-as-poly_auth', 'a sign-in through Caddy is written by the service, logged in as poly_auth', async (t) => {
    const u = await seedUser();
    const { res, jar } = await signIn(u.email);
    t.need(res.status === 200, `sign-in through Caddy answered ${res.status}: ${res.text.slice(0, 160)}`);
    const s = sessionOfJar(jar);
    t.need(s, 'no session row for the returned cookie');
    const who = writersOf('public.session', s.id);
    t.ok(who.length === 1 && who[0] === 'poly_auth', `the session row was inserted by login role(s) ${who.join(', ') || 'none logged'}; expected poly_auth`);
    const attrs = must(`SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'poly_auth'`)[0];
    t.need(attrs, 'role poly_auth does not exist');
    t.ok(attrs.join() === 't,f,f,f,f', `poly_auth attributes (login, super, bypassrls, createrole, createdb) are ${attrs.join()}; expected t,f,f,f,f`);
  }],
  ['web-serves-no-auth', 'web itself no longer answers /api/auth/*', async (t) => {
    const u = await seedUser();
    const r = await post(auth('/sign-in/email'), { email: u.email, password: PW }, { base: CFG.web });
    t.ok(r.status === 404, `POST ${CFG.web}/api/auth/sign-in/email answered ${r.status}; expected 404`);
    t.ok(sessionsOf(u.id) === 0, 'a sign-in sent straight to web created a session');
  }],
  ['service-serves-only-auth', 'the service answers nothing outside /api/auth/* (and the sign-in pages if moved)', async (t) => {
    for (const p of ['/', '/settings', '/spike/whoami', '/healthz-not-a-route']) {
      const r = await get(p, { base: CFG.service });
      t.ok(r.status === 404, `GET ${CFG.service}${p} answered ${r.status}; expected 404`);
    }
  }],
  ['allowlist', 'blocked and unlisted /api/auth paths answer 404 through Caddy, in every spelling', async (t) => {
    const paths = ['/api/auth/get-session', '/api/auth/list-sessions', '/api/auth/two-factor/get-totp-uri', '/api/auth/delete-user', '/api/auth/nope',
      '/api/auth/GET-SESSION', '/api/auth//get-session/', '/api/auth/%67et-session', '/api/auth/update-session'];
    for (const p of paths) {
      const r = await get(p);
      t.ok(r.status === 404, `GET ${p} answered ${r.status}; expected 404`);
    }
    const ok = await get(auth('/ok'));
    t.ok(ok.status === 200, `the open route /api/auth/ok answered ${ok.status}: the 404s above are not just a dead route`);
  }],
  ['sign-up-invited', 'sign-up with a live invitation: user, Person and claim, all as poly_auth inside one context-free transaction', async (t) => {
    const email = `qa148-inv-${Date.now()}@qa.test`;
    const inv = seedInvitation(email);
    const jar = new Jar();
    const r = await post(auth('/sign-up/email'), { email, password: PW, name: 'QA148 Invited', invitationToken: inv.token }, { jar });
    t.need(r.status === 200, `sign-up answered ${r.status}: ${r.text.slice(0, 160)}`);
    const uid = one(`SELECT id FROM public."user" WHERE email = ${lit(email)}`);
    t.need(uid, 'no user row after a 200 sign-up');
    const person = one(`SELECT id FROM public.entity WHERE self_user_id = ${lit(uid)}`);
    t.ok(person, 'provisionPerson did not run: no Person entity for the new user');
    t.ok(one(`SELECT claimed_user_id FROM public.invitation WHERE token_hash = decode('${inv.hex}', 'hex')`) === uid, 'the invitation is not claimed by the new user');
    for (const [tbl, id] of [['public."user"', uid], ['public.entity', person]].filter(([, id]) => id)) {
      const who = writersOf(tbl.replace(/"/g, ''), id);
      t.ok(who.length === 1 && who[0] === 'poly_auth', `${tbl} row ${id} was inserted by ${who.join(', ') || 'nobody logged'}; expected poly_auth`);
    }
    const invId = one(`SELECT id FROM public.invitation WHERE token_hash = decode('${inv.hex}', 'hex')`);
    const claimBy = writersOf('public.invitation', invId, 'UPDATE');
    t.ok(claimBy.length === 1 && claimBy[0] === 'poly_auth', `the claim was written by ${claimBy.join(', ') || 'nobody logged'}; expected poly_auth`);
  }],
  ['sign-up-refused', 'every refused sign-up is 403 invitation_required and leaves no user row (the routing pool rolls back)', async (t) => {
    const cases = [
      ['no token', (e) => ({ email: e })],
      ['token for another email', (e) => ({ email: e, invitationToken: seedInvitation(`other-${e}`).token })],
      ['expired token', (e) => ({ email: e, invitationToken: seedInvitation(e, { expired: true }).token })],
    ];
    for (const [label, mk] of cases) {
      const email = `qa148-ref-${Math.random().toString(36).slice(2, 8)}@qa.test`;
      const r = await post(auth('/sign-up/email'), { password: PW, name: 'QA148 Refused', ...mk(email) });
      t.ok(r.status === 403 && /invitation_required/.test(r.text), `${label}: answered ${r.status} ${r.text.slice(0, 80)}; expected 403 invitation_required`);
      t.ok(Number(one(`SELECT count(*) FROM public."user" WHERE email = ${lit(email)}`)) === 0, `${label}: a user row was left behind`);
    }
    const email = `qa148-ml-${Math.random().toString(36).slice(2, 8)}@qa.test`;
    try {
      await magicLink(email);
    } catch (e) {
      t.note(`magic link for an unknown email: ${e.message}`);
    }
    t.ok(Number(one(`SELECT count(*) FROM public."user" WHERE email = ${lit(email)}`)) === 0, 'magic-link verify created a user without an invitation');
  }],
  ['two-factor-hold', 'the hold works in the service: an enrolled TOTP user leaves /sign-in/email with no session', async (t) => {
    const u = await seedUser();
    const e = await enrolTotp(u);
    t.need(e.verify.status === 200, `enrolment's verify answered ${e.verify.status}: ${e.verify.text.slice(0, 120)}`);
    const n = sessionsOf(u.id);
    const { res } = await signIn(u.email);
    t.ok(sessionsOf(u.id) === n, 'the held sign-in created a session row');
    t.ok(!res.cookies.some((c) => /session_token$/.test(c.name) && c.value), 'the held sign-in set a session cookie');
    t.ok(res.cookies.some((c) => /two_factor$/.test(c.name) && c.value), 'the held sign-in set no two_factor cookie (the user is stranded)');
  }],
  ['poly_auth-grants', 'every grant poly_auth holds beyond BetterAuth\'s tables, app.session_handle and the existing definers', async (t) => {
    const tables = must(`
      SELECT n.nspname || '.' || c.relname, string_agg(p.priv, ',' ORDER BY p.priv)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
      WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema','qa148') AND n.nspname NOT LIKE 'pg_toast%'
        AND (has_table_privilege('poly_auth', c.oid, p.priv)
             OR (p.priv IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege('poly_auth', c.oid, p.priv)))
      GROUP BY 1 ORDER BY 1`);
    const writes = [];
    for (const [tbl, privs] of tables) {
      const w = privs.split(',').filter((p) => ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'].includes(p));
      if (!ALLOWED_WRITES.has(tbl.replace(/"/g, '')) && w.length) writes.push(`${tbl} ${w.join(',')}`);
      if (!ALLOWED_WRITES.has(tbl.replace(/"/g, ''))) t.note(`table ${tbl}: ${privs}`);
    }
    const fns = must(`
      SELECT p.oid::regprocedure::text, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema','qa148') AND has_function_privilege('poly_auth', p.oid, 'EXECUTE') ORDER BY 1`);
    for (const [fn, def] of fns) if (!DEFINERS.includes(fn)) t.note(`function ${fn}${def === 't' ? ' (SECURITY DEFINER, not in definers.json)' : ''}`);
    t.note(`existing definers poly_auth may execute: ${fns.filter(([f]) => DEFINERS.includes(f)).map(([f]) => f).join(', ') || 'none'}`);
    const roles = must(`SELECT b.rolname FROM pg_auth_members m JOIN pg_roles b ON b.oid = m.roleid JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'poly_auth'`).map((x) => x[0]);
    t.ok(roles.length === 0, `poly_auth is a member of ${roles.join(', ')}`);
    const create = must(`SELECT nspname FROM pg_namespace WHERE has_schema_privilege('poly_auth', oid, 'CREATE')`).map((x) => x[0]);
    t.ok(create.length === 0, `poly_auth can CREATE in schema(s) ${create.join(', ')}`);
    t.ok(writes.length === 0, `tenancy write grant(s) beyond BetterAuth's tables: ${writes.join('; ')}: stage 2's price re-opens (architect-recommendation.md, "What would change my mind")`);
  }],
  ['web-role-reach', 'poly_app (web) reads no BetterAuth secret and writes no session or handle', async (t) => {
    const secretCols = [['public.session', 'token'], ['public.account', 'password'], ['public.account', 'access_token'], ['public.account', 'refresh_token'],
      ['public.account', 'id_token'], ['public.two_factor', 'secret'], ['public.two_factor', 'backup_codes']];
    for (const [tbl, col] of secretCols) {
      const has = one(`SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(${lit(tbl)}) AND attname = ${lit(col)} AND NOT attisdropped)
        THEN has_column_privilege('poly_app', ${lit(tbl)}, ${lit(col)}, 'SELECT')::text ELSE 'absent' END`);
      if (has === 'absent') t.note(`${tbl}.${col} does not exist`);
      else t.ok(has === 'false', `poly_app can SELECT ${tbl}.${col}`);
    }
    t.ok(one(`SELECT has_any_column_privilege('poly_app', 'public.verification', 'SELECT')`) === 'f', 'poly_app can SELECT public.verification');
    for (const tbl of [...BA_TABLES, 'app.session_handle'])
      for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        const has = one(`SELECT CASE WHEN to_regclass(${lit(tbl)}) IS NULL THEN 'absent' ELSE (has_table_privilege('poly_app', ${lit(tbl)}, ${lit(p)})
          OR (${lit(p)} IN ('INSERT','UPDATE') AND has_any_column_privilege('poly_app', ${lit(tbl)}, ${lit(p)})))::text END`);
        if (has === 'absent') t.ok(false, `${tbl} does not exist`);
        else t.ok(has === 'false', `poly_app holds ${p} on ${tbl}`);
      }
  }],
  ['secret-placement', 'the auth secret is in the service process and not in web', async (t) => {
    const p = pids();
    t.need(p.web && p.service, '.run/pids.json lacks web or service');
    t.need(envOf(p.service).includes('BETTER_AUTH_SECRET='), 'control failed: BETTER_AUTH_SECRET is not visible in the service process environment, so its absence in web proves nothing');
    t.ok(!envOf(p.web).includes('BETTER_AUTH_SECRET='), 'web\'s environment carries BETTER_AUTH_SECRET');
  }],
];

L.runAll(defs, () => installWriteLog());
