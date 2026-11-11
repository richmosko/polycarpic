// POLY-102 V1 / V6: the registry entry for the db migrations, and the real drizzle-kit through check_dist_freshness.py
// (ruling R1, R2). The generic fixtures (fake generators, both modes, exit-2 rows) are scripts/cairn/tests/test_generated_freshness.py.
// Needs python3, git, and the workspace install (drizzle-kit under packages/db/node_modules); no Docker, no database.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ROOT } from './helpers.ts';

const CHECK = join(ROOT, 'scripts', 'cairn', 'check_dist_freshness.py');
const DB_PAIR = {
  name: 'db-migrations', mode: 'regenerate', root: 'packages/db', output: 'migrations', link: ['node_modules'], skip: ['.turbo'],
  command: ['./node_modules/.bin/drizzle-kit', 'generate'], timeout: 120, ci: true,
};

const git = (cwd: string, ...a: string[]) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = (cwd: string, msg: string) => { git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', msg); };

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** A tmp git repo holding a copy of the tracked packages/db, the R2 registry entry, and the real node_modules linked in. */
function dbRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'qa-gen-'));
  dirs.push(repo);
  git(repo, 'init', '-q');
  for (const f of git(ROOT, 'ls-files', 'packages/db').split('\n')) {
    mkdirSync(dirname(join(repo, f)), { recursive: true });
    cpSync(join(ROOT, f), join(repo, f));
  }
  symlinkSync(join(ROOT, 'packages', 'db', 'node_modules'), join(repo, 'packages', 'db', 'node_modules'));
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n.turbo\n');
  mkdirSync(join(repo, 'infra', 'ci'), { recursive: true });
  writeFileSync(join(repo, 'infra', 'ci', 'generated.json'), JSON.stringify({ pairs: [DB_PAIR] }, null, 2) + '\n');
  commit(repo, 'initial');
  return repo;
}
const check = (repo: string) => {
  const r = spawnSync('python3', [CHECK, '--pair', 'db-migrations', repo], { encoding: 'utf8' });
  return { code: r.status, text: (r.stdout ?? '') + (r.stderr ?? '') };
};
const kit = (repo: string, ...args: string[]) => {
  const r = spawnSync('./node_modules/.bin/drizzle-kit', args, { cwd: join(repo, 'packages', 'db'), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`drizzle-kit ${args.join(' ')}: ${r.stdout}${r.stderr}`);
};
const probe = (repo: string) => writeFileSync(join(repo, 'packages', 'db', 'src', 'schema', 'qa_probe.ts'),
  "import { integer, pgTable } from 'drizzle-orm/pg-core';\nexport const qaProbe = pgTable('qa_probe', { id: integer('id') });\n");

describe('infra/ci/generated.json (R2)', () => {
  it('registers db-migrations exactly as ruled, and nothing named like a built-in  [red if: file missing, a key differs, or `dashboard-dist` is repeated]', () => {
    const f = join(ROOT, 'infra', 'ci', 'generated.json');
    expect(existsSync(f), 'infra/ci/generated.json does not exist').toBe(true);
    const reg = JSON.parse(readFileSync(f, 'utf8'));
    expect(Object.keys(reg)).toEqual(['pairs']);
    expect(reg.pairs.find((p: { name: string }) => p.name === 'db-migrations')).toEqual(DB_PAIR);
    expect(reg.pairs.map((p: { name: string }) => p.name)).not.toContain('dashboard-dist');
  });
});

describe('db-migrations through the real drizzle-kit (V1)', () => {
  it('a clean copy of the tracked tree is fresh  [red if: the regenerate copy loses the real node_modules link or the real config, so drizzle-kit fails or rewrites]', () => {
    const r = check(dbRepo());
    expect(r.code, r.text).toBe(0);
    expect(r.text).toMatch(/^db-migrations: fresh: /m);
  });

  it('a schema edit committed without `generate` is stale  [red if: freshness is judged by history or by the journal alone]', () => {
    const repo = dbRepo();
    probe(repo);
    commit(repo, 'schema edit, no generate');
    const r = check(repo);
    expect(r.code, r.text).toBe(1);
    expect(r.text).toMatch(/^db-migrations: stale: /m);
  });

  it('the R1 sequence: schema edit, then `generate --custom`, committed, is still stale (T-91)  [red if: ancestry decides, since the custom migration is a later commit touching migrations/]', () => {
    const repo = dbRepo();
    probe(repo);
    kit(repo, 'generate', '--custom', '--name', 'x');
    commit(repo, 'schema edit + custom migration (its snapshot lacks the table)');
    const r = check(repo);
    expect(r.code, r.text).toBe(1);
    expect(r.text).toMatch(/^db-migrations: stale: /m);
  });

  it('after `generate` the same schema edit is fresh  [red if: a correctly regenerated tree still reads stale]', () => {
    const repo = dbRepo();
    probe(repo);
    kit(repo, 'generate');
    commit(repo, 'schema edit + generate');
    const r = check(repo);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toMatch(/^db-migrations: fresh: /m);
  });

  it('a doc-only commit after a fresh state stays fresh, and the check leaves the tree clean  [red if: any later commit flips it, or the run writes into the repo]', () => {
    const repo = dbRepo();
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'n.md'), 'n\n');
    commit(repo, 'docs only');
    const before = git(repo, 'status', '--porcelain', '--ignored');
    const r = check(repo);
    expect(r.code, r.text).toBe(0);
    expect(git(repo, 'status', '--porcelain', '--ignored')).toBe(before);
  });
});
