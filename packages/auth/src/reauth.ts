// Confirm it's you (POLY-150 Addendum 3, A1): a signed-in, enrolled user proves a second step again and earns a fresh step-up for 300 s.
//   POST /second-step/reauth/begin    {method}                      -> {challengeId} (and WebAuthn request options for a passkey)
//   POST /second-step/reauth          {challengeId, password, code} -> the code check and the stamp, in one transaction
//   POST /second-step/reauth/passkey  {challengeId, response}       -> the assertion check and the stamp
// The stamp is app.complete_step_up, the one writer of session.recent_auth_at. The database checks the challenge, the lock and the
// TOTP step; the factor itself is checked here, because only this service can read the secret. The backup-code method is not built (D7).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { base64 } from '@better-auth/utils/base64';
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { APIError, createAuthEndpoint, createAuthMiddleware, sessionMiddleware } from 'better-auth/api';
import { symmetricDecrypt } from 'better-auth/crypto';
import { bandOf } from './lock-band.ts';
import { createRoutingPool } from './routing-pool.ts';

const pool = createRoutingPool();
const asRows = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FAILURES = 10;
const LOCK_MS = 15 * 60_000;

/** One answer for every way a re-check fails: a wrong password, a wrong code, a spent or foreign challenge, a refused assertion. */
const failed = () => new APIError('FORBIDDEN', { code: 'step_up_failed', message: 'step_up_failed' });

