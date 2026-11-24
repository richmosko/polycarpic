// POLY-162 ruling B9 (process/cairn/reviews/POLY-162/build-review.md): nothing of T-real's log is published until a sweep that runs on failure has passed. This file holds the sweep's contract.
//
// CONTRACT (the seam; devops builds `infra/ci/deploy-real-sweep.mjs` to it):
//   node infra/ci/deploy-real-sweep.mjs --secrets <json> --step-log <file> --harness-log <file> --deploy-log <file> --out <file>
//   <json>: {"<name>": "<value>"} as the harness writes it (random per run); it must carry `github_read_token` and at least 6 entries.
//   Inputs are the step's own output, the harness's log, and staging's deploy.log. An absent deploy.log is allowed (a run that failed before it);
//   an absent step-log or harness-log, or an input that exists and cannot be read, is a failure.
//   Clean: exit 0 and <out> is written: the three inputs, in that order, nothing removed.
//   A hit, no list, a short list, an unparsable list, a missing `github_read_token`, an unreadable input: exit 1, <out> is NOT written (an old one is removed), stderr names the secret NAMES (or the shape) and never a value or the line.
//   Looks for: every listed secret by any 16 consecutive characters of it, as it is, percent-encoded, base64 and hex; `PRIVATE KEY-----`; `github_pat_` or `gh[a-z]_` followed by 20 token characters;
//   a saved render (`"services":`), an environment dump (`^PATH=` and the like), env-file lines (`^TLS_MODE=` and the like).
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ROOT } from './helpers.ts';

const SWEEP = join(ROOT, 'infra', 'ci', 'deploy-real-sweep.mjs');
const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const NAMES = ['postgres/db_superuser_password', 'web/db_password_app', 'web/plaid_secret', 'auth/db_password_auth', 'auth/auth_secret', 'auth/resend_api_key',
  'worker/db_password_worker', 'worker/credential_keyring', 'worker/resend_api_key', 'migrate/db_password_migrator', 'operator/db_password_operator'];
const BASE = 'AbCdEfGhJkLmNpQrStUvWxYz0123456789+/QqWwEeRrTtYyUuIiOoPp';
// eleven distinct 44-character base64-alphabet values (no two share a 16-character window) and the token
const SECRETS: Record<string, string> = {
  ...Object.fromEntries(NAMES.map((n, i) => [n, Array.from({ length: 44 }, (_, k) => BASE[(k * (i + 3) + i * 7 + (k % 5) * i) % BASE.length]).join('') + '=' ])),
  github_read_token: 'github_pat_' + 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0UvWxYz',
};
const APP = 'web/db_password_app';
// A value whose standard base64 carries `+` or `/` in every 16-character window, so the url-safe form (which swaps them) cannot stand in for it: without this a sweep that drops the standard form passes.
SECRETS[APP] = '>>>abc???def>>>ghi???jkl>>>mno???pqr>>>stu???vwx';
const KEYRING = 'worker/credential_keyring';
type In = { step?: string | null; harness?: string | null; deploy?: string | null };
type Run = { code: number; err: string; out: string | null; dir: string };

