// The migration journal and the pure checks over it (ARCH §6.2, POLY-76 ruling §4.4, SECURITY T-91).
// No I/O beyond reading the migration folder; the runner and the schema guard share these.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';

export const DEFAULT_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

export interface JournalEntry {
  tag: string;
  when: number;
  hash: string;
}

export interface AppliedRow {
  hash: string;
  createdAt: number;
}

export class MigrateRefusal extends Error {
  check: 'journal-order' | 'not-a-prefix' | 'older-timestamp' | 'roles-missing' | 'wrong-role';
  constructor(check: MigrateRefusal['check'], message: string) {
    super(message);
    this.name = 'MigrateRefusal';
    this.check = check;
  }
}

export function readJournal(folder: string = DEFAULT_FOLDER): JournalEntry[] {
  const raw = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  const metas = readMigrationFiles({ migrationsFolder: folder });
  return raw.entries.map((e, i) => ({ tag: e.tag, when: e.when, hash: metas[i]!.hash }));
}

export function checkJournalOrder(journal: readonly JournalEntry[]): void {
  for (let i = 1; i < journal.length; i++) {
    if (journal[i]!.when <= journal[i - 1]!.when) {
      throw new MigrateRefusal(
        'journal-order',
        `journal timestamps must strictly increase: ${journal[i]!.tag} (${journal[i]!.when}) follows ${journal[i - 1]!.tag} (${journal[i - 1]!.when})`,
      );
    }
  }
}

/** Throws unless the applied rows are a hash-for-hash prefix of the journal. Returns the pending entries. */
export function pendingFrom(journal: readonly JournalEntry[], applied: readonly AppliedRow[]): JournalEntry[] {
  checkJournalOrder(journal);
  if (applied.length > journal.length) {
    throw new MigrateRefusal('not-a-prefix', `database has ${applied.length} applied migrations, the image only ${journal.length}`);
  }
  applied.forEach((row, i) => {
    if (row.hash !== journal[i]!.hash) {
      throw new MigrateRefusal('not-a-prefix', `applied migration #${i + 1} does not match ${journal[i]!.tag} (edited, reordered or inserted)`);
    }
  });
  const pending = journal.slice(applied.length);
  const last = applied.at(-1)?.createdAt ?? -Infinity;
  const older = pending.find((e) => e.when <= last);
  if (older) throw new MigrateRefusal('older-timestamp', `${older.tag} (${older.when}) is not later than the last applied migration (${last})`);
  return pending;
}
