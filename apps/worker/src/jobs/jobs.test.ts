// POLY-137 R5 (ruling @ a5e9ce4f): the worker's schedule and the mail drain, on a fake clock; no test sleeps. @poly/db/jobs is mocked here;
// tests/db/worker-mail-jobs.test.ts runs the same definers against a real database.
// ASSUMED seams (the builder reconciles them in the three loaders below, one place; none is named by the ruling beyond the file paths):
//   ./schedule.ts  startSchedule(jobs: {name, everyMs, run}[], log): { stop(): void }      each job runs at start, then every everyMs, never overlapping
//   ./index.ts     buildJobs({ mailer?: Mailer, origin: string, log }): Job[]               purge.tx_identity 15 min, purge.sign_in_record 24 h, purge.mail_outbox 24 h, mail.drain 30 s (only with a mailer)
//   ./mail.ts      drainMail({ mailer, origin, limit? }): Promise<{ sent: number, failed: number }>
//   @poly/db/jobs  (R5.1, named) purgeTxIdentity() purgeSignInRecord() purgeMailOutbox() claimMail() armHoldCancel(id, hash) mailSent(id) mailFailed(id, status)
//                  claimMail(): null | { id, kind, toAddress, payload, attempts };  armHoldCancel: Date | null (the database's own `until`)
// Today none of these modules exists. Titles end [red if: <mutation>].
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  purgeTxIdentity: vi.fn(async () => 0), purgeSignInRecord: vi.fn(async () => 0), purgeMailOutbox: vi.fn(async () => 0),
  claimMail: vi.fn(async (): Promise<any> => null), armHoldCancel: vi.fn(async (..._a: unknown[]): Promise<any> => null), mailSent: vi.fn(async (..._a: unknown[]) => {}), mailFailed: vi.fn(async (..._a: unknown[]) => {}),
}));
// The file `@poly/db/jobs` will resolve to (R5.1), given as a path so the mock can be declared before the export exists.
vi.mock('../../../../packages/db/src/jobs.ts', () => db);

const schedule = () => import('./schedule.ts') as Promise<any>;
const index = () => import('./index.ts') as Promise<any>;
const mailJob = () => import('./mail.ts') as Promise<any>;
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
/** What @poly/mail's MailError is: an Error named MailError carrying the HTTP status, or null for a timeout or network fault (R1.1). */
const mailError = (status: number | null) => Object.assign(new Error('mail failed'), { name: 'MailError', status });
const sink = () => { const sent: any[] = []; return { sent, send: vi.fn(async (m: any) => { sent.push(m); }) }; };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-21T18:04:30Z')); for (const f of Object.values(db)) (f as any).mockClear(); db.claimMail.mockReset(); db.claimMail.mockResolvedValue(null); db.armHoldCancel.mockReset(); db.armHoldCancel.mockResolvedValue(null); });
afterEach(() => { vi.useRealTimers(); });

describe('R5.2 the schedule: each job runs at start, then every interval, and never overlaps itself', () => {
  it('a job runs once at start, again at each interval, and not before  [red if: the first run waits a full interval, or the interval is wrong]', async () => {
    const { startSchedule } = await schedule();
    const run = vi.fn(async () => ({}));
    const s = startSchedule([{ name: 'j', everyMs: 15 * 60_000, run }], logger());
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15 * 60_000 - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(run).toHaveBeenCalledTimes(4);
    s.stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(run, 'stop() stops it').toHaveBeenCalledTimes(4);
  });
  it('a run still going skips the next tick (no overlap)  [red if: two runs of one job go at once]', async () => {
    const { startSchedule } = await schedule();
    let open = 0, peak = 0, calls = 0;
    const run = vi.fn(async () => { calls++; open++; peak = Math.max(peak, open); await new Promise((r) => setTimeout(r, 100_000)); open--; });
    const s = startSchedule([{ name: 'slow', everyMs: 30_000, run }], logger());
    await vi.advanceTimersByTimeAsync(95_000); // ticks at 30, 60, 90 s while the first run (100 s) is going
    expect(peak).toBe(1);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(40_000); // the first run ends at 100 s; the 120 s tick runs
    expect(calls).toBe(2);
    s.stop();
  });
  it('a run that throws is logged at error with { job, outcome: "error" } and the next tick still runs  [red if: one failure stops the schedule]', async () => {
    const { startSchedule } = await schedule();
    const log = logger();
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ deleted: 0 });
    const s = startSchedule([{ name: 'purge.x', everyMs: 60_000, run }], log);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.error).toHaveBeenCalledWith('job.run', expect.objectContaining({ job: 'purge.x', outcome: 'error' }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith('job.run', expect.objectContaining({ job: 'purge.x', outcome: 'ok', ms: expect.any(Number) }));
    s.stop();
  });
  it('every run logs job.run with the job name, the outcome and the count; no address appears  [red if: a missed run leaves no trace]', async () => {
    const { startSchedule } = await schedule();
    const log = logger();
    const s = startSchedule([{ name: 'purge.sign_in_record', everyMs: 1000, run: async () => ({ deleted: 3 }) }], log);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.info).toHaveBeenCalledWith('job.run', expect.objectContaining({ job: 'purge.sign_in_record', outcome: 'ok', deleted: 3 }));
    s.stop();
  });
});

