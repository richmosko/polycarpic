// The migration journal and the pure checks over it (ARCH §6.2, POLY-76 ruling §4.4, POLY-83 ruling R6, SECURITY T-91).
// No I/O beyond reading the migration folder; the runner shares these.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';

export const DEFAULT_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export interface JournalEntry {
  tag: string;
  when: number;
  hash: string;
}

export interface AppliedRow {
  hash: string;
  createdAt: number;
}

/** exit: 1 other failure, 2 journal/tracking divergence (nothing applied), 4 lock timeout. */
export class MigrateRefusal extends Error {
  check: 'journal-order' | 'not-a-prefix' | 'roles-missing' | 'wrong-role' | 'not-converged' | 'lock-timeout';
  exit: 1 | 2 | 4;
  constructor(check: MigrateRefusal['check'], message: string) {
    super(message);
    this.name = 'MigrateRefusal';
    this.check = check;
    this.exit = check === 'journal-order' || check === 'not-a-prefix' ? 2 : check === 'lock-timeout' ? 4 : 1;
  }
}

export function readJournal(folder: string = DEFAULT_FOLDER): JournalEntry[] {
  const raw = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  const metas = readMigrationFiles({ migrationsFolder: folder });
  return raw.entries.map((e, i) => ({ tag: e.tag, when: e.when, hash: metas[i]!.hash }));
}

export function checkJournalOrder(journal: readonly { tag: string; when: number }[]): void {
  for (let i = 1; i < journal.length; i++) {
    if (journal[i]!.when <= journal[i - 1]!.when) {
      throw new MigrateRefusal(
        'journal-order',
        `journal timestamps must strictly increase, and ${journal[i]!.tag} (${journal[i]!.when}) is not later than ${journal[i - 1]!.tag} (${journal[i - 1]!.when}): an older migration was merged behind a newer one`,
      );
    }
  }
}

/**
 * Throws unless the journal and the tracking rows agree hash for hash over their common length k. A database ahead of
 * the image (rollback to the previous release) is legal. Returns the pending entries (empty when T is as long as J).
 */
export function pendingFrom(journal: readonly JournalEntry[], applied: readonly AppliedRow[]): JournalEntry[] {
  checkJournalOrder(journal);
  const k = Math.min(journal.length, applied.length);
  for (let i = 0; i < k; i++) {
    if (applied[i]!.hash !== journal[i]!.hash) {
      throw new MigrateRefusal(
        'not-a-prefix',
        `applied migrations are not a hash-for-hash prefix of the journal: #${i + 1} ${journal[i]!.tag} hash mismatch (edited, reordered or inserted)`,
      );
    }
  }
  return journal.slice(k);
}
