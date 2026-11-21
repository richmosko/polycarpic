// POLY-137 R1.1, R5.1 (ruling @ a5e9ce4f): layers.json carries the new package and the job module's confinement. Pure: reads layers.json and the
// worker's source. Titles end [red if: <mutation>].
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const L: any = JSON.parse(readFileSync(join(ROOT, 'layers.json'), 'utf8'));

describe('R1.1 @poly/mail is a layer-0 package with a ./fake subpath, allowed to auth, auth-app and worker only', () => {
  it('layers.json: mail { dir, name, layer 0, subpaths [./fake], allow [] }  [red if: the package is not declared]', () => {
    expect(L.packages.mail).toEqual({ dir: 'packages/mail', name: '@poly/mail', layer: 0, subpaths: ['./fake'], allow: [] });
  });
  it('auth, auth-app and worker allow mail; no other package does  [red if: web or another layer may import the mailer]', () => {
    for (const p of ['auth', 'auth-app', 'worker']) expect(L.packages[p].allow, p).toContain('mail');
    for (const [name, def] of Object.entries<any>(L.packages)) if (!['auth', 'auth-app', 'worker'].includes(name)) expect(def.allow.includes('mail') || def.allow.includes('mail/fake'), `${name} must not allow mail`).toBe(false);
  });
  it('no package allows mail/fake: the fake is for tests, reached by relative path or the test-only subpath  [red if: a service is allowed to import the fake]', () => {
    for (const [name, def] of Object.entries<any>(L.packages)) expect(def.allow, name).not.toContain('mail/fake');
  });
});

describe('R5.1 @poly/db/jobs is confined to the worker\'s two job modules', () => {
  it('db.subpaths gains ./jobs and worker.allow gains db/jobs  [red if: the subpath is not declared]', () => {
    expect(L.packages.db.subpaths).toContain('./jobs');
    expect(L.packages.worker.allow).toContain('db/jobs');
  });
  it('confined: packages/db/src/jobs.ts is importable only from apps/worker/src/jobs/purge.ts and mail.ts  [red if: any other file may run a worker definer]', () => {
    expect(L.confined['packages/db/src/jobs.ts']).toEqual(['apps/worker/src/jobs/purge.ts', 'apps/worker/src/jobs/mail.ts']);
  });
  it('reservedLiterals: each worker definer name lives in packages/db/src/jobs.ts alone; cancel_method_hold in packages/auth/src/anchor.ts alone  [red if: a definer name can appear in a second file]', () => {
    for (const n of ['purge_tx_identity', 'purge_sign_in_record', 'purge_mail_outbox', 'claim_mail', 'arm_hold_cancel', 'mail_sent', 'mail_failed']) expect(L.reservedLiterals[n], n).toEqual(['packages/db/src/jobs.ts']);
    expect(L.reservedLiterals.cancel_method_hold).toEqual(['packages/auth/src/anchor.ts']);
  });
});

describe('R1.6 / R5.1 the files exist where the layer map says', () => {
  it('packages/mail/src/index.ts and fake.ts, packages/db/src/jobs.ts, apps/worker/src/jobs/purge.ts and mail.ts exist  [red if: the map names files that are not there]', () => {
    for (const f of ['packages/mail/src/index.ts', 'packages/mail/src/fake.ts', 'packages/db/src/jobs.ts', 'apps/worker/src/jobs/purge.ts', 'apps/worker/src/jobs/mail.ts']) expect(existsSync(join(ROOT, f)), f).toBe(true);
  });
});
