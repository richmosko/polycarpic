// POLY-96 `app` aggregate (ruling §1). env NEEDS = toJSON(needs). Exit 0 = green. Anything unexpected is red.
// Every job whose job-level `if:` names the filter output; tests/ci ties this to ci.yml.
export const REQUIRED = { node: ['lint', 'unit', 'image'], layers: ['lint'], ci: ['lint'], image: ['lint', 'unit', 'image'], db: ['db'], e2e: ['unit'] };
import { ALL_KEYS, AREA_KEYS } from './changes.mjs';
const OK = new Set(['success', 'skipped']);

export function evaluate(raw) {
  let needs;
  try { needs = JSON.parse(raw ?? ''); } catch { return ['NEEDS is not JSON']; }
  if (!needs || typeof needs !== 'object') return ['NEEDS is not an object'];
  const bad = [];
  for (const j of ['changes', 'guard', 'lint', 'unit', 'db', 'image']) {
    const r = needs[j]?.result;
    if (r === undefined) bad.push(`${j}: missing`);
    else if (j === 'changes' || j === 'guard') { if (r !== 'success') bad.push(`${j}: ${r}`); }
    else if (!OK.has(r)) bad.push(`${j}: ${r}`);
  }
  const outs = needs.changes?.outputs ?? {};
  // C20: a missing or malformed output is red, never read as false.
  for (const k of ALL_KEYS) if (outs[k] !== 'true' && outs[k] !== 'false') bad.push(`changes output ${k} is ${JSON.stringify(outs[k])}, not true/false`);
  if (AREA_KEYS.every((k) => outs[k] === 'true' || outs[k] === 'false') && (outs.db === 'true') !== AREA_KEYS.some((k) => outs[k] === 'true')) bad.push('changes output db is not the OR of the area keys');
  for (const [out, jobs] of Object.entries(REQUIRED)) {
    if (outs[out] !== 'true') continue;
    for (const job of jobs) if (needs[job]?.result !== 'success') bad.push(`output ${out}=true but ${job} is ${needs[job]?.result}`);
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bad = evaluate(process.env.NEEDS);
  if (bad.length) { console.error(`app: red\n  ${bad.join('\n  ')}`); process.exit(1); }
  console.log('app: green');
}
