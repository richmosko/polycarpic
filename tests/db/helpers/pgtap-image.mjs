// The pgTAP test image: one owner for the Postgres base pin, the image tag and the `docker build` argv (POLY-141 T1).
// pg.ts imports these; ci.yml starts the build early with `node tests/db/helpers/pgtap-image.mjs --build`, so the build
// overlaps the setup steps. Plain JS and node built-ins only: it runs on the runner's own node, before Set up Node.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// The Postgres base is the ONE FROM line of infra/postgres/Dockerfile (INFRA §6.1a); the cached image is named after
// its digest, so a bump never reuses a stale build.
export const PG_BASE = (readFileSync(join(ROOT, 'infra', 'postgres', 'Dockerfile'), 'utf8').split('\n').find((l) => l.startsWith('FROM ')) ?? '').slice(5).trim();
if (!/^postgres:\d+\.\d+@sha256:[0-9a-f]{64}$/.test(PG_BASE)) throw new Error(`infra/postgres/Dockerfile: no pinned FROM line (${PG_BASE})`);
export const IMAGE = `polycarpic-pgtap:${PG_BASE.split('@sha256:')[1].slice(0, 12)}`;

/** The argv of the one `docker build` that makes IMAGE. */
export function buildArgv() {
  return ['build', '--build-arg', `PG_BASE=${PG_BASE}`, '-t', IMAGE, join(ROOT, 'tests', 'db', 'docker')];
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href && process.argv.includes('--build')) {
  const r = spawnSync('docker', buildArgv(), { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
