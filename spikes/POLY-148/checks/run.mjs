#!/usr/bin/env node
// Entry point: node spikes/POLY-148/checks/run.mjs [handle service cookie second-factor pages]
// Each check prints one line per item (PASS, FAIL, REPORT or UNMEASURED) with its reasons; this prints the totals.
// Exit 1 if any line is FAIL or UNMEASURED. A measured FAIL against a finished harness is a valid spike result.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ALL = [['handle', 'check-handle.mjs'], ['service', 'check-service.mjs'], ['cookie', 'check-cookie-scope.mjs'], ['second-factor', 'check-second-factor.mjs'], ['pages', 'check-pages.mjs']];
const pick = process.argv.slice(2);
const tally = { PASS: 0, FAIL: 0, REPORT: 0, UNMEASURED: 0 };
let bad = false;
for (const [id, file] of ALL) {
  if (pick.length && !pick.includes(id)) continue;
  console.log(`\n=== ${id} (${file}) ===`);
  const r = spawnSync('node', [path.join(here, file)], { encoding: 'utf8', timeout: 900_000, env: process.env });
  process.stdout.write(r.stdout);
  if (r.stderr.trim()) console.log(`  stderr: ${r.stderr.trim().split('\n').slice(-4).join(' | ')}`);
  for (const m of r.stdout.matchAll(/^(PASS|FAIL|REPORT|UNMEASURED)\s/gm)) tally[m[1]] += 1;
  if (r.status !== 0) bad = true;
}
console.log(`\n=== POLY-148 checks: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ')} ===`);
process.exit(bad ? 1 : 0);
