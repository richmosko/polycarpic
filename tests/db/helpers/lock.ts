// POLY-149c: shared fixtures for the growing second-step lock (ruling R2) and the sign-in record (R3). "A fake clock" is row facts moved by a
// superuser helper (ruling R2, "The clock in tests"): Node's Date is not faked except by T-L1, which sets it deliberately.
import { PW, post, type Env } from './auth';
import { enrolTotp, hasSessionCookie, heldSignIn } from './auth-service';
import { pgmod, totp } from './second-step';
import { must } from './sql';

export const TOTP = '/two-factor/verify-totp';
export const BACKUP = '/two-factor/verify-backup-code';
export type Path = typeof TOTP | typeof BACKUP;
export const PATHS: Path[] = [TOTP, BACKUP];
export const GROWTH = [15, 30, 60, 120, 240, 480, 960, 1440, 1440]; // minutes: seven doublings, the cap, and one past it

/** Make the lock lapse: one superuser transaction in replica mode (so the guard does not fire), as auth-refresh.test.ts does for rows. */
export const lapseLock = (db: string, userId: string): void => {
  must(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.two_factor SET locked_until = clock_timestamp() - interval '1 second' WHERE user_id = '${userId}'; COMMIT;`, db);
};
export const lockMinutes = (db: string, userId: string): number =>
  Number(must(`SELECT extract(epoch FROM (locked_until - clock_timestamp())) / 60 FROM public.two_factor WHERE user_id = '${userId}'`, db).rows[0]![0]);
export const isLocked = (db: string, userId: string): boolean => must(`SELECT coalesce(locked_until > clock_timestamp(), false) FROM public.two_factor WHERE user_id = '${userId}'`, db).rows[0]![0] === 't';
/** The doubling's state: null when the user has no streak row. Reads as the superuser (no login role may). */
export const streakOf = (db: string, userId: string): number | null => {
  const r = must(`SELECT locks FROM app.second_step_streak WHERE user_id = '${userId}'`, db).rows[0];
  return r ? Number(r[0]) : null;
};
export const recordRows = (db: string, userId: string, kind?: string) =>
  must(`SELECT kind, session_id, lock_minutes, ip_address, user_agent, created_at FROM app.sign_in_record WHERE user_id = '${userId}'${kind ? ` AND kind = '${kind}'` : ''} ORDER BY id`, db).rows;
export const recordCount = (db: string, userId: string, kind?: string): number => recordRows(db, userId, kind).length;
export const sessionsOf = (db: string, userId: string): number => Number(must(`SELECT count(*) FROM public.session WHERE user_id = '${userId}'`, db).rows[0]![0]);

export const wrongTotp = (secret: string): string => { const c = totp(secret); return c === '000000' ? '000001' : '000000'; };
export const wrongBody = (path: Path, secret: string) => (path === TOTP ? { code: wrongTotp(secret) } : { code: 'wrong-code-000' });

export type Factor = { auth: any; u: { id: string; email: string }; secret: string; backupCodes: string[]; next: () => string };
/** A user with an enrolled TOTP factor and backup codes, set up over the real handler. `ip` is carried by every request below. */
export async function factor(e: Env, mails: { email: string; code: string }[], opts: { sendSecondStepCode?: boolean } = {}): Promise<Factor> {
  const auth = await e.A.createAuth({ ...e.optionsOf('real-domain', { sendSecondStepCode: async (m: any) => { mails.push({ email: String(m.email ?? m.to ?? ''), code: Object.values(m).find((v) => typeof v === 'string' && /^\d{6}$/.test(v as string)) as string }); } }), rateLimit: { enabled: false } });
  void opts;
  const u = e.seedUser();
  const { secret, backupCodes } = await enrolTotp(e, auth, u, mails);
  let i = 0;
  return { auth, u, secret, backupCodes, next: () => backupCodes[i++]! };
}

const withHeaders = (req: Request, h: Record<string, string>): Request => { for (const [k, v] of Object.entries(h)) req.headers.set(k, v); return req; };
/** `n` counted wrong codes on `path`, opening a fresh hold every 5 (a hold allows 5, measured in POLY-152). Returns the last response. */
export async function wrongCodes(e: Env, f: Factor, path: Path, n: number, headers: Record<string, string> = {}): Promise<Response[]> {
  const out: Response[] = [];
  let held = await heldSignIn(e, f.auth, f.u.email);
  for (let i = 1; i <= n; i++) {
    if (i > 1 && (i - 1) % 5 === 0) held = await heldSignIn(e, f.auth, f.u.email);
    out.push(await e.handle(withHeaders(post(path, wrongBody(path, f.secret), held.cookie), headers), f.auth));
  }
  return out;
}
/** Reach a lock with 10 counted wrong codes (the factor's count must be 0 on entry) and return its length in minutes. */
export async function lockOnce(e: Env, f: Factor, path: Path, headers: Record<string, string> = {}): Promise<number> {
  await wrongCodes(e, f, path, 10, headers);
  return lockMinutes(e.db, f.u.id);
}
/** A fresh hold, then the RIGHT code for `path`. Returns the response. */
export async function rightCode(e: Env, f: Factor, path: Path): Promise<Response> {
  const held = await heldSignIn(e, f.auth, f.u.email);
  return e.handle(post(path, path === TOTP ? { code: totp(f.secret) } : { code: f.next() }, held.cookie), f.auth);
}
export { hasSessionCookie, PW };

/** Every statement (text and values) the pg client sends while `fn` runs. */
export async function captureStatements<T>(fn: () => Promise<T>): Promise<{ result: T; stmts: { text: string; values: unknown[] }[] }> {
  const stmts: { text: string; values: unknown[] }[] = [];
  const orig = pgmod.Client.prototype.query;
  pgmod.Client.prototype.query = function (this: unknown, ...a: any[]) { const q = a[0]; stmts.push({ text: typeof q === 'string' ? q : String(q?.text), values: (typeof q === 'object' && q?.values) || a[1] || [] }); return orig.apply(this, a); };
  try { return { result: await fn(), stmts }; } finally { pgmod.Client.prototype.query = orig; }
}
