// POLY-96 action-pin check (C-81, S96-1). Usage: node check-pins.mjs <dir|file>...
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/;
const DOCKER = /^docker:\/\/\S+@sha256:[0-9a-f]{64}$/;
const VERSION = /^#\s*v\d+(\.\d+)*\S*\s*$/;

function files(p) {
  if (!existsSync(p)) throw new Error(`${p}: no such path`);
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((e) => (e === 'node_modules' ? [] : files(join(p, e)))).filter((f) => /\.ya?ml$/.test(f));
}

export function check(file) {
  const bad = [];
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const m = /^\s*(?:-\s+)?uses:\s*(.*)$/.exec(line);
    if (!m) return;
    const rest = m[1];
    const hash = rest.indexOf(' #');
    const ref = (hash < 0 ? rest : rest.slice(0, hash)).trim().replace(/^(["'])(.*)\1$/, '$2');
    const comment = hash < 0 ? '' : rest.slice(hash + 1).trim();
    const at = `${file}:${i + 1}: uses: ${ref}`;
    if (ref.startsWith('./')) return;
    if (DOCKER.test(ref)) return;
    if (!PINNED.test(ref)) bad.push(`${at} is not pinned by a 40-hex sha`);
    else if (!VERSION.test(comment)) bad.push(`${at} has no "# vX.Y.Z" comment`);
  });
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.length === 0) { console.error('check-pins: no path given'); process.exit(2); }
  let bad = [];
  try { for (const a of args) for (const f of files(a)) bad = bad.concat(check(f)); }
  catch (e) { console.error(`check-pins: ${e.message}`); process.exit(2); }
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  console.log('check-pins: all uses: pinned');
}
