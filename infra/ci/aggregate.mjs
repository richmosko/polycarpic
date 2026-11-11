// POLY-96 `app` aggregate (ruling §1). env NEEDS = toJSON(needs). Exit 0 = green. Anything unexpected is red.
const KEYED = { node: 'unit', layers: 'lint', ci: 'lint', image: 'image', db: 'db' };
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
  for (const [out, job] of Object.entries(KEYED)) {
    if (outs[out] === 'true' && needs[job]?.result !== 'success') bad.push(`output ${out}=true but ${job} is ${needs[job]?.result}`);
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bad = evaluate(process.env.NEEDS);
  if (bad.length) { console.error(`app: red\n  ${bad.join('\n  ')}`); process.exit(1); }
  console.log('app: green');
}
