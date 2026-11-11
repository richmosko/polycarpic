// POLY-96 S96-7: no attacker-influenced expression inside a `run:` body. Usage: node check-run-expr.mjs <dir|file>...
// Event data, head_ref and inputs reach a script through `env:` only.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const BAD = /\$\{\{\s*(github\.event|github\.head_ref|inputs\.)/;

function files(p) {
  if (!existsSync(p)) throw new Error(`${p}: no such path`);
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((e) => files(join(p, e))).filter((f) => /\.ya?ml$/.test(f));
}

const args = process.argv.slice(2);
if (args.length === 0) { console.error('check-run-expr: no path given'); process.exit(2); }
const bad = [];
try {
  for (const a of args) {
    for (const f of files(a)) {
      const doc = parse(readFileSync(f, 'utf8'));
      for (const [id, job] of Object.entries(doc?.jobs ?? {})) {
        for (const s of job.steps ?? []) if (typeof s.run === 'string' && BAD.test(s.run)) bad.push(`${f}: job ${id}: step "${s.name ?? s.id ?? '?'}" interpolates event data in run:`);
      }
    }
  }
} catch (e) { console.error(`check-run-expr: ${e.message}`); process.exit(2); }
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
console.log('check-run-expr: no event expressions in run: bodies');