function sweep(inputs: In = {}, secrets: unknown = SECRETS, extra: { raw?: string; unreadable?: 'step' | 'harness' | 'deploy' } = {}): Run {
  if (!existsSync(SWEEP)) throw new Error('infra/ci/deploy-real-sweep.mjs does not exist');
  const dir = mkdtempSync(join(tmpdir(), 'poly162-sweep-'));
  made.push(dir);
  const f = (n: string, v: string | null | undefined, d: string) => {
    const p = join(dir, n);
    if (v !== null) writeFileSync(p, v ?? d);
    return p;
  };
  const step = f('step.log', inputs.step, 'step output: 3 files, 16 tests passed\n');
  const harness = f('harness.log', inputs.harness, '## install_box: exit 0 in 0s\n');
  const deploy = f('deploy.log', inputs.deploy, '2026-11-24T22:24:09Z candidate sha256:' + '0'.repeat(64) + '\n');
  const secretsPath = join(dir, 'secrets.json');
  writeFileSync(secretsPath, extra.raw ?? JSON.stringify(secrets));
  const out = join(dir, 'kept.log');
  writeFileSync(out, 'STALE'); // an old output must not survive a refusal
  if (extra.unreadable) chmodSync({ step, harness, deploy }[extra.unreadable], 0o000);
  const r = spawnSync('node', [SWEEP, '--secrets', secretsPath, '--step-log', step, '--harness-log', harness, '--deploy-log', deploy, '--out', out], { encoding: 'utf8' });
  const kept = existsSync(out) ? readFileSync(out, 'utf8') : null;
  if (extra.unreadable) chmodSync({ step, harness, deploy }[extra.unreadable], 0o600);
  return { code: r.status ?? 127, err: r.stderr ?? '', out: kept, dir };
}
const refused = (r: Run) => { expect(r.code, r.err).toBe(1); expect(r.out, 'a refused sweep leaves no output (not even a stale one)').toBeNull(); };
const noValues = (r: Run, name?: string) => {
  for (const v of Object.values(SECRETS)) expect(r.err, 'stderr must never carry a secret value').not.toContain(v.slice(0, 16));
  if (name) expect(r.err, 'stderr names the secret').toContain(name);
};

describe('deploy-real sweep (B9): clean inputs publish', () => {
  it('clean: exit 0 and the output is the step log, the harness log and deploy.log, in that order  [red if: the output is not written, or reordered]', () => {
    const r = sweep();
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe('step output: 3 files, 16 tests passed\n' + '## install_box: exit 0 in 0s\n' + '2026-11-24T22:24:09Z candidate sha256:' + '0'.repeat(64) + '\n');
  });
  it('an absent deploy.log is allowed (the run failed before it)  [red if: it is a failure]', () => {
    const r = sweep({ deploy: null });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('step output');
  });
});

describe('deploy-real sweep (B9): a hit in any input is refused, by name, with no output', () => {
  const inputs: (keyof In)[] = ['step', 'harness', 'deploy'];
  const text = (planted: string) => `before\nsome line ${planted} after\n`;
  const forms: [string, (v: string) => string][] = [
    ['the whole value', (v) => v],
    ['a 16-character piece from the middle', (v) => v.slice(11, 27)],
    ['the percent-encoded value', (v) => encodeURIComponent(v)],
    ['the base64 of the value', (v) => Buffer.from(v).toString('base64')],
    ['the hex of the value', (v) => Buffer.from(v).toString('hex')],
  ];
  for (const where of inputs) {
    for (const [what, make] of forms) {
      it(`${what} in the ${where} input  [red if: that input or that encoding is not swept]`, () => {
        const r = sweep({ [where]: text(make(SECRETS[APP]!)) });
        refused(r);
        noValues(r, APP);
      });
    }
  }
  it('a 15-character piece is not a hit (the rule is 16)  [red if: the window is shorter]', () => {
    const r = sweep({ step: text(SECRETS[APP]!.slice(11, 26)) });
    expect(r.code, r.err).toBe(0);
  });
  it('the token is found like any secret  [red if: github_read_token is exempt]', () => {
    const r = sweep({ harness: text(SECRETS.github_read_token!) });
    refused(r);
    noValues(r, 'github_read_token');
  });
});

describe('deploy-real sweep (B9): shapes', () => {
  const shapes: [string, string][] = [
    ['a private key header', '-----BEGIN OPENSSH PRIVATE KEY-----\n'],
    ['a fine-grained token shape', 'x github_pat_' + 'A'.repeat(22) + ' y\n'],
    ['a classic token shape', 'x ghp_' + 'B'.repeat(24) + ' y\n'],
    ['an installation token shape', 'x ghs_' + 'C'.repeat(24) + ' y\n'],
    ['a saved render', '{"name":"polycarpic-staging","services": {"web": {}}}\n'],
    ['an environment dump', 'PATH=/usr/bin:/bin\nHOME=/root\n'],
    ['env-file lines', 'TLS_MODE=real-domain\nPUBLIC_ORIGIN=https://staging.example.com\n'],
  ];
  for (const [what, body] of shapes) {
    it(`${what} is refused  [red if: the shape is not looked for]`, () => {
      refused(sweep({ step: body }));
    });
  }
  it('ordinary log text with the words around them is clean (a positive case for every shape above)  [red if: a shape matches too much]', () => {
    const r = sweep({ step: 'the services started; PATH of the tool is not printed; github_pat is a name; ghx_short\n' });
    expect(r.code, r.err).toBe(0);
  });
});

