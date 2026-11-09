#!/usr/bin/env node
// Entry point: node spikes/poly-76/checks/run.mjs  [a b b-prime c e f]
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ALL = [['a', 'check-a.mjs', true], ['b', 'check-b.mjs', true], ['b-prime', 'check-b-prime.mjs', true], ['c', 'check-c.mjs', true], ['e', 'check-e.mjs', true], ['f', 'check-f.mjs', false]];
const pick = process.argv.slice(2);
const env = { ...process.env, POLY76_RUN_ID: randomBytes(4).toString('hex') };
let flipFail = false, unmeasured = false;
const rows = [];
for (const [id, file, flips] of ALL) {
  if (pick.length && !pick.includes(id)) continue;
  const r = spawnSync('node', [path.join(here, file)], { env, encoding: 'utf8', timeout: 600_000 });
  const text = (r.stdout + (r.stderr ? `\n  stderr: ${r.stderr.trim().split('\n').slice(-3).join(' | ')}` : '')).trimEnd();
  console.log(text);
  const status = r.status === 0 ? (flips ? 'PASS' : 'REPORT') : r.status === 2 ? 'UNMEASURED' : 'FAIL';
  if (status === 'FAIL' && flips) flipFail = true;
  if (status === 'UNMEASURED') unmeasured = true;
  rows.push([id, status]);
}
console.log('\n=== POLY-76 checks ===');
for (const [id, s] of rows) console.log(`${s.padEnd(10)} (${id})`);
console.log('(d) deferred to POLY-121; not run');
if (flipFail) console.log('FLIP CONDITION FAILED: a failed (a), (b), (b\'), (c) or (e) flips the tool; ARCH 6.2.');
fs.rmSync(path.join(here, '.state'), { recursive: true, force: true });
process.exit(flipFail || unmeasured ? 1 : 0);
