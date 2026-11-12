// POLY-141 criterion 9 -- the one anchor rule (ruling R4). Used by the `changes` job and the `cairn` job.
// Node built-ins only. CLI: env EVENT_NAME REPO HEAD_REF PR_HEAD PR_BASE (+ GH_TOKEN for gh).
//   prints exactly one line `ledger_only=true|false` on stdout, the reason on stderr, and exits 0.
//   `--ledger-tests` prints LEDGER_TESTS, one per line.
// Fail closed: every lookup, ancestry, diff or mode failure gives false (today's BASE..HEAD behaviour).
import { spawnSync } from 'node:child_process';

// The tracker/ledger files no job reads except the ledger tests. The first leg equals ci.yml's EXCLUDE literal.
export const LEDGER = [/^process\/cairn\/(issues|milestones|majors|archive|reviews)\//, /^process\/STATE\.md$/, /^process\/DECISIONS\.md$/];
// The five rulings test_ruling_archive_records.py pins by blob sha; equals ci.yml's PINNED_RULINGS literal.
export const PINNED_RULINGS = /^process\/cairn\/reviews\/(POLY-6|POLY-10|POLY-26|POLY-48|POLY-51)\/ruling\.md$/;
// Cairn test files whose result depends on real ledger content (ruling C17, addendum 2).
export const LEDGER_TESTS = ['test_state_releases_bound.py', 'test_ruling_archive_records.py', 'test_check_budgets.py', 'test_dashboard_roster.py'];

const SHA = /^[0-9a-f]{40}$/;
const TIMEOUT_MS = 30000;

// Returns { ok, reason }. Every branch that cannot prove the skip returns ok=false.
async function explain(io) {
  if (io.eventName !== 'pull_request') return { ok: false, reason: `event ${io.eventName} is not pull_request` };
  if (!SHA.test(io.prHead ?? '') || !SHA.test(io.prBase ?? '')) return { ok: false, reason: 'PR head or base is not a 40-hex sha' };
  let body;
  try { body = await io.lookup(); } catch (e) { return { ok: false, reason: `lookup failed: ${e?.message ?? e}` }; }
  const run = body?.workflow_runs?.[0];
  if (!run) return { ok: false, reason: 'no successful run on this branch' };
  if (run.conclusion !== 'success') return { ok: false, reason: 'run did not conclude success' };
  if (run.event !== 'pull_request') return { ok: false, reason: 'run is not a pull_request run' };
  if (run.head_branch !== io.headRef) return { ok: false, reason: 'run is for another branch' };
  if (run.head_repository?.full_name !== io.repo) return { ok: false, reason: 'run is not from this repository' };
  const a = run.head_sha;
  if (typeof a !== 'string' || !SHA.test(a)) return { ok: false, reason: 'run head_sha is not a 40-hex sha' };
  try {
    if (!(await io.hasCommit(a))) return { ok: false, reason: 'anchor commit is not in the clone' };
    if (!(await io.isAncestor(a, io.prHead))) return { ok: false, reason: 'anchor is not an ancestor of the head' };
    if (!(await io.isAncestor(io.prBase, a))) return { ok: false, reason: 'PR base is not an ancestor of the anchor' };
  } catch (e) { return { ok: false, reason: `ancestry check failed: ${e?.message ?? e}` }; }
  let paths;
  let modes;
  try {
    paths = await io.diff(a, io.prHead);
    modes = await io.modes(a, io.prHead);
  } catch (e) { return { ok: false, reason: `diff failed: ${e?.message ?? e}` }; }
  if (!Array.isArray(paths) || paths.length === 0) return { ok: false, reason: 'empty anchor diff' };
  if (!Array.isArray(modes)) return { ok: false, reason: 'no modes' };
  if (modes.some((m) => m === '120000' || m === '160000')) return { ok: false, reason: 'symlink or gitlink in the anchor diff' };
  for (const p of paths) {
    if (PINNED_RULINGS.test(p)) return { ok: false, reason: `pinned ruling changed: ${p}` };
    if (!LEDGER.some((re) => re.test(p))) return { ok: false, reason: `path outside the ledger: ${p}` };
  }
  return { ok: true, reason: `ledger-only since ${a}` };
}

export async function decide(io) {
  try { return (await explain(io)).ok; } catch { return false; }
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout, maxBuffer: 256 << 20 });
  if (r.error) throw r.error;
  return r;
}
function git(args) {
  const r = sh('git', args);
  if (r.status !== 0) throw new Error(`git ${args[0]} exited ${r.status}`);
  return r.stdout;
}
function needSha(s) {
  if (!SHA.test(s)) throw new Error('not a 40-hex sha');
  return s;
}

function realIo(env) {
  return {
    eventName: env.EVENT_NAME ?? '', repo: env.REPO ?? '', headRef: env.HEAD_REF ?? '', prHead: env.PR_HEAD ?? '', prBase: env.PR_BASE ?? '',
    lookup() {
      const url = `repos/${env.REPO}/actions/workflows/ci.yml/runs?event=pull_request&status=success&branch=${encodeURIComponent(env.HEAD_REF ?? '')}&per_page=1`;
      const r = sh('gh', ['api', url], { timeout: TIMEOUT_MS });
      if (r.status !== 0) throw new Error(`gh api exited ${r.status}`);
      return JSON.parse(r.stdout);
    },
    hasCommit(s) { return sh('git', ['cat-file', '-e', `${needSha(s)}^{commit}`]).status === 0; },
    isAncestor(a, b) { return sh('git', ['merge-base', '--is-ancestor', needSha(a), needSha(b)]).status === 0; },
    diff(a, b) {
      const out = git(['diff', '--no-renames', '-z', '--name-only', needSha(a), needSha(b)]);
      if (out !== '' && !out.endsWith('\0')) throw new Error('diff output is not NUL-terminated');
      return out.split('\0').filter((p) => p !== '');
    },
    modes(a, b) {
      const out = git(['diff', '--raw', '-z', '--no-renames', needSha(a), needSha(b)]);
      return out.split('\0').flatMap((f) => { const m = f.match(/^:(\d{6}) (\d{6}) /); return m ? [m[1], m[2]] : []; });
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--ledger-tests')) {
    for (const t of LEDGER_TESTS) console.log(t);
  } else {
    let res;
    try { res = await explain(realIo(process.env)); } catch (e) { res = { ok: false, reason: `internal: ${e?.message ?? e}` }; }
    console.error(`anchor: ${res.reason}`);
    console.log(`ledger_only=${res.ok}`);
  }
}
