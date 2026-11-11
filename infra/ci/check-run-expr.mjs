// POLY-96 S96-7: no attacker-influenced expression inside a `run:` body. Usage: node check-run-expr.mjs <dir|file>...
// Event data, head_ref and inputs reach a script through `env:` only. Dependency-free: the guard job installs nothing.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BAD = /\$\{\{\s*(github\.event|github\.head_ref|inputs\.)/;

function files(p) {
  if (!existsSync(p)) throw new Error(`${p}: no such path`);
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((e) => files(join(p, e))).filter((f) => /\.ya?ml$/.test(f));
}

/** Text of every `run:` value (inline or block scalar) with its starting line. */
export function runBodies(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    let body = m[2];
    if (/^[|>][+-]?\d*\s*$/.test(body)) {
      body = '';
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() !== '' && l.search(/\S/) <= indent) break;
        body += l + '\n';
      }
    }
    out.push({ line: i + 1, body });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.length === 0) { console.error('check-run-expr: no path given'); process.exit(2); }
  const bad = [];
  try {
    for (const a of args) for (const f of files(a)) for (const r of runBodies(readFileSync(f, 'utf8'))) {
      if (BAD.test(r.body)) bad.push(`${f}:${r.line}: run: interpolates event data (move it to env:)`);
    }
  } catch (e) { console.error(`check-run-expr: ${e.message}`); process.exit(2); }
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  console.log('check-run-expr: no event expressions in run: bodies');
}
