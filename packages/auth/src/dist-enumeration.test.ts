// POLY-137 R6 (ruling @ a5e9ce4f): S9, the dist-enumeration test. It scans every *.mjs under better-auth's and @better-auth/passkey's dist for
// createUser / createOAuthUser / createSession / setSessionCookie, requires a reviewed fixture row (dist-sites.json) for each site outside the
// plugins we do not load, checks each row against its class's rule, and holds the lockfile and the pins to one version of five packages.
// The scan, the classification and the lockfile reader are pure functions in this file; section A runs each failing condition on synthetic
// input (R6.5), section B runs them on the real tree. No database. Red today: dist-sites.json does not exist, and SIGN_IN_TX is not exported.
// ASSUMED fixture shape (the builder reconciles in `loadFixture` below, one place): an array of
//   { pkg: 'better-auth'|'@better-auth/passkey', file, line, writer, class, routes?: string[], option?: string, disabledBy?: 'falsy'|'true', why?: string }
// where `option` is a dotted path into authOptions(sample), and a segment `plugins[<id>]` selects a plugin by id.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const WRITERS = ['createUser', 'createOAuthUser', 'createSession', 'setSessionCookie'] as const;
type Writer = (typeof WRITERS)[number];
type Site = { pkg: string; file: string; line: number; writer: string };
type Row = Site & { class: string; routes?: string[]; option?: string; disabledBy?: 'falsy' | 'true'; why?: string };
const SITE_RE = new RegExp(`\\b(${WRITERS.join('|')})\\(`, 'g');
const key = (s: Site) => `${s.pkg}|${s.file}|${s.line}|${s.writer}`;

