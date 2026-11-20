// POLY-149c, ruling Addendum 7 item 1: 0017 removes every `web` marker, even one committed a moment ago, then validates the new kind CHECK.
// The chain is migrated to 0016, a fresh `web` marker is committed as superuser, then 0017 runs. Red at 9fc167f4: the delete matches nothing
// (FORCE RLS, no policy names poly_owner), so the new CHECK refuses the migration (23514). Titles end [red if: <mutation>].
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REAL_MIGRATIONS, applied, freshDb, journalOf, migrateCli, setJournal } from './helpers/api';
import { must } from './helpers/sql';

describe('0017 on a database that holds a fresh web marker', () => {
  it('0017 succeeds, no web row remains and tx_identity_kind_check is validated [red if: 0017 deletes under FORCE RLS with no policy, or adds the CHECK NOT VALID]', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poly149-mig-'));
    cpSync(REAL_MIGRATIONS, dir, { recursive: true });
    const full = journalOf(dir);
    const to16 = { ...full, entries: full.entries.filter((e: { tag: string }) => e.tag < '0017') };
    expect(to16.entries.at(-1).tag, 'the chain has a 0016 and a 0017').toMatch(/^0016_/);
    // POLY-150: the chain continues past 0017 (0018, 0019); the migration under test is the one entry between the two journals.
    const to17 = { ...full, entries: full.entries.filter((e: { tag: string }) => e.tag < '0018') };
    expect(to17.entries.length).toBe(to16.entries.length + 1);
    const db = freshDb();
    setJournal(dir, to16);
    const r1 = migrateCli(db, dir);
    expect(r1.code, r1.err + r1.out).toBe(0);
    expect(applied(db)).toHaveLength(to16.entries.length);
    // a marker created now, committed (one autocommit statement), under an hour old: the purge would not take it either
    must(`INSERT INTO app.tx_identity (xid, user_id, session_id, kind, created_at) VALUES (pg_current_xact_id(), gen_random_uuid(), NULL, 'web', now())`, db);
    expect(must(`SELECT count(*) FROM app.tx_identity WHERE kind = 'web'`, db).rows[0]![0]).toBe('1');
    setJournal(dir, full);
    const r2 = migrateCli(db, dir);
    expect(r2.code, r2.err + r2.out).toBe(0);
    expect(applied(db)).toHaveLength(full.entries.length);
    expect(must(`SELECT count(*) FROM app.tx_identity WHERE kind = 'web'`, db).rows[0]![0]).toBe('0');
    expect(must(`SELECT convalidated FROM pg_constraint WHERE conrelid = 'app.tx_identity'::regclass AND conname = 'tx_identity_kind_check'`, db).rows[0]![0]).toBe('t');
    expect(must(`SELECT count(*) FROM pg_policies WHERE schemaname = 'app' AND tablename = 'tx_identity' AND 'poly_owner' = ANY (roles)`, db).rows[0]![0], 'the policy of the delete did not outlive the file').toBe('0');
  }, 180_000);
});
