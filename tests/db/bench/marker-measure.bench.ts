// POLY-147 R7: the cost of the identity marker. The same read-only withSession transaction 1,000 times, on this tree and on a
// same-day control of `main` against the SAME server. Case S: 1 user, 20 entities, 20 owner memberships. Case L: 2,000 of each
// (ledger-sized, so a per-row evaluation of the policies' current_user_id() shows). Uses only surfaces present on main.
// One JSON line per case: { tree, sha, case, p50_ms, p95_ms, wal_bytes_per_tx }, to stdout and appended to $BENCH_OUT.
import { handleFor } from '../helpers/handle';
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { REAL_MIGRATIONS, dbEnv, freshDb, migrateCli } from '../helpers/api';
import { ROOT, must } from '../helpers/pg';

const N = 1000;
const WARM = 50;
const UID = '00000000-0000-4000-8000-0000000147d1';
const SID = '00000000-0000-4000-8000-0000000147d2';
const sha = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const tree = process.env.BENCH_TREE ?? 'branch';
let dbm: any;
afterAll(async () => { await dbm?.close?.(); });

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!; };

async function measure(label: 'S' | 'L', entities: number) {
  const db = freshDb();
  const r = migrateCli(db, REAL_MIGRATIONS);
  expect(r.code, r.err + r.out).toBe(0);
  must(`SET session_replication_role = replica;
    INSERT INTO public."user" (id, name, email, email_verified) VALUES ('${UID}', 'Bench', 'bench@qa.test', true);
    INSERT INTO public.entity (type_id, name, tax_classification)
      SELECT (SELECT id FROM public.entity_type WHERE system_key = 'business'), 'bench-' || g, 'business_pass_through' FROM generate_series(1, ${entities}) g;
    INSERT INTO public.membership (entity_id, user_id, role) SELECT id, '${UID}', 'owner' FROM public.entity;
    ANALYZE;`, db);
  vi.resetModules();
  dbm = await import('../../../packages/db/src/index.ts');
  await dbm.close();
  dbm.configure({ app: dbEnv('poly_app', db), worker: dbEnv('poly_worker', db), max: 1 });
  const once = () => dbm.withSession(handleFor(db, UID, SID), (tx: any) => tx.execute(dbm.sql`SELECT count(*) FROM public.entity`));
  const first = await once();
  expect(Number((first.rows ?? first)[0].count), 'the owner sees every seeded entity').toBe(entities);
  for (let i = 1; i < WARM; i++) await once();
  must('CHECKPOINT', db);
  const before = must('SELECT pg_current_wal_lsn()::text', db).rows[0]![0]!;
  const ms: number[] = [];
  for (let i = 0; i < N; i++) { const t = performance.now(); await once(); ms.push(performance.now() - t); }
  const wal = Number(must(`SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), '${before}')`, db).rows[0]![0]);
  await dbm.close();
  const line = { tree, sha, case: label, p50_ms: +pct(ms, 0.5).toFixed(3), p95_ms: +pct(ms, 0.95).toFixed(3), wal_bytes_per_tx: +(wal / N).toFixed(1) };
  console.log(JSON.stringify(line));
  if (process.env.BENCH_OUT) appendFileSync(process.env.BENCH_OUT, JSON.stringify(line) + '\n');
}

describe('marker measurement (R7)', () => {
  it('case S: 1 user, 20 entities', async () => { await measure('S', 20); });
  it('case L: 1 user, 2,000 entities', async () => { await measure('L', 2000); });
});
