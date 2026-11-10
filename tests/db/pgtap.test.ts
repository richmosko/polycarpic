// Runs every tests/db/pgtap/*.sql against a database migrated by the real runner with the real migrations,
// and fails on any "not ok" TAP line (psql prints TAP; no pg_prove needed).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { REAL_MIGRATIONS, freshDb, migrateCli } from './helpers/api';
import { psql } from './helpers/pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'pgtap');
let db: string;

beforeAll(() => {
  db = freshDb();
  const r = migrateCli(db, REAL_MIGRATIONS);
  expect(r.code, `migrate failed: ${r.err}${r.out}`).toBe(0);
  // pgTAP is installed by the superuser; tests then run as superuser to read the whole catalog
  expect(psql('CREATE EXTENSION IF NOT EXISTS pgtap', db).ok).toBe(true);
});

describe('pgTAP catalog invariants', () => {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    it(f, () => {
      const r = psql(readFileSync(join(dir, f), 'utf8'), db);
      expect(r.err, 'psql error').toBe('');
      const lines = r.out.split('\n');
      const bad = lines.filter((l) => /^not ok/.test(l) || /^# Looks like you failed/.test(l));
      expect(bad, lines.join('\n')).toEqual([]);
      expect(lines.filter((l) => /^ok /.test(l)).length).toBeGreaterThan(0);
    });
  }
});
