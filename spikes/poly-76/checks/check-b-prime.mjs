// (b') BetterAuth's Kysely path reads/writes the Drizzle-declared tables as poly_app with no column mismatch,
// and the ARCH 3.1c grants hold.
import { randomBytes } from 'node:crypto';
import { Checker, needChain, q, psql, url, spikeRequire, spikeImport } from './lib.mjs';

const t = new Checker("b'", 'BetterAuth (Kysely path, as poly_app) works on the Drizzle tables; 3.1c grants hold');
needChain(t);

// grants, from the catalog (ARCH 3.1c)
const has = (tbl, priv) => q(`select has_table_privilege('poly_app','public."${tbl}"','${priv}')`).rows[0][0] === 't';
t.ok(has('user', 'SELECT') && has('user', 'INSERT'), 'poly_app lacks SELECT/INSERT on "user"');
t.ok(!has('user', 'DELETE'), 'poly_app holds DELETE on "user" (3.1c: SELECT, INSERT, UPDATE of BetterAuth columns only)');
t.ok(!has('user', 'TRUNCATE'), 'poly_app holds TRUNCATE on "user"');
const idUpd = q(`select has_column_privilege('poly_app','public."user"',(select attname from pg_attribute where attrelid='public."user"'::regclass and attname='id'),'UPDATE')`).rows[0]?.[0];
t.ok(idUpd === 'f', 'poly_app can UPDATE "user".id (3.1c: never the id)');
for (const tbl of ['session', 'account', 'verification'])
  t.ok(['SELECT', 'INSERT', 'UPDATE', 'DELETE'].every((p) => has(tbl, p)), `poly_app lacks full SELECT/INSERT/UPDATE/DELETE on "${tbl}"`);
t.ok(!has('session', 'TRUNCATE'), 'poly_app holds TRUNCATE on "session"');

// BetterAuth itself
process.env.BETTER_AUTH_SECRET = 'qa-secret-qa-secret-qa-secret-qa-secret-0123';
let pool, auth;
try {
  const { default: pg } = await import(spikeRequire().resolve('pg')).catch(() => ({ default: spikeRequire()('pg') }));
  const mod = await spikeImport('auth.mjs');
  t.need(typeof mod.createAuth === 'function', 'spikes/poly-76/auth.mjs does not export createAuth(pool, opts)');
  pool = new (pg.Pool ?? pg.default.Pool)({ connectionString: url('poly_app') });
  auth = mod.createAuth(pool, {});
} catch (e) { t.need(false, `cannot load the spike's BetterAuth setup (auth.mjs / pg): ${e.message.split('\n')[0]}`); }

const email = `qa-${randomBytes(4).toString('hex')}@example.test`;
try {
  const up = await auth.api.signUpEmail({ body: { email, password: 'qa-Password-123!', name: 'QA' } });
  t.ok(up?.user?.email === email, 'signUpEmail did not return the created user');
  const u = q(`select count(*) from public."user" where email='${email}'`).rows[0][0];
  t.ok(u === '1', `user row not found in "user" after signUpEmail (count ${u})`);
  const a = q(`select count(*) from public.account where "providerId"='credential' and "userId" = (select id from public."user" where email='${email}')`);
  t.ok(a.ok && a.rows[0][0] === '1', `credential account row missing or column names differ${a.ok ? '' : ': ' + a.err.split('\n')[0]}`);
  const si = await auth.api.signInEmail({ body: { email, password: 'qa-Password-123!' }, returnHeaders: true });
  const cookie = si.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  t.ok(cookie.length > 0, 'signInEmail set no session cookie');
  const sess = q(`select count(*) from public.session where "userId" = (select id from public."user" where email='${email}')`);
  t.ok(sess.ok && sess.rows[0][0] === '1', `session row missing or column names differ${sess.ok ? '' : ': ' + sess.err.split('\n')[0]}`);
  const got = await auth.api.getSession({ headers: new Headers({ cookie }) });
  t.ok(got?.user?.email === email, 'getSession (read path) did not return the signed-in user');
} catch (e) { t.ok(false, `BetterAuth call failed as poly_app: ${String(e.message ?? e).split('\n')[0]}`); }

// statements the 3.1c grants forbid are refused by the database as poly_app
for (const [label, sql] of [['DELETE FROM "user"', 'delete from public."user"'], ['UPDATE "user" SET id = id', 'update public."user" set id = id'], ['TRUNCATE "session"', 'truncate public.session']]) {
  try { await pool.query(sql); t.ok(false, `${label} succeeded as poly_app; expected permission denied`); }
  catch (e) { t.ok(e.code === '42501', `${label} failed with ${e.code ?? e.message}, expected 42501 permission denied`); }
}
await pool.end();
t.done();
