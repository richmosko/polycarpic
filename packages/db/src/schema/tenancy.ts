// The tenancy core (ARCH §3.1; POLY-62 ruling R2). Tables, columns, constraints and indexes only: policies, functions,
// triggers, FORCE ROW LEVEL SECURITY and grants are hand-written in 0003_tenancy_rules.sql, because they reference
// functions that need these tables first. Every key is a uuid with a database default (SECURITY C-18).
import { sql } from 'drizzle-orm';
import { check, customType, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';

const tstz = (name: string) => timestamp(name, { withTimezone: true });
const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => tstz('created_at').defaultNow().notNull();
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const entityType = pgTable(
  'entity_type',
  {
    id: id(),
    createdAt: createdAt(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    systemKey: text('system_key').unique(),
    ownerUserId: uuid('owner_user_id').references(() => user.id),
  },
  (t) => [
    check('entity_type_kind_check', sql`${t.kind} IN ('base','parent')`),
    check('entity_type_system_key_check', sql`${t.systemKey} IN ('person','trust','business','household','holding')`),
    check('entity_type_owner_check', sql`(${t.systemKey} IS NULL) = (${t.ownerUserId} IS NOT NULL)`),
  ],
).enableRLS();

export const entity = pgTable(
  'entity',
  {
    id: id(),
    createdAt: createdAt(),
    typeId: uuid('type_id').references(() => entityType.id),
    name: text('name'),
    taxClassification: text('tax_classification'),
    selfUserId: uuid('self_user_id').unique().references(() => user.id),
    purgedAt: tstz('purged_at'),
  },
  (t) => [
    check(
      'entity_tombstone_check',
      sql`(${t.purgedAt} IS NULL) = (${t.name} IS NOT NULL AND ${t.typeId} IS NOT NULL AND ${t.taxClassification} IS NOT NULL)`,
    ),
    check(
      'entity_tax_classification_check',
      sql`${t.taxClassification} IN ('individual','trust_grantor','trust_non_grantor','business_pass_through','business_c_corp','parent_joint_filers','parent_pass_through')`,
    ),
  ],
).enableRLS();

export const membership = pgTable(
  'membership',
  {
    id: id(),
    createdAt: createdAt(),
    entityId: uuid('entity_id').notNull().references(() => entity.id),
    userId: uuid('user_id').notNull().references(() => user.id),
    role: text('role').notNull(),
  },
  (t) => [
    unique('membership_entity_user_unique').on(t.entityId, t.userId),
    index('membership_user_id_idx').on(t.userId),
    check('membership_role_check', sql`${t.role} IN ('viewer','manager','owner')`),
  ],
).enableRLS();

export const invitation = pgTable(
  'invitation',
  {
    id: id(),
    createdAt: createdAt(),
    entityId: uuid('entity_id').references(() => entity.id),
    email: text('email').notNull(),
    role: text('role').notNull(),
    inviterUserId: uuid('inviter_user_id').references(() => user.id),
    tokenHash: bytea('token_hash').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    acceptedAt: tstz('accepted_at'),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [check('invitation_role_check', sql`${t.role} IN ('viewer','manager','owner')`)],
).enableRLS();

export const notification = pgTable(
  'notification',
  {
    id: id(),
    createdAt: createdAt(),
    entityId: uuid('entity_id').references(() => entity.id),
    recipientUserId: uuid('recipient_user_id').notNull().references(() => user.id),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    readAt: tstz('read_at'),
  },
  (t) => [index('notification_recipient_idx').on(t.recipientUserId)],
).enableRLS();

export const auditEvent = pgTable(
  'audit_event',
  {
    id: id(),
    createdAt: createdAt(),
    entityId: uuid('entity_id').references(() => entity.id),
    actorUserId: uuid('actor_user_id'),
    actor: text('actor').notNull(),
    kind: text('kind').notNull(),
    subjectUserId: uuid('subject_user_id'),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index('audit_event_entity_idx').on(t.entityId)],
).enableRLS();