// ---- the pure functions -------------------------------------------------------------------------------------------------------------------
/** Every site in `files` ({relative path -> text}); `pkg` names the tree. */
function scanFiles(pkg: string, files: Record<string, string>): (Site & { text: string })[] {
  const out: (Site & { text: string })[] = [];
  for (const [file, text] of Object.entries(files)) {
    if (!file.endsWith('.mjs')) continue;
    text.split('\n').forEach((l, i) => { for (const m of l.matchAll(SITE_RE)) out.push({ pkg, file, line: i + 1, writer: m[1]!, text: l }); });
  }
  return out;
}
const unloaded = (s: Site) => { const m = /^plugins\/([^/]+)\//.exec(s.file); return !!m && s.pkg === 'better-auth' && m[1] !== 'two-factor' && m[1] !== 'magic-link'; };
type Ctx = {
  routes: Record<string, { class: string }>; userInserting: ReadonlySet<string>; signInTx: ReadonlySet<string>;
  option: (path: string) => unknown; lineText: (s: Site) => string;
};
/** The rule of R6.3 for one row; returns the fault or null. */
function checkRow(r: Row, c: Ctx): string | null {
  const names = r.routes ?? [];
  for (const n of names) if (!(n in c.routes)) return `route ${n} is not in AUTH_ROUTES`;
  const userWriter = r.writer === 'createUser' || r.writer === 'createOAuthUser';
  switch (r.class) {
    case 'definition': return new RegExp(`\\bfunction\\s+${r.writer}\\(`).test(c.lineText(r)) ? null : 'the line does not define the function';
    case 'blocked': return names.length && names.every((n) => c.routes[n]!.class === 'blocked') ? null : 'a route is not blocked';
    case 'user-inserting': return names.length && names.every((n) => c.userInserting.has(n)) ? null : 'a route is not in USER_INSERTING';
    case 'sign-in-tx':
      if (userWriter) return `class sign-in-tx is not allowed for ${r.writer}`;
      return names.length && names.every((n) => c.signInTx.has(n) || c.userInserting.has(n)) ? null : 'a route is in neither SIGN_IN_TX nor USER_INSERTING';
    case 'with-session':
      if (userWriter) return `class with-session is not allowed for ${r.writer}`;
      if (!names.length || names.some((n) => c.routes[n]!.class === 'blocked')) return 'a route is blocked or none is named';
      return typeof r.why === 'string' && r.why.length > 10 ? null : 'a with-session row carries no why';
    case 'option-off': {
      if (!r.option || (r.disabledBy !== 'falsy' && r.disabledBy !== 'true')) return 'option-off needs option and disabledBy';
      const v = c.option(r.option);
      return (r.disabledBy === 'true' ? v === true : !v) ? null : `option ${r.option} is ${JSON.stringify(v)}, which does not disable the site`;
    }
    default: return `unknown class ${r.class}`;
  }
}
/** The faults of a whole fixture against the scanned sites. */
function faults(sites: (Site & { text: string })[], rows: Row[], c: Ctx): string[] {
  const out: string[] = [];
  const need = sites.filter((s) => !unloaded(s));
  const have = new Set(rows.map(key));
  const want = new Set(need.map(key));
  for (const s of need) if (!have.has(key(s))) out.push(`unclassified site ${key(s)}`);
  for (const r of rows) if (!want.has(key(r))) out.push(`stale row ${key(r)}`);
  const text = new Map(need.map((s) => [key(s), s.text]));
  for (const r of rows) { const f = checkRow(r, { ...c, lineText: (s) => text.get(key(s)) ?? '' }); if (f) out.push(`${key(r)}: ${f}`); }
  return out;
}
/** Versions per package under the lockfile's `packages:` section. */
function lockVersions(lock: string, names: string[]): Record<string, string[]> {
  // The lockfile is two YAML documents (the package manager's own, then the project's), each with its own `packages:`; every one counts.
  const out: Record<string, string[]> = Object.fromEntries(names.map((n) => [n, []]));
  let top = '';
  for (const l of lock.split('\n')) {
    if (/^\S/.test(l)) { top = l.replace(/:.*$/, ''); continue; }
    const m = top === 'packages' ? /^ {2}'?(@?[^@']+)@([^':]+)'?:/.exec(l) : null;
    if (m && m[1]! in out) out[m[1]!]!.push(m[2]!);
  }
  return out;
}
const FIVE = ['better-auth', '@better-auth/passkey', '@better-auth/core', '@simplewebauthn/server', '@better-auth/utils'];
const multi = (v: Record<string, string[]>) => Object.entries(v).filter(([, x]) => x.length > 1).map(([n]) => n);

// ---- A. synthetic input: each failing condition of R6.4 is shown to fail ------------------------------------------------------------------------
const ctx0: Ctx = {
  routes: { '/sign-in/email': { class: 'open' }, '/delete-user': { class: 'blocked' }, '/sign-up/email': { class: 'open' }, '/two-factor/verify-totp': { class: 'open' } },
  userInserting: new Set(['/sign-up/email']), signInTx: new Set(['/sign-in/email', '/two-factor/verify-totp']),
  option: (p) => ({ 'plugins[magic-link].options.disableSignUp': true, 'a.b': false }[p]), lineText: () => '',
};
const synth = scanFiles('better-auth', {
  'cookies/index.mjs': 'x\nasync function setSessionCookie(ctx) {}\n',
  'api/routes/sign-in.mjs': 'a\nb\nconst s = await i.createSession(user.id);\nawait setSessionCookie(ctx, s);\n',
  'api/routes/sign-up.mjs': 'const u = await i.createUser({});\n',
  'plugins/anonymous/index.mjs': 'await i.createUser({});\nawait setSessionCookie(c);\n',
  'plugins/magic-link/index.mjs': 'newUser = await i.createUser({});\n',
});
const goodRows: Row[] = [
  { pkg: 'better-auth', file: 'cookies/index.mjs', line: 2, writer: 'setSessionCookie', class: 'definition' },
  { pkg: 'better-auth', file: 'api/routes/sign-in.mjs', line: 3, writer: 'createSession', class: 'sign-in-tx', routes: ['/sign-in/email'] },
  { pkg: 'better-auth', file: 'api/routes/sign-in.mjs', line: 4, writer: 'setSessionCookie', class: 'sign-in-tx', routes: ['/sign-in/email'] },
  { pkg: 'better-auth', file: 'api/routes/sign-up.mjs', line: 1, writer: 'createUser', class: 'user-inserting', routes: ['/sign-up/email'] },
  { pkg: 'better-auth', file: 'plugins/magic-link/index.mjs', line: 1, writer: 'createUser', class: 'option-off', option: 'plugins[magic-link].options.disableSignUp', disabledBy: 'true' },
];
const run = (rows: Row[], c: Ctx = ctx0) => faults(synth, rows, { ...c, lineText: () => '' });

describe('A. S9 on synthetic input (R6.5): each failing condition fails, and the good fixture passes', () => {
  it('the scan finds every writer call, skips none, and `unloaded` plugins need no row  [red if: the regex or the unloaded rule drifts]', () => {
    expect(synth.filter((s) => !unloaded(s)).map(key).sort()).toEqual(goodRows.map(key).sort());
    expect(synth.filter(unloaded)).toHaveLength(2);
  });
  it('the good fixture has no fault', () => expect(run(goodRows)).toEqual([]));
  it('a dropped row fails (an unclassified site)  [red if: a new writer path can appear unreviewed]', () => {
    expect(run(goodRows.slice(1)).join('\n')).toMatch(/unclassified site better-auth\|cookies\/index\.mjs\|2\|setSessionCookie/);
  });
  it('a stale row fails (the pin moved a line)  [red if: line drift goes unnoticed on an upgrade]', () => {
    expect(run([...goodRows.slice(0, 4), { ...goodRows[4]!, line: 7 }]).join('\n')).toMatch(/stale row|unclassified/);
  });
  it('a misclassed row fails: createUser as sign-in-tx, a blocked row naming an open route, with-session without a why  [red if: a class rule is not enforced]', () => {
    const bad = (i: number, patch: Partial<Row>) => run(goodRows.map((r, j) => (j === i ? { ...r, ...patch } : r))).join('\n');
    expect(bad(3, { class: 'sign-in-tx', routes: ['/sign-in/email'] })).toMatch(/sign-in-tx is not allowed for createUser/);
    expect(bad(1, { class: 'blocked', routes: ['/sign-in/email'] })).toMatch(/not blocked/);
    expect(bad(1, { class: 'with-session', routes: ['/sign-in/email'] })).toMatch(/carries no why/);
    expect(bad(0, { class: 'definition', writer: 'setSessionCookie', line: 1 })).toMatch(/stale row|unclassified/);
    expect(bad(1, { routes: ['/not-a-route'] })).toMatch(/not in AUTH_ROUTES/);
    expect(bad(3, { routes: ['/sign-in/email'] })).toMatch(/not in USER_INSERTING/);
  });
  it('an option-off row fails when the option does not disable the site  [red if: disableSignUp can be false and the row still passes]', () => {
    const flipped: Ctx = { ...ctx0, option: () => false };
    expect(run(goodRows, flipped).join('\n')).toMatch(/does not disable the site/);
  });
  it('a lockfile with @simplewebauthn/server@13.3.3 and @13.4.0 fails; a single version passes  [red if: two copies of a pinned package can install]', () => {
    const lock = (v: string[]) => `lockfileVersion: '9.0'\n\npackages:\n\n${v.map((x) => `  '@simplewebauthn/server@${x}':\n    resolution: {integrity: x}\n`).join('\n')}\nsnapshots:\n\n  '@simplewebauthn/server@13.3.3': {}\n`;
    expect(multi(lockVersions(lock(['13.3.3', '13.4.0']), FIVE))).toEqual(['@simplewebauthn/server']);
    expect(multi(lockVersions(lock(['13.3.3']), FIVE))).toEqual([]);
  });
  it('an extra plugin id is a fault; the exact five pass  [red if: an unreviewed plugin can be installed]', () => {
    const exact = (ids: string[]) => JSON.stringify([...ids].sort()) === JSON.stringify(['cookie-lifetime', 'magic-link', 'passkey', 'second-step-anchor', 'two-factor']);
    expect(exact(['cookie-lifetime', 'magic-link', 'passkey', 'second-step-anchor', 'two-factor'])).toBe(true);
    expect(exact(['cookie-lifetime', 'magic-link', 'passkey', 'second-step-anchor', 'two-factor', 'anonymous'])).toBe(false);
  });
});

// ---- B. the real tree ---------------------------------------------------------------------------------------------------------------------------
const distOf = (pkg: string) => join(realpathSync(join(HERE, '..', 'node_modules', ...pkg.split('/'))), 'dist');
function readTree(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) readTree(p, base, out); else if (n.endsWith('.mjs')) out[relative(base, p)] = readFileSync(p, 'utf8'); }
  return out;
}
const realSites = () => [...scanFiles('better-auth', readTree(distOf('better-auth'))), ...scanFiles('@better-auth/passkey', readTree(distOf('@better-auth/passkey')))];
const loadFixture = (): Row[] => JSON.parse(readFileSync(join(HERE, 'dist-sites.json'), 'utf8')) as Row[];
const sample = { secret: 'x'.repeat(48), baseURL: 'https://app.qa.test/', tlsMode: 'real-domain' as const, requireClientIp: true, mailer: { send: async () => {} } };
const optionAt = (o: any, path: string) => path.split('.').reduce((v: any, seg) => {
  const m = /^(\w+)\[([^\]]+)\]$/.exec(seg);
  return m ? (v?.[m[1]!] ?? []).find((p: any) => p.id === m[2]) : v?.[seg];
}, o);

