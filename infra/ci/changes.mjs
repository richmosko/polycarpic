// POLY-96 change filter (ruling §2). Changed paths on stdin -> `key=true|false` for every key (TABLE's and the db area keys).
// Input is NUL-separated. Empty input fails closed: an empty diff is a filter failure, never "nothing changed".
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// POLY-141 R3: the db battery is split into area sub-batteries. A path in DB_SHARED runs every area; a `db` path in no
// area also runs every area (fail closed). Each area's `paths` lists what its tests import or read beyond their own files;
// tests/ci/db-filter-imports.test.ts proves the closure of each area lies inside its paths or the shared set.
export const DB_SHARED = [
  /^packages\/db\//, /^apps\/migrate\//, /^packages\/config\//,
  /^tests\/db\/helpers\//, /^tests\/db\/global-setup\.ts$/, /^tests\/db\/vitest\.config\.ts$/, /^tests\/db\/docker\//,
  /^infra\/postgres\/Dockerfile$/, /^infra\/postgres-major$/, /^pnpm-lock\.yaml$/,
  // S8: the root manifests and config every package resolves through.
  /^package\.json$/, /^pnpm-workspace\.yaml$/, /^\.npmrc$/, /^tsconfig[^/]*\.json$/, /^apps\/web\/package\.json$/, /^apps\/web\/tsconfig\.json$/,
  // C25: the files the db job itself executes (its steps, the area selector, the timing report, the preflight).
  /^\.github\/workflows\/ci\.yml$/, /^infra\/ci\/(changes\.mjs|job-report\.mjs|budgets\.json)$/,
  /^tests\/ci\/(db-filter-imports\.test\.ts|db-areas\.test\.ts|db-harness\.test\.ts|helpers\.ts|vitest\.config\.ts)$/,
];
const T = (names) => names.map((n) => `tests/db/${n}.test.ts`);
export const DB_AREAS = {
  auth: {
    tests: T(['auth-client-ip', 'auth-fields', 'auth-route-policy', 'auth-routing-pool', 'auth-second-step', 'auth-session', 'auth-signup-wrap', 'auth-signup-invite', 'auth-new-user-step']),
    paths: [/^packages\/auth\//, /^packages\/tenancy\//],
  },
  tenancy: {
    tests: T(['tenancy', 'matrix', 'wrappers', 'battery', 'pgtap']),
    paths: [/^packages\/tenancy\//, /^tests\/db\/pgtap\//],
  },
  migrate: {
    tests: T(['checks', 'connection', 'migrate-run-helper', 'runner', 'template-clone']),
    paths: [],
  },
  ops: {
    tests: T(['ops-status', 'ops-hardening']),
    paths: [/^apps\/web\/src\/ops\//, /^apps\/web\/src\/main\.ts$/, /^apps\/web\/src\/startup\.ts$/, /^tests\/log\//],
  },
};
const areaMatches = (name, p) => DB_AREAS[name].tests.includes(p) || DB_AREAS[name].paths.some((re) => re.test(p));

export const TABLE = {
  node: [
    /^packages\//, /^apps\//, /^package\.json$/, /^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/, /^turbo\.json$/,
    /^tsconfig[^/]*\.json$/, /^eslint\.config\.js$/, /^\.npmrc$/, /^tests\/config\//, /^tests\/image\//, /^tests\/log\//,
    /^docs\/DESIGN\/tokens\.css$/,
  ],
  layers: [
    /^layers\.json$/, /^docs\/ARCH\/index\.html$/, /^scripts\/layers\//, /^tests\/layers\//, /^eslint\.config\.js$/,
    /^packages\/[^/]+\/package\.json$/, /^apps\/[^/]+\/package\.json$/,
  ],
  // POLY-102 R5: every path a job executes or imports, transitively, triggers that job.
  db: [
    /^tests\/db\//, /^packages\/tenancy\//, /^packages\/auth\//,
    /^apps\/web\/src\/ops\//, /^apps\/web\/src\/main\.ts$/, /^apps\/web\/src\/startup\.ts$/, /^tests\/log\//,
    ...DB_SHARED,
  ],
  image: [/^Dockerfile/, /^\.dockerignore$/, /^compose[^/]*\.yml$/, /^Caddyfile/, /^infra\/(?!ci\/)/, /^bin\//,
    /^infra\/ci\/(image|install-trivy)\.sh$/, /^tests\/infra\//, /^\.trivyignore$/, /^tests\/layers\/tsc\/package\.json$/,
  ],
  ci: [/^\.github\/workflows\//, /^infra\/ci\//, /^tests\/ci\//],
  // POLY-141 E1: what the web e2e server imports or reads that turbo cannot see (it follows workspace packages only):
  // the db harness helpers and image build, apps/migrate, and the Postgres pin. Runs only the `unit` job's e2e step.
  e2e: [/^tests\/db\/helpers\//, /^tests\/db\/docker\//, /^apps\/migrate\//, /^infra\/postgres\/Dockerfile$/, /^infra\/postgres-major$/],
};

// One key per db sub-battery. `db` is always the OR of these.
export const AREA_NAMES = Object.keys(DB_AREAS);
export const AREA_KEYS = AREA_NAMES.map((n) => `db_${n}`);
export const ALL_KEYS = [...Object.keys(TABLE), ...AREA_KEYS];

export function classify(paths) {
  const out = {};
  for (const [k, res] of Object.entries(TABLE)) out[k] = paths.some((p) => res.some((re) => re.test(p)));
  for (const n of AREA_NAMES) out[`db_${n}`] = false;
  for (const p of paths.filter((q) => TABLE.db.some((re) => re.test(q)))) {
    const hit = DB_SHARED.some((re) => re.test(p)) ? AREA_NAMES : AREA_NAMES.filter((n) => areaMatches(n, p));
    for (const n of hit.length ? hit : AREA_NAMES) out[`db_${n}`] = true; // a db path in no area runs every area
  }
  return out;
}

// `--db-select`: env DB_AUTH DB_TENANCY DB_MIGRATE DB_OPS, each exactly true|false. Prints `all`, or the selected test files.
// Exit 1 on a map that disagrees with the disk, on no area on, or on a bad value. The caller checks every line again (S7).
function dbSelect() {
  const fail = (m) => { console.error(`changes.mjs --db-select: ${m}`); process.exit(1); };
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const listed = AREA_NAMES.flatMap((n) => DB_AREAS[n].tests);
  const onDisk = readdirSync(join(root, 'tests/db')).filter((f) => f.endsWith('.test.ts')).map((f) => `tests/db/${f}`);
  for (const f of listed) {
    if (!/^tests\/db\/[a-z0-9-]+\.test\.ts$/.test(f)) fail(`${f} has an unexpected name`);
    if (!onDisk.includes(f)) fail(`${f} is in the area map but not on disk`);
    if (listed.filter((x) => x === f).length !== 1) fail(`${f} is in more than one area`);
  }
  for (const f of onDisk) if (!listed.includes(f)) fail(`${f} is in no area`);
  const on = [];
  for (const n of AREA_NAMES) {
    const v = process.env[`DB_${n.toUpperCase()}`];
    if (v !== 'true' && v !== 'false') fail(`DB_${n.toUpperCase()} is ${JSON.stringify(v)}, not exactly true or false`);
    if (v === 'true') on.push(n);
  }
  if (on.length === 0) fail('no area is on');
  if (on.length === AREA_NAMES.length) console.log('all');
  else for (const f of on.flatMap((n) => DB_AREAS[n].tests).sort()) console.log(f);
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (process.argv.includes('--db-select')) {
    dbSelect();
  } else if (process.argv.includes('--none')) {
    // A ledger-only push (anchor.mjs): no heavy suite reruns. Every key false.
    for (const k of ALL_KEYS) console.log(`${k}=false`);
  } else {
    // stdin is NUL-separated (`git diff --no-renames -z --name-only`): a name is never quoted or split.
    const raw = readFileSync(0, 'utf8');
    // C26: git's `-z` output always ends in NUL. Anything else (newline-separated paths) would be read as one path and fail open.
    if (raw.trim() !== '' && !raw.endsWith('\0')) {
      console.error('changes.mjs: stdin is not NUL-terminated (use `git diff --no-renames -z --name-only`); failing closed');
      process.exit(1);
    }
    const paths = raw.split('\0').filter((p) => p.trim() !== '');
    if (paths.length === 0) {
      console.error('changes.mjs: no changed paths on stdin; failing closed');
      process.exit(1);
    }
    const out = classify(paths);
    for (const k of ALL_KEYS) console.log(`${k}=${out[k]}`);
  }
}
