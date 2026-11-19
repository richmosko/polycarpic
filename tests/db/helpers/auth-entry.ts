// The e2e harness's sign-in service entry (POLY-150 R4): the real service, started in-process with ONE dependency replaced, the delivery of
// the second-step code. The stand-in appends {email, code} as a JSON line to .auth/outbox.jsonl (mode 0600). The path is fixed here: no env
// var names it, and the shipped service reads none. It is reachable only by importing startAuthService with a `deps` argument under
// APP_ENV=development, which a release image refuses (R4). Nothing under apps/auth names this file.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAuthService } from '../../../apps/auth/src/main.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outbox = join(here, '..', '..', '..', 'apps', 'web', 'tests', 'e2e', '.auth', 'outbox.jsonl');
mkdirSync(dirname(outbox), { recursive: true });

const sendSecondStepCode = async (m: { email: string; code: string }): Promise<void> => {
  appendFileSync(outbox, `${JSON.stringify({ email: m.email, code: m.code })}\n`, { mode: 0o600 });
};

const svc = await startAuthService(process.env, { sendSecondStepCode });
const stop = () => void svc.close().then(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
