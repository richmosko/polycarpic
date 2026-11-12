// The migrate command body (ARCH §8.1), split from cli.ts so tests can run it in-process. Reads only `env`, never process.env.
// Exit codes: 0 ok / nothing pending, 3 --plan found pending files, 2 journal, tracking rows or roles diverge (nothing
// applied), 4 timed out on the advisory lock, 1 anything else. Connection: DATABASE_* names only (ruling addendum 1).
import { checkDatabaseConfig, runCheckConfig } from '@poly/config';
import { MigrateRefusal, migrate, plan } from '@poly/db/migrate';

async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  // Test hook, not read in production: the tests point the runner at a fixture folder.
  const folder = env.POLY_MIGRATIONS_DIR;
  const opts = () => ({ env, ...(folder ? { folder } : {}) });
  const [cmd] = argv;
  if (cmd !== undefined && cmd !== 'check-config' && cmd !== '--plan') {
    console.error(`unknown argument: ${cmd}`);
    return 1;
  }
  // check-config validates everything (one validator, packages/config). The runner commands check the DATABASE_* inputs
  // they use first, so a stray DATABASE_URL is refused, not ignored.
  if (cmd === 'check-config') return runCheckConfig('migrate', env);
  const problems = checkDatabaseConfig('migrate', env);
  for (const p of problems) console.error(`check-config: ${p.message}`);
  if (problems.length) return 1;
  if (cmd === '--plan') {
    const pending = await plan(opts());
    for (const e of pending) console.log(e.tag);
    return pending.length ? 3 : 0;
  }
  const applied = await migrate(opts());
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'nothing to apply');
  return 0;
}

export async function run(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  try {
    return await main(argv, env);
  } catch (e) {
    if (e instanceof MigrateRefusal) {
      console.error(`refused (${e.check}): ${e.message}`);
      return e.exit;
    }
    console.error(e);
    return 1;
  }
}
