// BetterAuth's four core tables, from `@better-auth/cli generate` (better-auth 1.7.18, drizzle/pg), edited: every id is a
// uuid with a database default (SECURITY §4.3(l)), every timestamp is timestamptz (ARCH §6.2), columns stay snake_case
// (§3.1c). Whether BetterAuth accepts uuid ids is measured on POLY-86. Grants live in the custom migration.
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });
const id = () => uuid('id').primaryKey().defaultRandom();

export const user = pgTable('user', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: tstz('created_at').defaultNow().notNull(),
  updatedAt: tstz('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const session = pgTable(
  'session',
  {
    id: id(),
    expiresAt: tstz('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: tstz('created_at').defaultNow().notNull(),
    updatedAt: tstz('updated_at').$onUpdate(() => new Date()).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_userId_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: id(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: tstz('access_token_expires_at'),
    refreshTokenExpiresAt: tstz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: tstz('created_at').defaultNow().notNull(),
    updatedAt: tstz('updated_at').$onUpdate(() => new Date()).notNull(),
  },
  (t) => [index('account_userId_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: tstz('created_at').defaultNow().notNull(),
    updatedAt: tstz('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);
