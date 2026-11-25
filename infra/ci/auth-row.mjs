// POLY-101 B2: the auth row's tests ran. `node infra/ci/auth-row.mjs lint|db` reads vitest's JSON report (env VITEST_JSON);
// `db` also reads DB_AUTH. Exit 0 = green, 1 = red. A skip, a todo, a rename or an emptied file leaves vitest at exit 0.
// Node built-ins only. A mistake guard: a PR that edits this file with the tests it checks is out of its reach (ruling condition 11).
import { readFileSync, realpathSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LIVE = 'every HTTP route of the instance is in AUTH_ROUTES and every entry is live, naming the path  [red if: a plugin or version adds a route unclassified, or the map keeps a dead entry]';

const CONTROL = 'route policy control: a synthetic plugin (POLY-101)';
const CONTROL_TITLES = [
  'the predicate names both synthetic routes against AUTH_ROUTES, and nothing once both are listed  [red if: the predicate filters on isAction, or names nothing]',
  'both synthetic routes answer 404 while unlisted, and each of the two refusals holds on its own  [red if: the hook lets an unlisted path through, or the handler passes a path no template matches]',
];

// `floor` is the least number of passed tests in the file. `required` names tests that must be among them, by exact title and
// outermost describe, each exactly once.
export const ROWS = {
  lint: [{ file: 'packages/auth/src/boundaries.test.ts', floor: 9, required: [] }],
  db: [
    {
      file: 'tests/db/auth-route-policy.test.ts',
      floor: 43,
      required: [
        ...['real-domain', 'private-ca'].map((mode) => ({ describe: `route policy, ${mode} mode`, title: LIVE })),
        ...CONTROL_TITLES.map((title) => ({ describe: CONTROL, title })),
      ],
    },
    { file: 'tests/db/auth-routing-pool.test.ts', floor: 40, required: [] },
  ],
};

// vitest reports a failing `it.fails` as `passed`, so the sources are read too: any `.fails` property (a chain may hold a call,
// as in `it.runIf(x).fails`) and the `fails:` option.
const FAILS = [/\.\s*fails\b/, /\bfails['"]?\s*:/];

export function check(mode, { root, reportPath }) {
  let report;
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch (e) { return { bad: [`VITEST_JSON: no readable JSON report (${e.message})`], ok: [] }; }
  if (!Array.isArray(report?.testResults)) return { bad: ['VITEST_JSON: the report has no testResults array'], ok: [] };

  const bad = [];
  const ok = [];
  for (const { file } of Object.values(ROWS).flat()) {
    let source;
    try { source = readFileSync(`${root}${file}`, 'utf8'); } catch { bad.push(`${file}: the source file cannot be read`); continue; }
    if (FAILS.some((re) => re.test(source))) bad.push(`${file}: uses fails (it.fails or a fails: option), which vitest reports as passed`);
  }
  for (const { file, floor, required } of ROWS[mode]) {
    // The exact repo-relative path, never a suffix: a copy of the file elsewhere does not stand in for it.
    const found = report.testResults.filter((r) => typeof r?.name === 'string' && relative(root, r.name).split(sep).join('/') === file);
    if (found.length !== 1) { bad.push(`${file}: in the report ${found.length} times, not once`); continue; }
    const tests = Array.isArray(found[0].assertionResults) ? found[0].assertionResults : [];
    if (found[0].status !== 'passed') bad.push(`${file}: the file's status is ${found[0].status}`);
    for (const t of tests) if (t.status !== 'passed') bad.push(`${file}: ${t.status}: ${t.title}`);
    const passed = tests.filter((t) => t.status === 'passed');
    if (passed.length < floor) bad.push(`${file}: ${passed.length} passed, below the floor of ${floor}`);
    for (const need of required) {
      const n = passed.filter((t) => t.title === need.title && t.ancestorTitles?.[0] === need.describe).length;
      if (n !== (need.times ?? 1)) bad.push(`${file}: required test passed ${n} times, not ${need.times ?? 1}: ${need.describe} > ${need.title}`);
    }
    ok.push(`auth-row: ${file} ${passed.length} passed (floor ${floor})`);
  }
  return { bad, ok };
}

function main(args) {
  const red = (lines) => { console.error(`auth-row: red\n  ${lines.join('\n  ')}`); process.exit(1); };
  const [mode] = args;
  if (args.length !== 1 || !Object.hasOwn(ROWS, mode)) red(['usage: auth-row.mjs lint|db']);
  if (mode === 'db') {
    const v = process.env.DB_AUTH;
    if (v === 'false') { console.log('auth-row: db_auth false, nothing to check'); return; }
    if (v !== 'true') red([`DB_AUTH is ${JSON.stringify(v)}, not exactly true or false`]);
  }
  const { bad, ok } = check(mode, { root: fileURLToPath(new URL('../../', import.meta.url)), reportPath: process.env.VITEST_JSON ?? '' });
  if (bad.length) red(bad);
  console.log(ok.join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main(process.argv.slice(2));