describe('B. S9 on the real tree', () => {
  it('the fixture packages/auth/src/dist-sites.json exists  [red if: the fixture is missing, so any upgrade merges unreviewed]', () => {
    expect(existsSync(join(HERE, 'dist-sites.json'))).toBe(true);
  });
  it('the scan finds the sites the ruling measured (better-auth: 11 createUser, 27 createSession, 42 setSessionCookie; passkey: 2 and 2)  [red if: the scan misses a writer]', () => {
    const sites = realSites();
    const n = (pkg: string, w: Writer, only: 'all' | 'unloaded') => sites.filter((s) => s.pkg === pkg && s.writer === w && (only === 'all' || unloaded(s))).length;
    expect([n('better-auth', 'createUser', 'all'), n('better-auth', 'createOAuthUser', 'all'), n('better-auth', 'createSession', 'all'), n('better-auth', 'setSessionCookie', 'all')]).toEqual([11, 0, 27, 42]);
    expect([n('better-auth', 'createUser', 'unloaded'), n('better-auth', 'createSession', 'unloaded'), n('better-auth', 'setSessionCookie', 'unloaded')], 'of which in plugins we do not load').toEqual([8, 15, 21]);
    expect([n('@better-auth/passkey', 'createSession', 'all'), n('@better-auth/passkey', 'setSessionCookie', 'all')]).toEqual([2, 2]);
  });
  it('every scanned site outside the unloaded plugins has a row, no row is stale, and every row obeys its class (R6.4)  [red if: a site is unreviewed or a row is wrong]', async () => {
    const H: any = await import('./handler.ts');
    const P: any = await import('./route-policy.ts');
    const { authOptions } = await import('./options.ts');
    expect(H.SIGN_IN_TX, 'handler.ts exports SIGN_IN_TX (R6.3)').toBeInstanceOf(Set);
    const o: any = authOptions(sample as any);
    const c: Ctx = { routes: P.AUTH_ROUTES, userInserting: P.USER_INSERTING, signInTx: H.SIGN_IN_TX, option: (p) => optionAt(o, p), lineText: () => '' };
    expect(faults(realSites(), loadFixture(), c)).toEqual([]);
  });
  it('the magic-link createUser site (plugins/magic-link/index.mjs) is option-off by disableSignUp: true  [red if: that site has any other class]', () => {
    const r = loadFixture().filter((x) => x.pkg === 'better-auth' && x.file === 'plugins/magic-link/index.mjs' && x.writer === 'createUser');
    expect(r).toHaveLength(1);
    expect([r[0]!.class, r[0]!.disabledBy]).toEqual(['option-off', 'true']);
  });
  it('the plugin ids of authOptions(sample) are exactly two-factor, magic-link, second-step-anchor, passkey and cookie-lifetime  [red if: an unreviewed plugin is installed]', async () => {
    const { authOptions } = await import('./options.ts');
    const ids = ((authOptions(sample as any) as any).plugins ?? []).map((p: any) => p.id).sort();
    expect(ids).toEqual(['cookie-lifetime', 'magic-link', 'passkey', 'second-step-anchor', 'two-factor']);
  });
  it('the lockfile holds exactly one version of better-auth, @better-auth/passkey, @better-auth/core, @simplewebauthn/server and @better-auth/utils  [red if: a bump leaves a second copy]', () => {
    const v = lockVersions(readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8'), FIVE);
    for (const n of FIVE) expect(v[n], n).toHaveLength(1);
    expect(multi(v)).toEqual([]);
  });
  it('the four packages packages/auth pins equal the lockfile, and @better-auth/core equals better-auth  [red if: a pin moves alone]', () => {
    const lock = lockVersions(readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8'), FIVE);
    const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
    const pins = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
    const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const all = { ...rootPkg.devDependencies, ...pins } as Record<string, string>;
    for (const n of ['better-auth', '@better-auth/passkey', '@simplewebauthn/server', '@better-auth/utils']) expect(all[n], `${n} is pinned`).toBe(lock[n]![0]);
    expect(lock['@better-auth/core']![0]).toBe(lock['better-auth']![0]);
  });
});
