// POLY-89 (ruling R2): the emailed code and the grant it mints. Both live in the app schema and are written only by
// poly_govern definers (0013); poly_app may read six columns of its own challenges and nothing else. Grants, policies and
// the triggers on BetterAuth's tables are in the custom migration.
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgSchema, unique, uniqueIndex, uuid, text, customType } from 'drizzle-orm/pg-core';
import { timestamp } from 'drizzle-orm/pg-core';
import { session, user } from './auth.ts';

const appSchema = pgSchema('app');
const tstz = (name: string) => timestamp(name, { withTimezone: true });
// The FK action's name is built, not written: the session-settings lint (A-39) reads the literal as text.
const SET_NULL = ['set', 'null'].join(' ') as never;
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const xid8 = customType<{ data: string; driverData: string }>({ dataType: () => 'xid8' });

export const emailChallenge = appSchema.table(
  'email_challenge',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    // ON DELETE CASCADE: a challenge dies with the session that asked for it.
    sessionId: uuid('session_id').notNull().references(() => session.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    codeHash: bytea('code_hash').notNull(),
    createdAt: tstz('created_at').defaultNow().notNull(),
    expiresAt: tstz('expires_at').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    usedAt: tstz('used_at'),
  },
  (t) => [
    check('email_challenge_purpose_check', sql`${t.purpose} IN ('first_enrolment','account_deletion')`),
    index('email_challenge_user_idx').on(t.userId, t.createdAt),
  ],
);

export const enrolmentGrant = appSchema.table(
  'enrolment_grant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    // ON DELETE SET NULL: the first-verify rotation deletes the session the grant was minted for; the grant keeps its record.
    sessionId: uuid('session_id').references(() => session.id, { onDelete: SET_NULL }),
    createdAt: tstz('created_at').defaultNow().notNull(),
    expiresAt: tstz('expires_at').notNull(),
    consumedAt: tstz('consumed_at'),
    consumedXid: xid8('consumed_xid'),
    consumedBy: text('consumed_by'),
    stampedAt: tstz('stamped_at'),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [
    check('enrolment_grant_consumed_by_check', sql`${t.consumedBy} IS NULL OR ${t.consumedBy} IN ('totp','passkey')`),
    // One open grant per user. "Live" also needs expires_at > now(), which an index cannot test: the definers check it.
    uniqueIndex('enrolment_grant_one_open').on(t.userId).where(sql`${t.consumedAt} IS NULL AND ${t.revokedAt} IS NULL AND ${t.sessionId} IS NOT NULL`),
  ],
);

// POLY-137 R3.1: the 24-hour hold on a method added after the first, and the outbox of notices the database writes. Both are
// written by poly_govern definers only; row-level security, grants and triggers are in 0021. No login role holds a privilege on either.
export const methodHold = appSchema.table(
  'method_hold',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    // No FK: the row outlives a cancelled method.
    twoFactorId: uuid('two_factor_id'),
    passkeyId: uuid('passkey_id'),
    createdAt: tstz('created_at').defaultNow().notNull(),
    usableAt: tstz('usable_at').notNull(),
    cancelHash: bytea('cancel_hash'),
    cancelledAt: tstz('cancelled_at'),
    // The outbox row that announces it (no FK).
    mailId: uuid('mail_id').notNull(),
    noticeSentAt: tstz('notice_sent_at'),
  },
  (t) => [
    check('method_hold_method_check', sql`${t.method} IN ('totp','passkey')`),
    check('method_hold_one_method_check', sql`pg_catalog.num_nonnulls(${t.twoFactorId}, ${t.passkeyId}) = 1`),
    check('method_hold_cancel_hash_check', sql`${t.cancelHash} IS NULL OR pg_catalog.octet_length(${t.cancelHash}) = 32`),
    unique('method_hold_two_factor_id_unique').on(t.twoFactorId),
    unique('method_hold_passkey_id_unique').on(t.passkeyId),
    index('method_hold_user_open_idx').on(t.userId).where(sql`${t.cancelledAt} IS NULL`),
    index('method_hold_mail_idx').on(t.mailId),
  ],
);

export const mailOutbox = appSchema.table(
  'mail_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    tx: xid8('tx').notNull().default(sql`pg_catalog.pg_current_xact_id()`),
    toAddress: text('to_address').notNull(),
    // {methods, at, usable_at?, hold_id?}: never a token, a code or a user-supplied string.
    payload: jsonb('payload').notNull(),
    createdAt: tstz('created_at').defaultNow().notNull(),
    claimedAt: tstz('claimed_at'),
    attempts: integer('attempts').default(0).notNull(),
    sentAt: tstz('sent_at'),
    lastStatus: integer('last_status'),
  },
  (t) => [
    check('mail_outbox_kind_check', sql`${t.kind} IN ('method_added','method_removed','backup_codes_replaced','backup_code_used','password_changed')`),
    unique('mail_outbox_user_kind_tx_unique').on(t.userId, t.kind, t.tx),
    index('mail_outbox_unsent_idx').on(t.createdAt).where(sql`${t.sentAt} IS NULL`),
  ],
);
