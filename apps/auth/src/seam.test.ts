// POLY-150 R4: the delivery stand-in is a development-only argument, never a route, flag or env switch (S23, S24). Titles end [red if: ...].
// Red today: startAuthService takes no `deps`, so a refusal outside development cannot exist.
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (n: string) => readFileSync(join(here, n), 'utf8');
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

describe('R4 the seam', () => {
  it('startAuthService takes a second parameter, `deps` [red if: the seam is absent]', async () => {
    const m = (await import('./main.ts')) as { startAuthService: (...a: unknown[]) => unknown };
    expect(m.startAuthService.length, 'declared parameters (env, deps)').toBeGreaterThanOrEqual(1);
    expect(read('main.ts')).toMatch(/deps\s*(:|=|\.)/);
    expect(read('main.ts')).toMatch(/sendSecondStepCode:\s*deps\.sendSecondStepCode|deps\??\.sendSecondStepCode/);
  });
  it('cli() passes no deps [red if: the process wrapper can inject a sender]', () => {
    const cli = read('main.ts').split('async function cli()')[1] ?? '';
    expect(cli).toMatch(/startAuthService\(process\.env\)/);
    expect(read('main.ts')).toMatch(/deps/); // the seam exists, so the line above is not vacuous
  });
  it.each(['staging', 'production'])('deps under APP_ENV=%s is refused with ConfigError before anything starts [red if: a release image accepts a stand-in]', async (appEnv) => {
    const { ConfigError } = await import('@poly/config');
    const m = (await import('./main.ts')) as { startAuthService: (env: Record<string, string | undefined>, deps?: unknown) => Promise<unknown> };
    const d = mkdtempSync(join(tmpdir(), 'poly150-seam-'));
    writeFileSync(join(d, 'pw'), 'p\n');
    writeFileSync(join(d, 'sec'), 'seam-auth-secret-0123456789abcdef0123456789abcdef\n');
    // A complete, valid env for the environment, so the ONLY fault is the stand-in (an env with other faults would refuse for them).
    const env = { APP_ENV: appEnv, TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'https://app.qa.test', AUTH_PUBLIC_PORT: '41999', PLAID_ENV: appEnv === 'production' ? 'production' : 'sandbox',
      DATABASE_HOST: 'localhost', DATABASE_NAME: 'x', DATABASE_USER: 'poly_auth', DATABASE_SSLMODE: 'disable', DATABASE_PASSWORD_FILE: join(d, 'pw'), AUTH_SECRET_FILE: join(d, 'sec') };
    const x: any = await m.startAuthService(env, { sendSecondStepCode: async () => {} }).then(() => null, (e: unknown) => e);
    expect(x, 'the stand-in must be refused').toBeInstanceOf(ConfigError);
    expect(JSON.stringify(x.problems)).toMatch(/deps|sendSecondStepCode/);
  });
  it('apps/auth/src names no outbox, no file sink and no test entry; no env var carries a path for one [red if: the shipped service can write a code to disk]', () => {
    for (const f of walk(here).filter((p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p))) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/outbox|jsonl|auth-entry|appendFile|writeFile/i);
    }
    expect(read('main.ts')).toMatch(/deps/);
  });
  it('requireClientIp is true in every APP_ENV: no `appEnv !== \'development\'` exception remains [red if: development still skips the address check (R8)]', () => {
    const s = read('main.ts');
    expect(s).not.toMatch(/requireClientIp:\s*config\.appEnv\s*!==/);
    expect(s).toMatch(/requireClientIp:\s*true/);
  });
  it('send-code is not wired to a sender that throws: the service passes no sender unless deps gives one (R3) [red if: the 500-at-send-time oracle survives]', () => {
    const s = read('main.ts');
    expect(s).not.toMatch(/mailer not configured['"]\)[^]*sendSecondStepCode/);
    expect(s.match(/sendSecondStepCode\s*:\s*async\s*\(\)\s*=>\s*\{\s*throw/g) ?? []).toEqual([]);
  });
});
