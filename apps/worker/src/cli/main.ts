// The operator CLI entry (POLY-142 R5): `polycarpic cli user invite <email> [--bootstrap]`. Every later operator subcommand hangs off
// this entry. Order: argv, configuration (refuse before any pool exists), schema guard, command, close, exit.
import { Writable } from 'node:stream';
import { ConfigError, loadConfig } from '@poly/config';
import { createLogger } from '@poly/config/log';
import { assertSchemaNotBehind } from '@poly/db/startup';
import { validOperatorEmail } from '@poly/tenancy';
import { runUserInvite } from './user-invite.ts';

const USAGE = 'usage: polycarpic cli user invite <email> [--bootstrap]\n';
const err = (s: string): void => void process.stderr.write(s);

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const flags = argv.filter((a) => a.startsWith('--'));
  const pos = argv.filter((a) => !a.startsWith('--'));
  if (pos[0] !== 'user' || pos[1] !== 'invite' || pos.length !== 3 || flags.length > 1 || flags.some((f) => f !== '--bootstrap')) {
    err(USAGE);
    return 1;
  }
  const email = pos[2]!;
  if (!validOperatorEmail(email)) {
    err(USAGE);
    return 1;
  }
  const log = createLogger({ service: 'worker', stream: new Writable({ write: (c, _e, cb) => (err(String(c)), cb()) }) });
  let config;
  try {
    config = loadConfig('worker');
  } catch (e) {
    if (e instanceof ConfigError) {
      for (const p of e.problems) log.error('config.refused', { var: p.var, fault: p.fault, outcome: 'refused' });
      return 1;
    }
    throw e;
  }
  try {
    await assertSchemaNotBehind('worker');
  } catch (e) {
    log.fatal('schema.refused', { outcome: 'refused', err: e });
    return 1;
  }
  return runUserInvite(
    { email, bootstrap: flags.length === 1 },
    { stdout: process.stdout, stderr: process.stderr, origin: config.publicOrigin },
  );
}

main().then(
  (code) => process.exit(code),
  (e) => {
    createLogger({ service: 'worker' }).fatal('process.crash', { outcome: 'error', err: e });
    process.exit(1);
  },
);