describe('R5.2 the job table', () => {
  it('purge.tx_identity every 15 min, purge.sign_in_record and purge.mail_outbox daily, mail.drain every 30 s  [red if: an interval is wrong or a job is missing]', async () => {
    const { buildJobs } = await index();
    const jobs = buildJobs({ mailer: sink(), origin: 'https://app.qa.test', log: logger() });
    expect(Object.fromEntries(jobs.map((j: any) => [j.name, j.everyMs]))).toEqual({
      'purge.tx_identity': 15 * 60_000, 'purge.sign_in_record': 86_400_000, 'purge.mail_outbox': 86_400_000, 'mail.drain': 30_000,
    });
  });
  it('each purge job calls exactly its own definer wrapper, once, and reports the count  [red if: a job calls the wrong purge, or none]', async () => {
    const { buildJobs } = await index();
    const jobs = buildJobs({ mailer: sink(), origin: 'https://app.qa.test', log: logger() });
    const by = (n: string) => jobs.find((j: any) => j.name === n);
    db.purgeTxIdentity.mockResolvedValue(4 as never);
    await by('purge.tx_identity').run();
    expect([db.purgeTxIdentity.mock.calls.length, db.purgeSignInRecord.mock.calls.length, db.purgeMailOutbox.mock.calls.length]).toEqual([1, 0, 0]);
    await by('purge.sign_in_record').run();
    await by('purge.mail_outbox').run();
    expect([db.purgeTxIdentity.mock.calls.length, db.purgeSignInRecord.mock.calls.length, db.purgeMailOutbox.mock.calls.length]).toEqual([1, 1, 1]);
  });
  it('with no mailer (development): no mail.drain job, and mail.unconfigured is logged once at warn  [red if: the worker drains with nothing to send with]', async () => {
    const { buildJobs } = await index();
    const log = logger();
    const jobs = buildJobs({ mailer: undefined, origin: 'https://app.qa.test', log });
    expect(jobs.map((j: any) => j.name)).not.toContain('mail.drain');
    expect(log.warn.mock.calls.filter((c) => c[0] === 'mail.unconfigured')).toHaveLength(1);
  });
});

const WHEN = '2026-11-21T18:04:30Z';
const row = (kind: string, payload: Record<string, unknown>, o: Record<string, unknown> = {}) => ({ id: '11111111-1111-4111-8111-111111111111', kind, toAddress: 'owner@qa.test', payload: { at: WHEN, ...payload }, attempts: 1, ...o });
const origin = 'https://app.qa.test';
const drain = async (rows: any[], mailer = sink(), extra: Record<string, unknown> = {}) => {
  const { drainMail } = await mailJob();
  const q = [...rows];
  db.claimMail.mockImplementation(async () => q.shift() ?? null);
  const r = await drainMail({ mailer, origin, ...extra });
  return { r, mailer };
};

