// POLY-89c fixtures shared by the second-step suites (ruling 6eed53f8). Marked transactions are the POLY-147 shape: BEGIN, then
// app.enter_asserted_user($1,$2) as its own extended-mode statement, then the test's statements. `poly_auth` is the stage-2
// fixture role created once per run in helpers/api.ts setRolePasswords (R1.3).
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DB_PKG, url } from './pg';
import { must } from './sql';

export const pgmod = createRequire(join(DB_PKG, 'package.json'))('pg');
export const ROLES = ['poly_app', 'poly_auth'] as const;
export type Role = (typeof ROLES)[number];
export type Q = (text: string, values?: unknown[]) => Promise<any>;
export const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (x) { return x as any; } };
export const msgOf = (x: any): string => String(x?.cause?.message ?? x?.message ?? x);
export const codeOf = (x: any): string | undefined => x?.code ?? x?.cause?.code;

/**
 * The stage-2 fixture role (ruling R1.3): poly_auth with poly_app's grants by membership; roles.sql gains the real role only in
 * POLY-149. It is cluster-wide state, so only SERIAL files call these (tests/db/vitest.config.ts): the role exists while they run
 * and is gone before any pgtap role-hygiene suite reads pg_roles.
 */
export function createAuthRole(): void {
  must(`DO $$ BEGIN CREATE ROLE poly_auth LOGIN PASSWORD 'qa-poly_auth' IN ROLE poly_app; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
}
export function dropAuthRole(): void {
  must(`DROP ROLE IF EXISTS poly_auth`);
}

let counter = 0;
export const uuid = (tag: number, k: number) => `00000000-0000-4000-8000-${String(tag).padStart(6, '0')}${String(k).padStart(6, '0')}`;

export function fixture(db: string, tag: number) {
  const next = () => ++counter + 1000 * (process.pid % 97);
  const user = async (o: { enrolled?: boolean } = {}) => {
    const id = uuid(tag, next());
    const email = `c${id.slice(-8)}@qa.test`;
    must(`INSERT INTO public."user" (id, name, email, email_verified) VALUES ('${id}', 'C', '${email}', true)`, db);
    await committed('poly_app', id, null, (q) => q(`INSERT INTO public.entity (type_id, name, tax_classification, self_user_id) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'person'), $1, 'individual', $2)`, [`P${id}`, id]));
    if (o.enrolled) must(`BEGIN; INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s', 'b', '${id}', true); UPDATE public."user" SET two_factor_enabled = true WHERE id = '${id}'; COMMIT;`, db);
    return { id, email };
  };
  /** A real session row (superuser fixture); `fresh` stamps recent_auth_at now. */
  const session = (userId: string, fresh = false): string =>
    must(`INSERT INTO public.session (user_id, token, expires_at${fresh ? ', recent_auth_at' : ''}) VALUES ('${userId}', 'tk${next()}${Math.random()}', now() + interval '1 day'${fresh ? ', now()' : ''}) RETURNING id`, db).rows[0]![0]!;
  async function run<T>(role: Role, userId: string | null, sessionId: string | null, fn: (q: Q) => Promise<T>, commit: boolean): Promise<T> {
    const c = new pgmod.Client({ connectionString: url(role, db) });
    await c.connect();
    const q: Q = (text, values) => c.query({ text, values, queryMode: 'extended' });
    try {
      await q('BEGIN');
      if (userId) await q('SELECT app.enter_asserted_user($1, $2)', [userId, sessionId ?? '00000000-0000-4000-8000-0000000089e1']);
      const r = await fn(q);
      if (commit) await q('COMMIT');
      return r;
    } finally { if (!commit) await c.query('ROLLBACK').catch(() => {}); else await c.query('ROLLBACK').catch(() => {}); await c.end(); }
  }
  const marked = <T>(role: Role, u: string | null, s: string | null, fn: (q: Q) => Promise<T>) => run(role, u, s, fn, false);
  const committed = <T>(role: Role, u: string | null, s: string | null, fn: (q: Q) => Promise<T>) => run(role, u, s, fn, true);
  const one = (sql: string) => must(sql, db).rows[0]?.[0];
  return { user, session, marked, committed, one };
}

/** RFC 6238 SHA-1, 30 s, 6 digits, from a base32 secret (the otpauth URI's `secret`). */
export function totp(base32: string, at = Date.now()): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of base32.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac('sha1', key).update(ctr).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}
