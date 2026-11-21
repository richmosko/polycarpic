// The worker entrypoint (POLY-85): `polycarpic worker` runs this; `polycarpic worker check-config` validates and exits.
// Same order as web: crash handlers, configuration (refuse before any pool exists), schema guard. The job loop arrives
// The schedule (POLY-137 R5): three purges and the mail drain.
import { ConfigError, loadConfig, runCheckConfig } from '@poly/config';
import { createLogger } from '@poly/config/log';
import { resendMailer } from '@poly/mail';
import { buildJobs, startSchedule } from './jobs/index.ts';
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
  // POLY-137 R1.3: a staging or production worker has the key and the sender (check-config refused otherwise); development may have neither.
  const key = config.secrets.RESEND_API_KEY_FILE;
  const mailer = key && config.mailFrom ? resendMailer({ apiKey: key.reveal(), from: config.mailFrom }) : undefined;
  const schedule = startSchedule(buildJobs({ mailer, origin: config.publicOrigin, log }), log);
  process.on('SIGTERM', () => {
    schedule.stop();
    process.exit(0);
  });
}

await main();
