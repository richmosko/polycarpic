// POLY-104 S4 (seceng's F11 review): `gid_of <service> <secrets root>` picks the staging range by the root's name, so a staging root written with a
// trailing slash quietly got the PROD gids. No container: the function is cut out of each script by name and run; the expected gids are the
// `user:` of each service in the compose files.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const INFRA = join(dirname(new URL(import.meta.url).pathname), '..', '..', 'infra');
const SERVICES = ['postgres', 'web', 'worker', 'migrate', 'operator', 'auth'];
const users = (file: string): string[] => {
  const services = parse(readFileSync(join(INFRA, 'compose', file), 'utf8'), { merge: true }).services as Record<string, { user: string }>;
  return SERVICES.map((s) => services[s]!.user.split(':')[1]!);
};

function gids(script: string, root: string): string[] {
  const fn = /^gid_of\(\) \{.*?^\}$/ms.exec(readFileSync(join(INFRA, script), 'utf8'));
  if (!fn) throw new Error(`no gid_of() function in infra/${script}`);
  const r = spawnSync('bash', ['-c', `set -euo pipefail\ndie() { echo "$*" >&2; exit 1; }\n${fn[0]}\nfor s in ${SERVICES.join(' ')}; do gid_of "$s" "$1"; done`, 'gid', root], { encoding: 'utf8', timeout: 20_000 });
  if (r.status !== 0) throw new Error(`gid_of in infra/${script} failed: ${r.stderr}`);
  return r.stdout.trim().split('\n');
}

describe.each(['provision.sh', 'provision-check.sh'])('%s gid_of', (script) => {
  it.each(['/etc/polycarpic/staging-secrets', '/etc/polycarpic/staging-secrets/', '/etc/polycarpic/staging-secrets//'])('gives the staging gids for %s', (root) => {
    expect(gids(script, root)).toEqual(users('staging.yml'));
  });
  it.each(['/etc/polycarpic/secrets', '/etc/polycarpic/secrets/'])('gives the prod gids for %s', (root) => {
    expect(gids(script, root)).toEqual(users('prod.yml'));
  });
});
