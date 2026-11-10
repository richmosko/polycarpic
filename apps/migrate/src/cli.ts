// The migrate entrypoint (ARCH §8.1):  migrate | migrate --plan | migrate check-config
// Exit codes: 0 ok / nothing pending, 3 --plan found pending files, 2 journal and tracking rows diverge (nothing applied),
// 4 timed out on the advisory lock, 1 anything else.
import fs from 'node:fs';
import { checkConfig, MigrateRefusal, migrate, plan } from '@poly/db/migrate';

const SECRETS = process.env.POLY_SECRETS_DIR ?? '/run/secrets';
const FOLDER = process.env.POLY_MIGRATIONS_DIR;

function migratorUrl(): string {
  const direct = process.env.POLY_MIGRATOR_DATABASE_URL ?? process.env.DATABASE_URL;
  if (direct) return direct;
  const pw = fs.readFileSync(`${SECRETS}/db_password_migrator`, 'utf8').trim();
  const port = process.env.PGPORT ?? '5432';
  return `postgres://poly_migrator:${encodeURIComponent(pw)}@${process.env.PGHOST}:${port}/${process.env.PGDATABASE}`;
}

async function main(argv: string[]): Promise<number> {
  const [cmd] = argv;
  if (cmd === 'check-config') {
    const problems = checkConfig({ secretsDir: SECRETS, env: process.env });
    for (const p of problems) console.error(`check-config: ${p.what}`);
    return problems.length ? 1 : 0;
  }
  if (cmd === '--plan') {
    const pending = await plan({ url: migratorUrl(), ...(FOLDER ? { folder: FOLDER } : {}) });
    for (const e of pending) console.log(e.tag);
    return pending.length ? 3 : 0;
  }
  if (cmd === undefined) {
    const applied = await migrate({ url: migratorUrl(), ...(FOLDER ? { folder: FOLDER } : {}) });
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
