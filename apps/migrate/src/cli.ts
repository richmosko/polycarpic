// The migrate entrypoint (ARCH §8.1):  migrate | migrate --plan | migrate check-config
// Exit codes: 0 ok / nothing pending, 3 --plan found pending files, 2 journal, tracking rows or roles diverge (nothing
// applied), 4 timed out on the advisory lock, 1 anything else. Connection: DATABASE_* names (ruling addendum 1).
import { checkConfig, MigrateRefusal, migrate, plan, urlFromEnv } from '@poly/db/migrate';

const FOLDER = process.env.POLY_MIGRATIONS_DIR;

// Transitional: a bare DATABASE_URL is accepted for apply and --plan only (never by check-config).
const url = () => (process.env.DATABASE_HOST ? urlFromEnv(process.env) : process.env.DATABASE_URL!);
const opts = () => ({ url: url(), ...(FOLDER ? { folder: FOLDER } : {}) });

async function main(argv: string[]): Promise<number> {
  const [cmd] = argv;
  if (cmd === 'check-config') {
    const problems = checkConfig(process.env);
    for (const p of problems) console.error(`check-config: ${p.what}`);
    return problems.length ? 1 : 0;
  }
  if (cmd === '--plan') {
    const pending = await plan(opts());
    for (const e of pending) console.log(e.tag);
    return pending.length ? 3 : 0;
  }
  if (cmd === undefined) {
    const applied = await migrate(opts());
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'nothing to apply');
    return 0;
  }
  console.error(`unknown argument: ${cmd}`);
  return 1;
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
