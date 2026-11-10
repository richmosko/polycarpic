// File checks over the migration folder (POLY-83 ruling R8; ARCH §6.2, SECURITY C-85, T-91). Run by `pnpm lint` through
// scripts/check-migrations.ts; CI wiring is POLY-96. Pure: reads the folder, returns problems. The runner does not run
// this scan, so the privilege backstop (a file ending on another role fails its tracking insert) stays testable alone.
import fs from 'node:fs';
import path from 'node:path';
import { checkJournalOrder, MigrateRefusal } from './journal.ts';

/** poly_owner plus the C-10 definer-owner roles: the only role-switch targets a migration may name. Adding one is an ARCH + SECURITY change. */
export const DEFINER_OWNERS = ['poly_authz', 'poly_purge', 'poly_rollup', 'poly_graph', 'poly_stake', 'poly_govern', 'poly_journal'] as const;
const ALLOWED = new Set<string>(['poly_owner', ...DEFINER_OWNERS]);

export interface Problem {
  file: string;
  check: 'session-authorization' | 'reset' | 'local-role' | 'role-target' | 'set-config-role' | 'function-role-clause' | 'last-role-not-owner' | 'journal-order';
  detail: string;
}

/** Removes comments but keeps single-quoted literals intact, so '--' inside a string cannot hide what follows (N1). */
function stripComments(sql: string): string {
  let out = '';
  for (let i = 0; i < sql.length; ) {
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (sql.startsWith('--', i)) {
      const j = sql.indexOf('\n', i);
      i = j === -1 ? sql.length : j;
    } else if (sql.startsWith('/*', i)) {
      const j = sql.indexOf('*/', i + 2);
      i = j === -1 ? sql.length : j + 2;
      out += ' ';
    } else out += sql[i++];
  }
  return out;
}

/** Dollar-quoted bodies are scanned too (fail closed). */
export function checkSql(file: string, raw: string): Problem[] {
  const sql = stripComments(raw);
  const out: Problem[] = [];
  const add = (check: Problem['check'], detail: string) => out.push({ file, check, detail });
  if (/\bSESSION\s+AUTHORIZATION\b/i.test(sql)) add('session-authorization', 'a session authorization switch is banned');
  for (const m of sql.matchAll(/\bRESET\s+(ROLE|ALL|SESSION\s+AUTHORIZATION)\b/gi)) add('reset', `banned statement: ${m[0].replace(/\s+/g, ' ').toUpperCase()}`);
  if (/\bSET\s+LOCAL\s+ROLE\b/i.test(sql)) add('local-role', 'a transaction-local role switch is banned');
  if (/set_config\s*\(\s*'role'/i.test(sql)) add('set-config-role', 'a role set through the settings function is banned');
  if (/\bSET\s+role\s*(=|\bTO\b)/i.test(sql)) add('function-role-clause', 'a function role clause is banned');
  let last: string | undefined;
  // Any such statement whose target does not parse is itself a problem (fail closed).
  for (const m of sql.matchAll(/\bSET\s+(?:SESSION\s+)?ROLE\b(\s+(?:'([^']*)'|"([^"]*)"|([A-Za-z0-9_]+)))?/gi)) {
    const role = m[2] ?? m[3] ?? m[4];
    if (role === undefined) {
      add('role-target', 'a role switch whose target cannot be read is banned');
      last = '?';
      continue;
    }
    last = role;
    if (!ALLOWED.has(role)) add('role-target', `switching to ${role} is not poly_owner or a definer-owner role`);
  }
  if (last !== undefined && last !== 'poly_owner') add('last-role-not-owner', `the last role switch is ${last}, not poly_owner`);
  return out;
}

export function checkFolder(folder: string): Problem[] {
  const problems: Problem[] = [];
  const entries = (JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] }).entries;
  try {
    checkJournalOrder(entries);
  } catch (e) {
    if (!(e instanceof MigrateRefusal)) throw e;
    problems.push({ file: 'meta/_journal.json', check: 'journal-order', detail: e.message });
  }
  for (const f of fs.readdirSync(folder).filter((n) => n.endsWith('.sql')).sort()) {
    problems.push(...checkSql(f, fs.readFileSync(path.join(folder, f), 'utf8')));
  }
  return problems;
}
