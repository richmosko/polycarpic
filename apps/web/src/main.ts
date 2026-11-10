// The web entrypoint (POLY-85): `polycarpic web` runs this; `polycarpic web check-config` validates and exits.
// Order matters: crash handlers first (S-7b), then the configuration (refuse before any pool exists), then the schema
// guard, then the status listener. The public server arrives with POLY-88.
import { ConfigError, loadConfig, runCheckConfig } from '@poly/config';
import { createLogger } from '@poly/config/log';
import { init } from './startup.ts';
import { startStatusServer } from './ops/status.ts';

const log = createLogger({ service: 'web' });

// Node's default crash dump prints own properties such as pg's `detail`, which quotes values. Log type and code only.
const crash = (e: unknown): never => {
  log.fatal('process.crash', { outcome: 'error', err: e });
  process.exit(1);
};
process.on('uncaughtException', crash);
process.on('unhandledRejection', crash);

async function main(): Promise<void> {
  if (process.argv[2] === 'check-config') process.exit(runCheckConfig('web'));
  let config;
  try {
    config = loadConfig('web');
  } catch (e) {
    if (e instanceof ConfigError) {
      for (const p of e.problems) log.error('config.refused', { var: p.var, fault: p.fault, outcome: 'refused' });
      process.exit(1);
    }
    throw e;
  }
  await init();
  await startStatusServer({ port: config.statusPort });
  log.info('web.started', { outcome: 'ok', ...(config.imageRevision ? { commit: config.imageRevision } : {}) });
  process.on('SIGTERM', () => process.exit(0));
}

await main();
