// (f) OQ-16 measurement: does user.create.after share the user insert's transaction, and does our own context-free
// transaction around sign-up make provisioning atomic? Reports; does not pass/fail the tool.
import { randomBytes } from 'node:crypto';
import { Checker, needChain, q, psql, url, spikeRequire, spikeImport } from './lib.mjs';

const t = new Checker('f', 'OQ-16: user.create.after transaction sharing; context-free transaction atomicity', { info: true });
needChain(t);
process.env.BETTER_AUTH_SECRET = 'qa-secret-qa-secret-qa-secret-qa-secret-0123';
const setup = psql(`create table if not exists public.qa_probe (user_id text, note text); grant select, insert on public.qa_probe to poly_app; truncate public.qa_probe;`);
t.need(setup.ok, `cannot create qa_probe: ${setup.err}`);

let pool, mod, rp;
try {
  const pg = spikeRequire()('pg');
  mod = await spikeImport('auth.mjs');
  rp = await spikeImport('routing-pool.mjs');
  t.need(typeof mod.createAuth === 'function', 'auth.mjs does not export createAuth(pool, opts)');
  t.need(['createRoutingPool', 'withContextFreeTx', 'currentClient'].every((n) => typeof rp[n] === 'function'), 'routing-pool.mjs must export createRoutingPool, withContextFreeTx, currentClient');
  pool = new pg.Pool({ connectionString: url('poly_app') });
} catch (e) { t.need(false, `cannot load the spike's auth.mjs / routing-pool.mjs / pg: ${e.message.split('\n')[0]}`); }

const em = () => `qa-${randomBytes(4).toString('hex')}@example.test`;
const users = (e) => Number(q(`select count(*) from public."user" where email='${e}'`).rows[0][0]);
const probes = (e) => Number(q(`select count(*) from public.qa_probe where note='${e}'`).rows[0][0]);
const pw = 'qa-Password-123!';
const out = {};

// 1. hook on BetterAuth's own pool: throw from user.create.after
try {
  const e1 = em();
  const a1 = mod.createAuth(pool, { userCreateAfter: async () => { throw new Error('qa-hook-throw'); } });
  const r = await a1.api.signUpEmail({ body: { email: e1, password: pw, name: 'QA' } }).then(() => 'resolved', (x) => 'rejected');
  out.hookShared = users(e1) === 0;
  t.note(`1. hook throws, plain pool: signUp ${r}; user rows left = ${users(e1)} -> ${out.hookShared ? 'user rolled back: hook runs INSIDE the user insert transaction' : 'user persisted: hook runs OUTSIDE the user insert transaction (re-run on session load is the guarantee)'}`);
} catch (e) { t.fails.push(`measurement 1 crashed: ${e.message}`); }

// 2. our context-free transaction around sign-up, hook writes a provisioning row through the transaction's client
const rpool = rp.createRoutingPool(pool);
const hook = (note) => async (user) => { const c = rp.currentClient(); if (!c) throw new Error('hook ran outside the context-free transaction'); await c.query('insert into public.qa_probe(user_id, note) values ($1, $2)', [user.id, note]); };
try {
  const e2 = em();
  const a2 = mod.createAuth(rpool, { userCreateAfter: hook(e2) });
  await rp.withContextFreeTx(pool, async () => { await a2.api.signUpEmail({ body: { email: e2, password: pw, name: 'QA' } }); });
  t.note(`2a. commit path: user rows ${users(e2)}, provisioning rows ${probes(e2)} (both expected 1)`);
  out.commitOk = users(e2) === 1 && probes(e2) === 1;
  const e3 = em();
  const a3 = mod.createAuth(rpool, { userCreateAfter: hook(e3) });
  await rp.withContextFreeTx(pool, async () => { await a3.api.signUpEmail({ body: { email: e3, password: pw, name: 'QA' } }); throw new Error('qa-rollback'); }).catch(() => {});
  t.note(`2b. our tx rolled back after sign-up: user rows ${users(e3)}, provisioning rows ${probes(e3)} (both expected 0)`);
  out.rollbackOk = users(e3) === 0 && probes(e3) === 0;
  const e4 = em();
  const a4 = mod.createAuth(rpool, { userCreateAfter: async (u) => { await hook(e4)(u); throw new Error('qa-hook-throw'); } });
  await rp.withContextFreeTx(pool, async () => { await a4.api.signUpEmail({ body: { email: e4, password: pw, name: 'QA' } }); }).catch(() => {});
  t.note(`2c. hook throws inside our tx: user rows ${users(e4)}, provisioning rows ${probes(e4)} (both expected 0)`);
  out.hookThrowOk = users(e4) === 0 && probes(e4) === 0;
  out.atomic = out.commitOk && out.rollbackOk && out.hookThrowOk;
} catch (e) { t.fails.push(`measurement 2 crashed: ${String(e.message).split('\n')[0]}`); }
await pool.end();
if (!t.fails.length) {
  t.note(`RESULT user.create.after shares the user insert's transaction: ${out.hookShared ? 'YES' : 'NO'}`);
  t.note(`RESULT context-free transaction makes sign-up + provisioning atomic: ${out.atomic ? 'YES' : 'NO'}`);
}
t.done();
