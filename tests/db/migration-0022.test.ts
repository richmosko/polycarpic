// POLY-90 T-R3 (ruling R3 as replaced by addendum 1): the founder backfill over rows that exist before 0022. The chain is migrated to
// 0021, rows are written as superuser with triggers off (session_replication_role = replica), then the rest of the chain runs through
// the real runner. A live Person takes its user; any other entity takes the subject of its earliest membership.created audit row with
// role owner who still holds owner, else the earliest owner row (ties by membership id). A live entity with no answer, or a Person
// whose user holds no owner, refuses and the whole run rolls back. Titles end [red if: <mutation>].
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REAL_MIGRATIONS, applied, freshDb, journalOf, migrateCli, setJournal } from './helpers/api';
import { must } from './helpers/sql';

const REFUSAL = 'founder backfill: an entity has no owner to found it';
const uid = (k: number) => `00000000-0000-4000-8000-${String(922_000 + k).padStart(12, '0')}`;
const eid = (k: number) => `00000000-0000-4000-8000-${String(923_000 + k).padStart(12, '0')}`;
const mid = (k: number) => `00000000-0000-4000-8000-${String(924_000 + k).padStart(12, '0')}`;
const ago = (days: number) => `timestamptz '2026-06-01 00:00:00+00' - interval '${days} days'`;
const users = (...ks: number[]) => ks.map((k) => `INSERT INTO public."user" (id, name, email) VALUES ('${uid(k)}', 'm${k}', 'm${k}@qa.test');`).join('\n');
const business = (e: number) => `INSERT INTO public.entity (id, type_id, name, tax_classification) VALUES ('${eid(e)}', (SELECT id FROM public.entity_type WHERE system_key = 'business'), 'b${e}', 'business_c_corp');`;
const person = (e: number, self: number) => `INSERT INTO public.entity (id, type_id, name, tax_classification, self_user_id) VALUES ('${eid(e)}', (SELECT id FROM public.entity_type WHERE system_key = 'person'), 'p${e}', 'individual', '${uid(self)}');`;
const member = (m: number, e: number, u: number, role: string, days: number) => `INSERT INTO public.membership (id, entity_id, user_id, role, created_at) VALUES ('${mid(m)}', '${eid(e)}', '${uid(u)}', '${role}', ${ago(days)});`;
const created = (e: number, u: number, role: string, days: number) => `INSERT INTO public.audit_event (entity_id, actor, kind, subject_user_id, payload, created_at)
  VALUES ('${eid(e)}', 'none', 'membership.created', '${uid(u)}', jsonb_build_object('role', '${role}'), ${ago(days)});`;

/** A database at 0021 holding `seed`, and the means to run the rest of the real chain. */
function at0021(seed: string) {
  const dir = mkdtempSync(join(tmpdir(), 'poly90-mig-'));
  cpSync(REAL_MIGRATIONS, dir, { recursive: true });
  const full = journalOf(dir);
  const tags: string[] = full.entries.map((e: { tag: string }) => e.tag);
  for (const t of ['0022_', '0023_', '0024_']) expect(tags.some((x) => x.startsWith(t)), `the chain has a ${t} migration`).toBe(true);
  const to21 = { ...full, entries: full.entries.filter((e: { tag: string }) => e.tag < '0022') };
  expect(to21.entries.at(-1).tag).toMatch(/^0021_/);
  const db = freshDb();
  setJournal(dir, to21);
  const first = migrateCli(db, dir);
  expect(first.code, first.err + first.out).toBe(0);
  must(`BEGIN; SET LOCAL session_replication_role = replica;\n${seed}\nCOMMIT;`, db);
  const rest = () => { setJournal(dir, full); return migrateCli(db, dir); };
  return { db, rest, before: to21.entries.length, all: full.entries.length };
}
const forced = (db: string) => must(`SELECT array_to_string(array_agg(relname::text ORDER BY relname::text), ',') FROM pg_class
  WHERE oid IN ('public.entity'::regclass, 'public.membership'::regclass, 'public.audit_event'::regclass) AND relrowsecurity AND relforcerowsecurity`, db).rows[0]![0];

