import { sql } from 'drizzle-orm';
import { pgTable, pgPolicy, uuid, text, timestamp } from 'drizzle-orm/pg-core';

// (a) RLS + a role-targeted policy.
export const spikeDoc = pgTable('spike_doc', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull(),
  body: text('body'),
}, () => [
  pgPolicy('spike_doc_owner_select', { for: 'select', to: 'poly_app', using: sql`owner_id = current_setting('app.user_id', true)` }),
]).enableRLS();

// (c) a table with a BEFORE INSERT trigger; the trigger and function are custom SQL (Drizzle Kit has no triggers/functions).
export const spikeNote = pgTable('spike_note', {
  id: uuid('id').primaryKey(),
  body: text('body'),
  touchedAt: timestamp('touched_at', { withTimezone: true }),
});

// (e) FORCE RLS (custom SQL) + two role-targeted policies; the definer function is custom SQL.
export const spikeVault = pgTable('spike_vault', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id'),
  secret: text('secret'),
}, () => [
  pgPolicy('spike_vault_authz_select', { for: 'select', to: 'poly_authz', using: sql`true` }),
  pgPolicy('spike_vault_app_select', { for: 'select', to: 'poly_app', using: sql`owner_id = current_setting('app.user_id', true)` }),
]).enableRLS();