interface TwoFactorRow {
  id: string;
  secret: string;
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

const sha256 = (b: Uint8Array): Buffer => createHash('sha256').update(b).digest();

export function reauthEndpoints() {
  const verifiedRow = async (ctx: any, userId: string): Promise<TwoFactorRow | null> => {
    const rows = (await ctx.context.adapter.findMany({ model: 'twoFactor', where: [{ field: 'userId', value: userId }] })) as TwoFactorRow[];
    return rows.find((r) => r.verified === true) ?? null;
  };

  const begin = createAuthEndpoint('/second-step/reauth/begin', { method: 'POST', use: [sessionMiddleware] }, async (ctx: any) => {
    const { user } = ctx.context.session;
    const method = (ctx.body as { method?: unknown } | undefined)?.method;
    if (method !== 'totp' && method !== 'passkey') throw new APIError('BAD_REQUEST', { code: 'method_unavailable', message: 'method_unavailable' });
    try {
      if (method === 'totp') {
        const id = asRows<{ begin_step_up: string }>(await pool.query('SELECT app.begin_step_up($1, $2)', ['totp', null]))[0]?.begin_step_up;
        return ctx.json({ challengeId: id });
      }
      const keys = (await ctx.context.adapter.findMany({ model: 'passkey', where: [{ field: 'userId', value: user.id }] })) as { credentialID: string; transports?: string | null }[];
      const challenge = randomBytes(32);
      const id = asRows<{ begin_step_up: string }>(await pool.query('SELECT app.begin_step_up($1, $2)', ['passkey', sha256(challenge)]))[0]?.begin_step_up;
      const baseURL = String(ctx.context.options.baseURL);
      const options = await generateAuthenticationOptions({
        rpID: new URL(baseURL).hostname,
        userVerification: 'required',
        challenge,
        allowCredentials: keys.map((k) => ({ id: k.credentialID, transports: k.transports ? (k.transports.split(',') as never) : undefined })),
      });
      return ctx.json({ challengeId: id, options });
    } catch (e) {
      if ((e as { code?: string }).code === '42501') throw new APIError('BAD_REQUEST', { code: 'method_unavailable', message: 'method_unavailable' });
      throw e;
    }
  });

  const reauth = createAuthEndpoint('/second-step/reauth', { method: 'POST', use: [sessionMiddleware] }, async (ctx: any) => {
    const { user } = ctx.context.session;
    const body = (ctx.body ?? {}) as { challengeId?: unknown; password?: unknown; code?: unknown; backupCode?: unknown };
    const row = await verifiedRow(ctx, user.id);
    if (!row) throw failed();
    // 1. Not during a lock: before any check, and the answer says how long in bands (D6 b). A refusal during a lock counts for nothing.
    const until = row.lockedUntil ? new Date(row.lockedUntil).getTime() : 0;
    if (until > Date.now()) {
      throw new APIError('TOO_MANY_REQUESTS', { code: 'ACCOUNT_TEMPORARILY_LOCKED', message: 'ACCOUNT_TEMPORARILY_LOCKED', pausedFor: bandOf(until - Date.now()) });
    }
    if (body.backupCode !== undefined) throw new APIError('BAD_REQUEST', { code: 'method_unavailable', message: 'method_unavailable' });
    // 2. The password, against the signed-in user's own account. Never the factor's counter.
    const accounts = await ctx.context.internalAdapter.findAccounts(user.id);
    const credential = accounts.find((a: { providerId: string; password?: string | null }) => a.providerId === 'credential' && a.password);
    if (!credential) throw new APIError('FORBIDDEN', { code: 'password_required', message: 'password_required' });
    if (typeof body.password !== 'string' || !(await ctx.context.password.verify({ hash: credential.password, password: body.password }))) throw failed();
    // 3. The code, against this user's own row.
    const step = await matchedStep(await totpSecret(ctx, row.secret), body.code);
    if (step === null) {
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
    // 5. A right code: the stamp (the database spends the challenge and the step), then the correct-code reset.
    if (typeof body.challengeId !== 'string' || !UUID.test(body.challengeId)) throw failed();
    try {
      await pool.query('SELECT app.complete_step_up($1, $2, $3)', ['totp', body.challengeId, step]);
    } catch (e) {
      if ((e as { code?: string }).code === '42501') throw failed();
      throw e;
    }
    await ctx.context.adapter.update({ model: 'twoFactor', where: [{ field: 'id', value: row.id }], update: { failedVerificationCount: 0, lockedUntil: null } });
    return ctx.json({ status: true });
  });

  const passkey = createAuthEndpoint('/second-step/reauth/passkey', { method: 'POST', use: [sessionMiddleware] }, async (ctx: any) => {
    const { user } = ctx.context.session;
    const body = (ctx.body ?? {}) as { challengeId?: unknown; response?: any };
    if (typeof body.challengeId !== 'string' || !UUID.test(body.challengeId) || !body.response || typeof body.response !== 'object') throw failed();
    const refuse = async (): Promise<never> => {
      // A failed assertion has no counter: the service says so, and the database spends the challenge.
      await pool.query('SELECT app.record_step_up_failure()', []);
      throw failed();
    };
    const hash = asRows<{ step_up_challenge_hash: Buffer | null }>(await pool.query('SELECT app.step_up_challenge_hash($1)', [body.challengeId]))[0]?.step_up_challenge_hash;
    if (!hash) return refuse();
    const key = (await ctx.context.adapter.findOne({ model: 'passkey', where: [{ field: 'credentialID', value: String(body.response.id ?? '') }] })) as
      | { id: string; userId: string; credentialID: string; publicKey: string; counter: number; transports?: string | null }
      | null;
    if (!key || key.userId !== user.id) return refuse();
    let newCounter: number;
    try {
      const baseURL = String(ctx.context.options.baseURL);
      const v = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: (c: string) => {
          const got = sha256(Buffer.from(c, 'base64url'));
          return got.length === hash.length && timingSafeEqual(got, hash);
        },
        expectedOrigin: new URL(baseURL).origin,
        expectedRPID: new URL(baseURL).hostname,
        credential: { id: key.credentialID, publicKey: base64.decode(key.publicKey), counter: key.counter, transports: key.transports ? (key.transports.split(',') as never) : undefined },
        requireUserVerification: true,
      });
      if (!v.verified) return refuse();
      newCounter = v.authenticationInfo.newCounter;
    } catch {
      return refuse();
    }
    await ctx.context.adapter.update({ model: 'passkey', where: [{ field: 'id', value: key.id }], update: { counter: newCounter } });
    try {
      await pool.query('SELECT app.complete_step_up($1, $2, $3)', ['passkey', body.challengeId, null]);
    } catch (e) {
      if ((e as { code?: string }).code === '42501') throw failed();
      throw e;
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
    if (step !== null) await pool.query('SELECT app.note_totp_step($1, $2)', [userId, step]);
  }),
};
