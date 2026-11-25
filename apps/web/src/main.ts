// The web entrypoint (POLY-85, POLY-161 R2): `polycarpic web` runs this; `polycarpic web check-config` validates and exits.
// Order matters: crash handlers (S-7b), check-config, the console guard, the configuration (refuse before any pool exists), the schema
// guard, the zone check, the status listener, then the built app mounted on 3000. The import of the build comes after the zone check
// because importing it runs Kit's server init.
import { ConfigError, loadConfig, runCheckConfig } from '@poly/config';
import { createLogger } from '@poly/config/log';
import { init } from './startup.ts';
import { guardConsole } from './ops/console.ts';
import { startStatusServer } from './ops/status.ts';
import { startWebServer, type WebHandler } from './ops/server.ts';
import { verifyZone } from './ops/zone.ts';

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
  guardConsole(log);
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
  // The adapter's own variables are not a way to configure this server (R1): a prefixed name is refused, whatever its value.
  const adapterVars = Object.keys(process.env).filter((k) => k.startsWith('POLY_ADAPTER_'));
  if (adapterVars.length > 0) {
    for (const v of adapterVars) log.error('config.refused', { var: v, fault: 'forbidden', outcome: 'refused' });
    process.exit(1);
  }
  await init();
  if ((await verifyZone(config.zone, { log })) === 'refused') process.exit(1);
  await startStatusServer({ port: config.statusPort });

  // After the zone check: importing the build runs Kit's server init. Typecheck needs no build (build-handler.d.ts).
  let handler: WebHandler;
  try {
    handler = (await import('#web-build')).handler;
  } catch (e) {
    log.fatal('web.build_missing', { outcome: 'error', err: e });
    process.exit(1);
  }
  const server = await startWebServer({ publicOrigin: config.publicOrigin, handler, log });
  log.info('web.started', { outcome: 'ok', ...(config.imageRevision ? { commit: config.imageRevision } : {}) });

  process.on('SIGTERM', () => {
    server.close();
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 5000).unref();
    server.once('close', () => process.exit(0));
  });
}

await main();
