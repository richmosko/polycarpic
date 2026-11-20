// Confirm it's you (POLY-150 Addendum 3 and 4): a signed-in, enrolled user proves a second step again and earns a fresh step-up for 300 s.
//   POST /second-step/reauth/begin    {method}                                      -> {challengeId, options?}
//   POST /second-step/reauth          {challengeId, password, code | backupCode}    -> the factor check and the stamp, in one transaction
//   POST /second-step/reauth/passkey  {challengeId, response}                       -> the assertion check and the stamp
// The stamp is app.complete_step_up, the one writer of session.recent_auth_at. The database checks the challenge, the lock and the
// TOTP step; the factor itself is checked here, because only this service can read the secret. Every refusal is `{code, message}`.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { base64 } from '@better-auth/utils/base64';
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { APIError, createAuthEndpoint, createAuthMiddleware, sessionMiddleware } from 'better-auth/api';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { createRoutingPool } from './routing-pool.ts';

const pool = createRoutingPool();
const asRows = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FAILURES = 10;
const LOCK_MS = 15 * 60_000;

const refuse = (status: 'BAD_REQUEST' | 'FORBIDDEN' | 'TOO_MANY_REQUESTS', code: string) => new APIError(status, { code, message: code });
/** One answer for every way a re-check fails: a wrong password, a wrong code, a spent step, a refused or foreign assertion. */
const failed = () => refuse('FORBIDDEN', 'step_up_failed');
const invalid = () => refuse('BAD_REQUEST', 'invalid_request');
/** The lock refusal on a re-check: no band, because this caller has a session (D6 b is for a held sign-in only). */
const locked = () => refuse('TOO_MANY_REQUESTS', 'ACCOUNT_TEMPORARILY_LOCKED');

interface TwoFactorRow {
  id: string;
  secret: string;
  backupCodes?: string;
  verified?: boolean;
  lockedUntil?: Date | string | null;
}

/** The TOTP step (30 s) a 6-digit code matches, within one step either side of now; null when it matches none. Constant time. */
export async function matchedStep(secret: string | Uint8Array, code: unknown, nowMs = Date.now()): Promise<number | null> {
  if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) return null;
  const otp = createOTP(secret, { period: 30, digits: 6 });
  const now = Math.floor(nowMs / 30_000);
  let hit: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const want = Buffer.from(await otp.hotp(step));
    if (timingSafeEqual(want, Buffer.from(code)) && hit === null) hit = step;
  }
  return hit;
}

/** The stored secret as BetterAuth's own verify reads it (totp/index.mjs): encrypted under the auth secret, base32 when imported. */
export async function totpSecret(ctx: { context: { secretConfig: unknown } }, stored: string): Promise<string | Uint8Array> {
  const secret = await symmetricDecrypt({ key: ctx.context.secretConfig as never, data: stored });
  return secret.startsWith('base32:') ? base32.decode(secret.slice(7).toUpperCase()) : secret;
}

/** A definer's refusal aborts the transaction, and a refusal below 500 must still commit what came before it (the counter), so each call runs under a savepoint. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  await pool.query('SAVEPOINT reauth_step', []);
  try {
    const out = await run();
    await pool.query('RELEASE SAVEPOINT reauth_step', []);
    return out;
  } catch (e) {
    await pool.query('ROLLBACK TO SAVEPOINT reauth_step', []);
    throw e;
  }
}

const sha256 = (b: Uint8Array): Buffer => createHash('sha256').update(b).digest();
const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** complete_step_up's two fixed refusal messages (Addendum 4): the challenge, or anything else. Neither reaches the client. */
function fromComplete(e: unknown): never {
  const err = e as { code?: string; message?: string };
  if (err.code === '42501' && err.message === 'step_up_challenge') throw refuse('FORBIDDEN', 'challenge_expired');
  if (err.code === '42501') throw failed();
  throw e;
}

/** A body must be exactly the listed fields: a missing, extra or mistyped one is the client's bug (400 invalid_request). */
const exact = (body: unknown, allowed: readonly string[]): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
  for (const k of Object.keys(body)) if (!allowed.includes(k)) throw invalid();
  return body as Record<string, unknown>;
};
const challengeIdOf = (b: Record<string, unknown>): string => {
  if (typeof b.challengeId !== 'string' || !UUID.test(b.challengeId)) throw invalid();
  return b.challengeId;
};

