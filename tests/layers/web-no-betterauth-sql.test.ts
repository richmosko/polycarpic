// POLY-153 R6 / R7.3 (C3), seceng §2.1: web sends no SQL that names a BetterAuth table or app.session_handle, and the interim session
// machinery is gone from web. The scan reads what web can run: apps/web/src, @poly/auth/web (packages/auth/src/web*), and the
// tenancy functions web calls (packages/tenancy/src/index.ts). The scanner is shown to bite on planted text. Titles end [red if: ...].
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).flatMap((f) => { const p = join(d, f); return f === 'node_modules' || f.startsWith('.') ? [] : statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const isSource = (p: string) => /\.(ts|svelte|js)$/.test(p) && !/\.(test|spec)\.(ts|js)$/.test(p) && !/\/tests?\//.test(p);
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const TABLES = /(public\s*\.\s*"?(user|session|account|verification|two_factor|passkey)"?(?![\w]))|(app\s*\.\s*session_handle)|(\bFROM\s+"user"\b)/i;
export const sqlHits = (text: string): string[] => strip(text).split('\n').filter((l) => TABLES.test(l)).map((l) => l.trim());

const webFiles = () => [
  ...walk(join(root, 'apps/web/src')),
  ...readdirSync(join(root, 'packages/auth/src')).filter((f) => /^web(\.|$)/.test(f)).map((f) => join(root, 'packages/auth/src', f)).filter((p) => statSync(p).isFile()),
  ...walk(join(root, 'packages/auth/src/web')),
  join(root, 'packages/tenancy/src/index.ts'),
].filter((p) => existsSync(p) && isSource(p));

describe('the scanner itself', () => {
  it('flags each table name, quoted or not, and app.session_handle; passes the allowed definers and app.* calls [red if: the pattern misses a spelling]', () => {
    for (const bad of ['SELECT 1 FROM public.session', 'FROM public."user" u', 'public.account', 'public.verification', 'public.two_factor', 'public.passkey', 'SELECT * FROM app.session_handle', 'DELETE FROM public . session WHERE'])
      expect(sqlHits(bad), bad).toHaveLength(1);
    for (const ok of ['SELECT * FROM app.my_sessions()', 'SELECT app.revoke_my_session($1)', 'SELECT app.recent_auth_ok()', 'SELECT app.second_step_required()', 'FROM public.entity', '// public.session in a comment'])
      expect(sqlHits(ok), ok).toEqual([]);
  });
});

describe('what web can run', () => {
  it('there are files to scan: apps/web/src, @poly/auth/web and the tenancy index [red if: the scan set is empty and the test proves nothing]', () => {
    const f = webFiles();
    expect(f.some((p) => p.includes('apps/web/src'))).toBe(true);
    expect(f.some((p) => p.endsWith('packages/auth/src/web.ts'))).toBe(true);
    expect(f.some((p) => p.endsWith('packages/auth/src/web/sessions.ts'))).toBe(true);
    expect(f.some((p) => p.endsWith('packages/tenancy/src/index.ts'))).toBe(true);
  });
  it('no file names public.session, .account, .verification, .two_factor, .passkey, public."user" or app.session_handle [red if: sessions.ts or provisionPerson still query BetterAuth\'s tables]', () => {
    const hits = webFiles().flatMap((p) => sqlHits(readFileSync(p, 'utf8')).map((h) => `${p.replace(root + '/', '')}: ${h}`));
    expect(hits).toEqual([]);
  });
  it('packages/auth/src/web/sessions.ts is calls to the three definers only [red if: it keeps its own SQL on public.session]', () => {
    const src = strip(readFileSync(join(root, 'packages/auth/src/web/sessions.ts'), 'utf8'));
    for (const fn of ['app.my_sessions', 'app.revoke_my_session']) expect(src, fn).toContain(fn);
    expect(src).not.toMatch(/\bDELETE\s+FROM\b|\bUPDATE\s+public\b|\bSELECT\b[^;]*\bFROM\s+public\./i);
  });
  it('the interim machinery is gone from web: loadSession, loadSessionFromService, completeSession, setAuthInternalOrigin, SESSION_COOKIE, withTenant, sessionUserId, locals.identity [red if: any survives]', () => {
    const names = /\b(loadSession|loadSessionFromService|completeSession|setAuthInternalOrigin|SESSION_COOKIE|withTenant|sessionUserId|SessionUserId)\b|locals\.identity/;
    const hits = webFiles().flatMap((p) => strip(readFileSync(p, 'utf8')).split('\n').filter((l) => names.test(l)).map((l) => `${p.replace(root + '/', '')}: ${l.trim()}`));
    expect(hits).toEqual([]);
  });
  it('app.d.ts no longer declares locals.identity and declares locals.handle [red if: the Locals type keeps the old identity]', () => {
    const d = readFileSync(join(root, 'apps/web/src/app.d.ts'), 'utf8');
    expect(d).not.toMatch(/\bidentity\b/);
    expect(d).toMatch(/\bhandle\b/);
  });
});