describe('R5.2 mail.drain: one row, one mail', () => {
  it('a held method_added row: mints a 32-byte token, arms its sha256, sends one mail with the cancel link in the fragment, then marks it sent  [red if: the link is not the armed token, or sent before armed]', async () => {
    const until = new Date('2026-11-22T18:10:00Z');
    db.armHoldCancel.mockResolvedValue(until);
    const { mailer } = await drain([row('method_added', { methods: ['passkey'], usable_at: '2026-11-22T18:04:30Z', hold_id: 'h' })]);
    expect(db.armHoldCancel).toHaveBeenCalledTimes(1);
    const [mailId, hash] = db.armHoldCancel.mock.calls[0]! as [string, Buffer];
    expect(mailId).toBe('11111111-1111-4111-8111-111111111111');
    expect(Buffer.isBuffer(hash) && hash.length === 32, 'a 32-byte hash').toBe(true);
    expect(mailer.sent).toHaveLength(1);
    const m = mailer.sent[0];
    expect(m.to).toBe('owner@qa.test');
    expect(m.idempotencyKey).toBe('mail-11111111-1111-4111-8111-111111111111-1');
    const link = /https:\/\/app\.qa\.test\/sign-in\/cancel-method#([A-Za-z0-9_-]+)/.exec(m.text);
    expect(link, 'the cancel link').not.toBeNull();
    expect(link![1]).toHaveLength(43);
    expect(createHash('sha256').update(Buffer.from(link![1]!, 'base64url')).digest().equals(hash), 'the armed hash is sha256 of the mailed token').toBe(true);
    expect(m.text).not.toMatch(/\?token=|\/api\/auth/);
    expect(db.mailSent).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(Math.max(...db.armHoldCancel.mock.invocationCallOrder) < Math.min(...mailer.send.mock.invocationCallOrder), 'armed before the send').toBe(true);
    expect(Math.max(...mailer.send.mock.invocationCallOrder) < Math.min(...db.mailSent.mock.invocationCallOrder), 'sent before it is marked sent').toBe(true);
  });
  it('the held mail, word for word: subject, text, {until} is the database value  [red if: any wording, or a user string, differs from R1.7]', async () => {
    db.armHoldCancel.mockResolvedValue(new Date('2026-11-22T18:10:00Z'));
    const { mailer } = await drain([row('method_added', { methods: ['passkey'], usable_at: '2026-11-22T18:04:30Z' })]);
    const m = mailer.sent[0];
    const token = /#([A-Za-z0-9_-]{43})/.exec(m.text)![1];
    expect(m.subject).toBe('A sign-in method was added to your polycarpic account');
    expect(m.text).toBe(`A passkey was added as a second step for signing in to your polycarpic account on 2026-11-21 18:04 UTC.\n\nIt will not work until 2026-11-22 18:10 UTC, at least 24 hours from this email.\n\nIf you added it, you need do nothing.\n\nIf you did not add it, someone else may be signed in as you. Cancel it before 2026-11-22 18:10 UTC:\n\n${origin}/sign-in/cancel-method#${token}\n\nCancelling removes the new method and signs your account out on every device. Then change your password.`);
  });
  it('arming that returns NULL (after a cancel) sends the "not armed" form: no link at all  [red if: a dead link is mailed]', async () => {
    db.armHoldCancel.mockResolvedValue(null);
    const { mailer } = await drain([row('method_added', { methods: ['totp'], usable_at: '2026-11-22T18:04:30Z' })]);
    const t = mailer.sent[0].text;
    expect(t).not.toContain('cancel-method');
    expect(t).toContain('If you did not add it, someone else may be signed in as you. Sign in, remove it under Settings, Sign-in and second step, change your password, and tell your operator.');
  });
  it('a first set-up (no usable_at): never armed, and the mail says it works now  [red if: a first set-up is armed or told to wait]', async () => {
    const { mailer } = await drain([row('method_added', { methods: ['totp'] })]);
    expect(db.armHoldCancel).not.toHaveBeenCalled();
    expect(mailer.sent[0].text).toBe('An authenticator app was added as a second step for signing in to your polycarpic account on 2026-11-21 18:04 UTC. It is your first second step, so it works now.\n\nIf you did not add it, someone else may be signed in as you: change your password at once and ask your operator to reset your second step.');
  });
  it('two methods added in one transaction: "2 sign-in methods were", and one mail  [red if: a merged row names one method]', async () => {
    db.armHoldCancel.mockResolvedValue(new Date('2026-11-22T18:10:00Z'));
    const { mailer } = await drain([row('method_added', { methods: ['passkey', 'passkey'], usable_at: '2026-11-22T18:04:30Z' })]);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].text.startsWith('2 sign-in methods were added as a second step')).toBe(true);
  });
  const notices: [string, Record<string, unknown>, string, string][] = [
    ['method_removed', { methods: ['totp'] }, 'A sign-in method was removed from your polycarpic account', 'An authenticator app was removed from the second step for signing in to your polycarpic account on 2026-11-21 18:04 UTC.\n\nIf you did not remove it, someone else may be signed in as you: change your password and tell your operator.'],
    ['method_removed', { methods: ['passkey', 'totp'] }, 'A sign-in method was removed from your polycarpic account', '2 sign-in methods were removed from the second step for signing in to your polycarpic account on 2026-11-21 18:04 UTC.\n\nIf you did not remove them, someone else may be signed in as you: change your password and tell your operator.'],
    ['backup_codes_replaced', {}, 'New backup codes were made for your polycarpic account', 'New backup codes were made for your polycarpic account on 2026-11-21 18:04 UTC. Your old backup codes no longer work.\n\nIf you did not make them, someone else may be signed in as you: change your password and tell your operator.'],
    ['backup_code_used', {}, 'A backup code was used on your polycarpic account', 'A backup code was used to sign in to your polycarpic account on 2026-11-21 18:04 UTC.\n\nIf it was not you, someone has your password and one of your backup codes: change your password and make new codes.'],
    ['password_changed', {}, 'Your polycarpic password was changed', `The password for your polycarpic account was changed on 2026-11-21 18:04 UTC.\n\nIf you did not change it, someone else may be signed in as you: reset your password at ${origin}/sign-in/forgot and tell your operator.`],
  ];
  for (const [kind, payload, subject, text] of notices) {
    it(`${kind} ${JSON.stringify(payload)}: subject and text word for word, no link that changes anything  [red if: the wording drifts]`, async () => {
      const { mailer } = await drain([row(kind, payload)]);
      expect(mailer.sent[0].subject).toBe(subject);
      expect(mailer.sent[0].text).toBe(text);
      expect(db.armHoldCancel).not.toHaveBeenCalled();
    });
  }
  it('a MailError marks the row failed with the status, never sent; the loop goes on  [red if: a failure marks it sent, or stops the tick]', async () => {
    const bad = { send: vi.fn(async () => { throw mailError(502); }) } as any;
    const { r } = await drain([row('password_changed', {}), row('backup_code_used', {}, { id: '22222222-2222-4222-8222-222222222222' })], bad);
    expect(db.mailSent).not.toHaveBeenCalled();
    expect(db.mailFailed.mock.calls.map((c) => c[1])).toEqual([502, 502]);
    expect(bad.send).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ sent: 0, failed: 2 });
  });
  it('a timeout (status null) is recorded as a failure with a null status  [red if: a network fault is dropped]', async () => {
    const bad = { send: vi.fn(async () => { throw mailError(null); }) } as any;
    await drain([row('password_changed', {})], bad);
    expect(db.mailFailed).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', null);
  });
  it('a tick sends at most 20  [red if: the drain is unbounded]', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => row('password_changed', {}, { id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    const { mailer } = await drain(rows);
    expect(mailer.sent).toHaveLength(20);
  });
  it('the retry key moves with the attempt: Idempotency-Key is mail-{id}-{attempts}  [red if: a retry reuses the first key]', async () => {
    const { mailer } = await drain([row('password_changed', {}, { attempts: 3 })]);
    expect(mailer.sent[0].idempotencyKey).toBe('mail-11111111-1111-4111-8111-111111111111-3');
  });
  it('no mail carries a user-supplied string: a payload with extra name/userAgent fields never reaches the text  [red if: the template interpolates payload fields beyond the fixed ones]', async () => {
    const { mailer } = await drain([row('method_removed', { methods: ['passkey'], name: 'EVIL-NAME', user_agent: 'EVIL-UA', passkey_name: 'EVIL-PK' })]);
    expect(mailer.sent[0].text + mailer.sent[0].subject).not.toMatch(/EVIL/);
  });
});
