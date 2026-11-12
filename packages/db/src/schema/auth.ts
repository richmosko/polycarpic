// BetterAuth's four core tables, from `@better-auth/cli generate` (better-auth 1.7.18, drizzle/pg), edited: every id is a
// uuid with a database default (SECURITY §4.3(l)), every timestamp is timestamptz (ARCH §6.2), columns stay snake_case
// (§3.1c). Whether BetterAuth accepts uuid ids is measured on POLY-86. Grants live in the custom migration.
import { bigint, boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });
const id = () => uuid('id').primaryKey().defaultRandom();

export const user = pgTable('user', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  // POLY-86 (0004): written only by POLY-89's definers; poly_app can neither insert nor update either column.
  twoFactorEnabled: boolean('two_factor_enabled').default(false).notNull(),
  secondStepAt: tstz('second_step_at'),
  // POLY-87 (0006): the sign-up marker. Written only by app.stamp_signup_user (BEFORE INSERT) and cleared by
  // app.accept_invitations; no poly_app grant. "Inserted by this transaction" means signup_txid = pg_current_xact_id().
  signupTxid: bigint('signup_txid', { mode: 'number' }),
  createdAt: tstz('created_at').defaultNow().notNull(),
  updatedAt: tstz('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('user_signup_txid_idx').on(t.signupTxid)]);

export const session = pgTable(
  'session',
  {
    id: id(),
    expiresAt: tstz('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: tstz('created_at').defaultNow().notNull(),
    updatedAt: tstz('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    recentAuthAt: tstz('recent_auth_at'),
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
    updatedAt: tstz('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
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

export const twoFactor = pgTable(
  'two_factor',
  {
    id: id(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: tstz('locked_until'),
  },
  (t) => [index('two_factor_secret_idx').on(t.secret), index('two_factor_user_id_idx').on(t.userId)],
);

export const passkey = pgTable(
  'passkey',
  {
    id: id(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    createdAt: tstz('created_at').defaultNow(),
    aaguid: text('aaguid'),
  },
  (t) => [index('passkey_user_id_idx').on(t.userId), index('passkey_credential_id_idx').on(t.credentialID)],
);
