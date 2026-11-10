// The migrate entrypoint (ARCH §8.1):  migrate | migrate --plan | migrate check-config
// Exit codes: 0 ok / nothing pending, 3 --plan found pending files, 1 anything else (and every refusal).
import fs from 'node:fs';
import { checkConfig } from './config-check.ts';
import { MigrateRefusal } from './journal.ts';
import { migrate, plan } from './migrate.ts';

const SECRETS = process.env.POLY_SECRETS_DIR ?? '/run/secrets';
const HOST_ENV = process.env.POLY_HOST_ENV ?? '/etc/polycarpic/host.env';

function migratorUrl(): string {
  if (process.env.POLY_MIGRATOR_DATABASE_URL) return process.env.POLY_MIGRATOR_DATABASE_URL;
  const pw = fs.readFileSync(`${SECRETS}/db_password_migrator`, 'utf8').trim();
  const host = process.env.PGHOST ?? 'db';
  return `postgres://poly_migrator:${encodeURIComponent(pw)}@${host}:${process.env.PGPORT ?? '5432'}/${process.env.PGDATABASE ?? 'polycarpic'}`;
}

async function main(argv: string[]): Promise<number> {
  const [cmd] = argv;
  if (cmd === 'check-config') {
    const problems = checkConfig({ secretsDir: SECRETS, hostEnvFile: HOST_ENV });
    for (const p of problems) console.error(`check-config: ${p}`);
    return problems.length ? 1 : 0;
  }
  if (cmd === '--plan') {
    const pending = await plan({ url: migratorUrl() });
    for (const e of pending) console.log(e.tag);
    return pending.length ? 3 : 0;
  }
  if (cmd === undefined) {
    const applied = await migrate({ url: migratorUrl() });
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'nothing to apply');
    return 0;
  }
  console.error(`unknown argument: ${cmd}`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof MigrateRefusal ? `refused (${e.check}): ${e.message}` : e);
    process.exit(1);
  },
);
