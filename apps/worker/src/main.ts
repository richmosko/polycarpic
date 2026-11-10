// The worker entrypoint (POLY-85): `polycarpic worker` runs this; `polycarpic worker check-config` validates and exits.
// Same order as web: crash handlers, configuration (refuse before any pool exists), schema guard. The job loop arrives
// with the first job feature; until then the process idles so the container stays up.
import { ConfigError, loadConfig, runCheckConfig } from '@poly/config';
import { createLogger } from '@poly/config/log';
import { startupGuard } from './startup.ts';

const log = createLogger({ service: 'worker' });

const crash = (e: unknown): never => {
  log.fatal('process.crash', { outcome: 'error', err: e });
  process.exit(1);
};
process.on('uncaughtException', crash);
process.on('unhandledRejection', crash);

async function main(): Promise<void> {
  if (process.argv[2] === 'check-config') process.exit(runCheckConfig('worker'));
  let config;
  try {
    config = loadConfig('worker');
  } catch (e) {
    if (e instanceof ConfigError) {
      for (const p of e.problems) log.error('config.refused', { var: p.var, fault: p.fault, outcome: 'refused' });
      process.exit(1);
    }
    throw e;
  }
  await startupGuard();
  log.info('worker.started', { outcome: 'ok', ...(config.imageRevision ? { commit: config.imageRevision } : {}) });
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => undefined, 1 << 30); // idle until the first job feature adds the loop
}

await main();