describe('the founder backfill on a database that holds entities', () => {
  it('T-R3: each live entity gets the ruled founder, a purged one none, and FORCE row security is back on  [red if: a Person does not take self_user_id; audit rows are ignored, or read without role = owner or still-holds-owner; the tie is not broken by membership id; the backfill runs under FORCE RLS]', () => {
    const seed = [
      users(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
      // 1: a Person whose co-owner is earlier by both clocks: the user wins
      person(1, 1), member(1, 1, 1, 'owner', 1), member(2, 1, 2, 'owner', 9), created(1, 2, 'owner', 9), created(1, 1, 'owner', 1),
      // 2: the audit order and the membership order disagree: the audit row wins
      business(2), member(3, 2, 3, 'owner', 2), member(4, 2, 4, 'owner', 8), created(2, 3, 'owner', 7), created(2, 4, 'owner', 3),
      // 3: the earliest audited owner (5) is a viewer now: the next audited owner who still holds it (6), not the earlier row (7)
      business(3), member(5, 3, 5, 'viewer', 9), member(6, 3, 6, 'owner', 2), member(7, 3, 7, 'owner', 8), created(3, 5, 'owner', 9), created(3, 6, 'owner', 5), created(3, 7, 'owner', 4),
      // 4: the earliest audit row seated a viewer, later raised: it does not count
      business(4), member(8, 4, 8, 'owner', 9), member(9, 4, 9, 'owner', 2), created(4, 8, 'viewer', 9), created(4, 9, 'owner', 2),
      // 5: no audit rows: the earliest owner row; the older viewer row does not count
      business(5), member(10, 5, 10, 'owner', 3), member(11, 5, 11, 'owner', 6), member(12, 5, 12, 'viewer', 20),
      // 6: no audit rows and equal times: the smaller membership id (inserted second)
      business(6), member(14, 6, 10, 'owner', 4), member(13, 6, 11, 'owner', 4),
      // 7: a tombstone with no members
      `INSERT INTO public.entity (id, purged_at) VALUES ('${eid(7)}', ${ago(1)});`,
    ].join('\n');
    const m = at0021(seed);
    const r = m.rest();
    expect(r.code, r.err + r.out).toBe(0);
    expect(applied(m.db)).toHaveLength(m.all);
    const got = Object.fromEntries(must(`SELECT id, coalesce(founding_owner_user_id::text, '') FROM public.entity`, m.db).rows);
    expect(got).toEqual({
      [eid(1)]: uid(1), [eid(2)]: uid(3), [eid(3)]: uid(6), [eid(4)]: uid(9), [eid(5)]: uid(11), [eid(6)]: uid(11), [eid(7)]: '',
    });
    expect(forced(m.db)).toBe('audit_event,entity,membership');
  }, 240_000);

  const refusals: [string, string][] = [
    ['a live Business with only a viewer', [users(1), business(1), member(1, 1, 1, 'viewer', 1)].join('\n')],
    ['a live entity with no member', [users(1), business(1)].join('\n')],
    ['a live Business whose only audited owner has no row left', [users(1), business(1), created(1, 1, 'owner', 2)].join('\n')],
    ['a Person whose user holds no owner, though another user does', [users(1, 2), person(1, 1), member(1, 1, 1, 'viewer', 5), member(2, 1, 2, 'owner', 4), created(1, 2, 'owner', 4)].join('\n')],
  ];
  for (const [name, seed] of refusals) {
    it(`T-R3: ${name} refuses the run and nothing of it is kept  [red if: the check is missing, the migration invents a founder, or a Person falls back to another owner]`, () => {
      // beside the bad entity, a good one that the backfill would fill: it must not stay filled
      const m = at0021([seed, users(30), business(30), member(30, 30, 30, 'owner', 1)].join('\n'));
      const r = m.rest();
      expect(r.code, r.out).not.toBe(0);
      expect(r.err + r.out).toContain(REFUSAL);
      expect(r.err + r.out).toContain('23514');
      expect(applied(m.db)).toHaveLength(m.before);
      expect(must(`SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.entity'::regclass AND attname = 'founding_owner_user_id' AND NOT attisdropped`, m.db).rows[0]![0]).toBe('0');
      expect(forced(m.db)).toBe('audit_event,entity,membership');
    }, 240_000);
  }
});
