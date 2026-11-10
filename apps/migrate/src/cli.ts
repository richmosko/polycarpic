// The migrate entrypoint (ARCH §8.1):  migrate | migrate --plan | migrate check-config
// Exit codes: 0 ok / nothing pending, 3 --plan found pending files, 2 journal, tracking rows or roles diverge (nothing
// applied), 4 timed out on the advisory lock, 1 anything else. Connection: DATABASE_* names only (ruling addendum 1).
import { checkConfig, MigrateRefusal, migrate, plan } from '@poly/db/migrate';

// Test hook, not read in production: the tests point the runner at a fixture folder.
const FOLDER = process.env.POLY_MIGRATIONS_DIR;
const opts = () => ({ env: process.env, ...(FOLDER ? { folder: FOLDER } : {}) });

async function main(argv: string[]): Promise<number> {
  const [cmd] = argv;
  if (cmd !== undefined && cmd !== 'check-config' && cmd !== '--plan') {
    console.error(`unknown argument: ${cmd}`);
    return 1;
  }
  // every subcommand validates the environment first, so a stray DATABASE_URL is refused, not ignored
  const problems = checkConfig(process.env);
  for (const p of problems) console.error(`check-config: ${p.what}`);
  if (problems.length) return 1;
  if (cmd === 'check-config') return 0;
  if (cmd === '--plan') {
    const pending = await plan(opts());
    for (const e of pending) console.log(e.tag);
    return pending.length ? 3 : 0;
  }
  const applied = await migrate(opts());
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'nothing to apply');
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    if (e instanceof MigrateRefusal) {
      console.error(`refused (${e.check}): ${e.message}`);
      process.exit(e.exit);
    }
    console.error(e);
    process.exit(1);
  },
);
