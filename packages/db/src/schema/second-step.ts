// POLY-89 (ruling R2): the emailed code and the grant it mints. Both live in the app schema and are written only by
// poly_govern definers (0013); poly_app may read six columns of its own challenges and nothing else. Grants, policies and
// the triggers on BetterAuth's tables are in the custom migration.
import { sql } from 'drizzle-orm';
import { check, index, integer, pgSchema, uniqueIndex, uuid, text, customType } from 'drizzle-orm/pg-core';
import { timestamp } from 'drizzle-orm/pg-core';
import { session, user } from './auth.ts';

const appSchema = pgSchema('app');
const tstz = (name: string) => timestamp(name, { withTimezone: true });
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
    sessionId: uuid('session_id').references(() => session.id, { onDelete: 'set null' }),
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
