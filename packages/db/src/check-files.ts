// File checks over the migration folder (ARCH §6.2, SECURITY C-85, T-91). Run by `pnpm lint` through
// scripts/check-migrations.ts; CI wiring is POLY-96. Pure: reads the folder, returns problems.
import fs from 'node:fs';
import path from 'node:path';
import { checkJournalOrder, MigrateRefusal, type JournalEntry } from './journal.ts';

/** poly_owner plus the C-10 definer-owner roles: the only SET ROLE targets a migration may name. */
export const DEFINER_OWNERS = ['poly_authz', 'poly_purge', 'poly_rollup', 'poly_graph', 'poly_stake', 'poly_govern', 'poly_journal'] as const;
const ALLOWED = new Set<string>(['poly_owner', ...DEFINER_OWNERS]);

export interface Problem {
  file: string;
  check: 'session-authorization' | 'reset-role' | 'set-role-target' | 'last-role-not-owner' | 'journal-order';
  detail: string;
}

const stripComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

export function checkSql(file: string, raw: string): Problem[] {
  const sql = stripComments(raw);
  const out: Problem[] = [];
  if (/\bSESSION\s+AUTHORIZATION\b/i.test(sql)) out.push({ file, check: 'session-authorization', detail: 'a session authorization switch is banned' });
  if (/\bRESET\s+ROLE\b/i.test(sql)) out.push({ file, check: 'reset-role', detail: 'a role reset is banned' });
  let last: string | undefined;
  for (const m of sql.matchAll(/\bSET\s+(?:(?:LOCAL|SESSION)\s+)?ROLE\s+(?:"([^"]+)"|([A-Za-z0-9_]+))/gi)) {
    const role = (m[1] ?? m[2])!;
    last = role;
    if (!ALLOWED.has(role)) out.push({ file, check: 'set-role-target', detail: `switching to ${role} is not poly_owner or a definer-owner role` });
  }
  if (last !== undefined && last !== 'poly_owner') out.push({ file, check: 'last-role-not-owner', detail: `the last role switch is ${last}, not poly_owner` });
  return out;
}

export function checkFolder(folder: string): Problem[] {
  const problems: Problem[] = [];
  const journalFile = path.join(folder, 'meta', '_journal.json');
  const entries = (JSON.parse(fs.readFileSync(journalFile, 'utf8')) as { entries: { tag: string; when: number }[] }).entries;
  try {
    checkJournalOrder(entries.map((e): JournalEntry => ({ ...e, hash: '' })));
  } catch (e) {
    if (!(e instanceof MigrateRefusal)) throw e;
    problems.push({ file: 'meta/_journal.json', check: 'journal-order', detail: e.message });
  }
  for (const f of fs.readdirSync(folder).filter((n) => n.endsWith('.sql')).sort()) {
    problems.push(...checkSql(f, fs.readFileSync(path.join(folder, f), 'utf8')));
  }
  return problems;
}
