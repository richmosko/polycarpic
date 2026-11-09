// (a) A pgPolicy round-trips through drizzle-kit generate twice with no spurious diff.
import fs from 'node:fs';
import path from 'node:path';
import { Checker, needChain, pipeline, q, spikeCmd, treeHash, MIG_DIR, SPIKE } from './lib.mjs';

const t = new Checker('a', 'pgPolicy round-trips through generate -> apply -> generate with no diff');
const s = needChain(t, { needGen2: true });
t.ok(s.h1 === s.h2, `second generate changed drizzle/ (tree ${s.h1} -> ${s.h2}): spurious diff after apply`);

const pol = q(`select cmd, roles::text, (select relrowsecurity from pg_class where oid='public.spike_doc'::regclass)
               from pg_policies where schemaname='public' and tablename='spike_doc' and policyname='spike_doc_owner_select'`);
t.need(pol.ok && pol.rows.length === 1, 'pg_policies has no public.spike_doc policy "spike_doc_owner_select" after migrate');
t.ok(pol.rows[0][0] === 'SELECT', `policy cmd is ${pol.rows[0][0]}, expected SELECT`);
t.ok(pol.rows[0][1] === '{poly_app}', `policy roles are ${pol.rows[0][1]}, expected {poly_app}`);
t.ok(pol.rows[0][2] === 't', 'RLS is not enabled on public.spike_doc');

// Anti-stub: a generate that always says "nothing to do" would pass the above. Prove it is a live diff by
// adding a table + pgPolicy to schema/ and requiring a migration that mentions both; then restore.
const sentinel = path.join(SPIKE, 'schema', 'zz_qa_sentinel.ts');
const backup = fs.mkdtempSync(path.join(SPIKE, '.qa-bak-'));
const hadDir = fs.existsSync(MIG_DIR);
if (hadDir) fs.cpSync(MIG_DIR, path.join(backup, 'drizzle'), { recursive: true });
try {
  if (!fs.existsSync(path.dirname(sentinel))) t.ok(false, 'spikes/poly-76/schema/ does not exist: the Drizzle schema must live in schema/**/*.ts');
  else {
    fs.writeFileSync(sentinel, `import { pgTable, uuid, text, pgPolicy } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const qaSentinel = pgTable('qa_sentinel', { id: uuid('id').primaryKey(), note: text('note') },
  () => [pgPolicy('qa_sentinel_p', { for: 'select', to: 'public', using: sql\`true\` })]).enableRLS();
`);
    const before = treeHash(MIG_DIR);
    const g = spikeCmd('generate');
    const after = treeHash(MIG_DIR);
    const sql = fs.existsSync(MIG_DIR) ? fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).map((f) => fs.readFileSync(path.join(MIG_DIR, f), 'utf8')).join('\n') : '';
    t.ok(g.code === 0, `generate failed on the sentinel schema (exit ${g.code})`);
    t.ok(after !== before, 'generate emitted nothing after a new table + pgPolicy was added to schema/ (generate is not a live diff, or does not read schema/**/*.ts)');
    t.ok(/qa_sentinel/.test(sql) && /CREATE POLICY\s+"?qa_sentinel_p"?/i.test(sql), 'generated SQL does not contain CREATE POLICY "qa_sentinel_p": pgPolicy is not being diffed');
  }
} finally {
  fs.rmSync(sentinel, { force: true });
  fs.rmSync(MIG_DIR, { recursive: true, force: true });
  if (hadDir) fs.cpSync(path.join(backup, 'drizzle'), MIG_DIR, { recursive: true });
  fs.rmSync(backup, { recursive: true, force: true });
}
t.ok(treeHash(MIG_DIR) === s.h2, 'harness failed to restore drizzle/ after the sentinel run');
t.done();