export function reauthEndpoints() {
  const verifiedRow = async (ctx: any, userId: string): Promise<TwoFactorRow | null> => {
    const rows = (await ctx.context.adapter.findMany({ model: 'twoFactor', where: [{ field: 'userId', value: userId }] })) as TwoFactorRow[];
    return rows.find((r) => r.verified === true) ?? null;
  };
  const isLocked = (row: TwoFactorRow | null): boolean => !!row?.lockedUntil && new Date(row.lockedUntil).getTime() > Date.now();

  const begin = createAuthEndpoint('/second-step/reauth/begin', { method: 'POST', use: [sessionMiddleware] }, async (ctx: any) => {
    const { user } = ctx.context.session;
    const method = exact(ctx.body, ['method']).method;
    if (method !== 'totp' && method !== 'backup_code' && method !== 'passkey') throw invalid();
    // The code paths are refused during a lock, here as on /reauth; the passkey path stays open.
    if (method !== 'passkey' && isLocked(await verifiedRow(ctx, user.id))) throw locked();
    try {
      if (method !== 'passkey') {
        const id = asRows<{ begin_step_up: string }>(await guarded(() => pool.query('SELECT app.begin_step_up($1, $2)', [method, null])))[0]?.begin_step_up;
        return ctx.json({ challengeId: id });
      }
      const keys = (await ctx.context.adapter.findMany({ model: 'passkey', where: [{ field: 'userId', value: user.id }] })) as { credentialID: string; transports?: string | null }[];
      const challenge = randomBytes(32);
      const id = asRows<{ begin_step_up: string }>(await guarded(() => pool.query('SELECT app.begin_step_up($1, $2)', ['passkey', sha256(challenge)])))[0]?.begin_step_up;
      const baseURL = String(ctx.context.options.baseURL);
      const options = await generateAuthenticationOptions({
        rpID: new URL(baseURL).hostname,
        userVerification: 'required',
        challenge,
        allowCredentials: keys.map((k) => ({ id: k.credentialID, transports: k.transports ? (k.transports.split(',') as never) : undefined })),
      });
      return ctx.json({ challengeId: id, options });
    } catch (e) {
      if ((e as { code?: string }).code === '42501') throw refuse('FORBIDDEN', 'method_unavailable');
      throw e;
    }
  });

  const reauth = createAuthEndpoint('/second-step/reauth', { method: 'POST', use: [sessionMiddleware] }, async (ctx: any) => {
    const { user } = ctx.context.session;
    const body = exact(ctx.body, ['challengeId', 'password', 'code', 'backupCode']);
    const challengeId = challengeIdOf(body);
    if (typeof body.password !== 'string' || (body.code === undefined) === (body.backupCode === undefined)) throw invalid();
    if (body.code !== undefined && (typeof body.code !== 'string' || !/^[0-9]{6}$/.test(body.code))) throw invalid();
    if (body.backupCode !== undefined && (typeof body.backupCode !== 'string' || body.backupCode.length === 0 || body.backupCode.length > 64)) throw invalid();
    const row = await verifiedRow(ctx, user.id);
    if (!row) throw refuse('FORBIDDEN', 'method_unavailable');
    // 1. Not during a lock: before any check. A refusal during a lock counts for nothing.
    if (isLocked(row)) throw locked();
    // 2. The password, against the signed-in user's own account. It never touches the factor's counter.
    const accounts = await ctx.context.internalAdapter.findAccounts(user.id);
    const credential = accounts.find((a: { providerId: string; password?: string | null }) => a.providerId === 'credential' && a.password);
    if (!credential) throw refuse('FORBIDDEN', 'password_required');
    if (!(await ctx.context.password.verify({ hash: credential.password, password: body.password }))) throw failed();
    // 3. The factor, against this user's own row.
    const viaBackup = body.backupCode !== undefined;
    let remaining: string[] = [];
    let right: boolean;
    let step: number | null = null;
    if (viaBackup) {
      let list: string[] = [];
      try {
        const parsed: unknown = JSON.parse(await symmetricDecrypt({ key: ctx.context.secretConfig, data: row.backupCodes ?? '' }));
        if (Array.isArray(parsed)) list = parsed.filter((c): c is string => typeof c === 'string');
      } catch {
        list = [];
      }
      const given = body.backupCode as string;
      let at = -1;
      list.forEach((c, i) => { if (same(c, given) && at < 0) at = i; });
      right = at >= 0;
      remaining = list.filter((_, i) => i !== at);
    } else {
      step = await matchedStep(await totpSecret(ctx, row.secret), body.code);
      right = step !== null;
    }
    if (!right) {
      // 4. BetterAuth's own counter statements (totp: recordTwoFactorFailure); the lock guard in the database doubles the streak.
      const bumped = (await ctx.context.adapter.incrementOne({ model: 'twoFactor', where: [{ field: 'id', value: row.id }], increment: { failedVerificationCount: 1 } })) as { failedVerificationCount?: number } | null;
      if ((bumped?.failedVerificationCount ?? 0) >= MAX_FAILURES) {
        await ctx.context.adapter.incrementOne({
          model: 'twoFactor',
          where: [{ field: 'id', value: row.id }, { field: 'failedVerificationCount', operator: 'gte', value: MAX_FAILURES }],
          increment: {},
          set: { lockedUntil: new Date(Date.now() + LOCK_MS) },
        });
      }
      throw failed();
    }
    // 5. A right factor, in this order (A3.3): the stamp, then the backup-code list, then the correct-code reset.
    try {
      await guarded(() => pool.query('SELECT app.complete_step_up($1, $2, $3)', [viaBackup ? 'backup_code' : 'totp', challengeId, step]));
    } catch (e) {
      fromComplete(e);
    }
    if (viaBackup) {
      const data = await symmetricEncrypt({ key: ctx.context.secretConfig, data: JSON.stringify(remaining) });
      await ctx.context.adapter.update({ model: 'twoFactor', where: [{ field: 'id', value: row.id }], update: { backupCodes: data } });
    }
    await ctx.context.adapter.update({ model: 'twoFactor', where: [{ field: 'id', value: row.id }], update: { failedVerificationCount: 0, lockedUntil: null } });
    return ctx.json({ status: true });
  });

  const passkey = createAuthEndpoint('/second-step/reauth/passkey', { method: 'POST', use: [sessionMiddleware] }, async (ctx: any) => {
    const { user } = ctx.context.session;
    const body = exact(ctx.body, ['challengeId', 'response']);
    const challengeId = challengeIdOf(body);
    const response = body.response as { id?: unknown } | null;
    if (!response || typeof response !== 'object' || typeof response.id !== 'string') throw invalid();
    const fail = async (): Promise<never> => {
      // A failed assertion has no counter: the service says so, and the database spends the challenge.
      await pool.query('SELECT app.record_step_up_failure()', []);
      throw failed();
    };
    const hash = asRows<{ step_up_challenge_hash: Buffer | null }>(await pool.query('SELECT app.step_up_challenge_hash($1)', [challengeId]))[0]?.step_up_challenge_hash;
    if (!hash) throw refuse('FORBIDDEN', 'challenge_expired');
    const key = (await ctx.context.adapter.findOne({ model: 'passkey', where: [{ field: 'credentialID', value: response.id }] })) as
      | { id: string; userId: string; credentialID: string; publicKey: string; counter: number; transports?: string | null }
      | null;
    if (!key || key.userId !== user.id) return fail();
    let newCounter: number;
    try {
      const baseURL = String(ctx.context.options.baseURL);
      const v = await verifyAuthenticationResponse({
        response: body.response as never,
        expectedChallenge: (c: string) => {
          const got = sha256(Buffer.from(c, 'base64url'));
          return got.length === hash.length && timingSafeEqual(got, hash);
        },
        expectedOrigin: new URL(baseURL).origin,
        expectedRPID: new URL(baseURL).hostname,
        credential: { id: key.credentialID, publicKey: base64.decode(key.publicKey), counter: key.counter, transports: key.transports ? (key.transports.split(',') as never) : undefined },
        requireUserVerification: true,
      });
      if (!v.verified) return fail();
      newCounter = v.authenticationInfo.newCounter;
    } catch (e) {
      if (e instanceof APIError) throw e;
      return fail();
    }
    await ctx.context.adapter.update({ model: 'passkey', where: [{ field: 'id', value: key.id }], update: { counter: newCounter } });
    try {
      await guarded(() => pool.query('SELECT app.complete_step_up($1, $2, $3)', ['passkey', challengeId, null]));
    } catch (e) {
      fromComplete(e);
    }
    return ctx.json({ status: true });
  });

  return { reauthBegin: begin, reauth, reauthPasskey: passkey };
}

/** A3.4: a code accepted at sign-in or at first enrolment is spent for re-checks too, across sessions. After BetterAuth's own verify. */
export const noteTotpStepHook = {
  matcher: (c: { path?: string }) => c.path === '/two-factor/verify-totp',
  handler: createAuthMiddleware(async (ctx: any) => {
    const returned = ctx.context.returned as { user?: { id?: string } } | undefined;
    const userId = returned?.user?.id;
    if (!userId || returned instanceof APIError) return;
    const rows = (await ctx.context.adapter.findMany({ model: 'twoFactor', where: [{ field: 'userId', value: userId }] })) as TwoFactorRow[];
    const row = rows.find((r) => r.verified === true);
    if (!row) return;
    const step = await matchedStep(await totpSecret(ctx, row.secret), (ctx.body as { code?: unknown } | undefined)?.code);
    if (step === null) return;
    // A step outside the database's own window (a clock apart by a full step) is not worth failing a sign-in BetterAuth has accepted.
    await guarded(() => pool.query('SELECT app.note_totp_step($1, $2)', [userId, step])).catch((e: unknown) => {
      if ((e as { code?: string }).code !== '42501') throw e;
      console.error(JSON.stringify({ event: 'totp_step_not_noted' }));
    });
  }),
};