describe('deploy-real sweep (B9): fail closed', () => {
  it('no secrets list file content  [red if: an empty look publishes]', () => { refused(sweep({}, undefined, { raw: '' })); });
  it('an unparsable list  [red if: it publishes]', () => { refused(sweep({}, undefined, { raw: '{not json' })); });
  it('a short list (fewer than 6 entries)  [red if: a short look publishes]', () => {
    refused(sweep({}, { github_read_token: SECRETS.github_read_token, a: SECRETS['auth/auth_secret'] }));
  });
  it('a list without github_read_token  [red if: the token is not required]', () => {
    const { github_read_token: _t, ...rest } = SECRETS;
    refused(sweep({}, { ...rest, extra: 'Qw1/Er2+Ty3Ui4Op5As6Df7Gh8Jk9Lz0Xc=' }));
  });
  it('a list whose values are not strings  [red if: it is trusted]', () => { refused(sweep({}, { ...SECRETS, [APP]: 5 })); });
  for (const which of ['step', 'harness', 'deploy'] as const) {
    it(`an unreadable ${which} input (exists, mode 000)  [red if: it is skipped]`, () => {
      if (process.getuid?.() === 0) return; // root reads anything; CI's step runs the sweep as the runner user
      refused(sweep({}, SECRETS, { unreadable: which }));
    });
  }
  it('an absent step log is a failure  [red if: it is skipped]', () => { refused(sweep({ step: null })); });
  it('an absent harness log is a failure  [red if: it is skipped]', () => { refused(sweep({ harness: null })); });
  it('the refusal names the secret and never the value, for a hit in a different secret too  [red if: a value or a line is printed]', () => {
    const r = sweep({ deploy: 'x ' + SECRETS[KEYRING] + ' y' });
    refused(r);
    noValues(r, KEYRING);
    expect(r.err, 'the line is not echoed').not.toContain('x ' + SECRETS[KEYRING]);
  });
});

describe('deploy-real sweep (B9, architect item 1): the list must carry every name the harness registers', () => {
  for (const name of [...NAMES, 'github_read_token']) {
    it(`a list without ${name} is refused  [red if: that name is not required]`, () => {
      const { [name]: _gone, ...rest } = SECRETS;
      refused(sweep({}, rest));
    });
  }
  it('the sweep\'s required names equal the ones the harness registers (read from both sources)  [red if: the two lists drift]', () => {
    const harness = readFileSync(join(ROOT, 'tests', 'infra', 'deploy-real', 'harness.ts'), 'utf8');
    const block = /const SECRETS: Record<string, \{ gid: number; files: string\[\] \}> = \{([\s\S]*?)\n\};/.exec(harness)?.[1] ?? '';
    const fromHarness = [...block.matchAll(/^\s*(\w+): \{ gid: \d+, files: \[([^\]]*)\] \}/gm)].flatMap((m) => [...m[2]!.matchAll(/'([^']+)'/g)].map((f) => `${m[1]}/${f[1]}`));
    expect(fromHarness.length, 'the harness list was read').toBeGreaterThan(5);
    const sweepSrc = readFileSync(SWEEP, 'utf8');
    const fromSweep = [...(/const REQUIRED_NAMES = \[([\s\S]*?)\];/.exec(sweepSrc)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    expect([...fromSweep].sort()).toEqual([...fromHarness, 'github_read_token'].sort());
    expect([...NAMES].sort(), 'this file\'s fixture carries the same names').toEqual([...fromHarness].sort());
  });
});
