// POLY-100 T-env (R11 env wiring): for each app service of each project, what compose gives it (environment: plus the host env file that
// provision.sh writes) covers every variable packages/config's checkConfig(service) requires. A service that would fail `check-config` on the box
// fails here first. Renders are the committed fixtures (tests/infra/ops/fixtures/gen_compose.py).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkConfig, type Service } from '../../packages/config/src/index.ts';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const render = (name: string) => JSON.parse(readFileSync(join(ROOT, 'tests', 'infra', 'ops', 'fixtures', 'compose', `${name}.raw.json`), 'utf8'));
const APP: Service[] = ['web', 'auth', 'worker', 'migrate', 'operator'];

/** The KEY=value lines provision.sh's host_env() writes (the env_file of every app service). */
function hostEnv(): Record<string, string> {
  const body = /host_env\(\) \{[\s\S]*?put_file "\$file" 0644 "([\s\S]*?)"\n\}/.exec(readFileSync(join(ROOT, 'infra', 'provision.sh'), 'utf8'));
  if (!body) throw new Error('host_env() not found in provision.sh');
  const out: Record<string, string> = {};
  for (const line of body[1].split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/\$origin/, 'https://app.example.com').replace(/\$instance/, 'polycarpic-x').replace(/^"\$from"$/, '"Polycarpic <no-reply@mail.example.com>"').replace(/^"|"$/g, '');
  }
  return out;
}

export function notSet(cfg: any, svc: Service): string[] {
  const s = cfg.services[svc];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.environment ?? {})) env[k] = String(v);
  for (const f of s.env_file ?? []) if ((typeof f === 'string' ? f : f.path).includes('host.env')) Object.assign(env, hostEnv());
  return checkConfig(svc, env).filter((p) => p.fault === 'not_set').map((p) => p.var);
}

describe('T-env: every app service is wired for check-config', () => {
  for (const project of ['staging', 'prod']) {
    for (const svc of APP) {
      it(`${project} ${svc}: nothing the service requires is left unset`, () => {
        expect(notSet(render(project), svc)).toEqual([]);
      });
    }
  }
  it('the host env file carries the keys provision.sh promises', () => {
    expect(Object.keys(hostEnv()).sort()).toEqual(expect.arrayContaining(['MAIL_FROM', 'PUBLIC_ORIGIN', 'TLS_MODE']));
  });
  it('the detector is live: renaming DATABASE_PASSWORD_FILE to DB_PASSWORD_FILE (the pre-R11 shape) is reported', () => {
    const cfg = render('staging');
    for (const svc of APP) {
      const e = cfg.services[svc].environment;
      e.DB_PASSWORD_FILE = e.DATABASE_PASSWORD_FILE;
      delete e.DATABASE_PASSWORD_FILE;
      expect(notSet(cfg, svc)).toContain('DATABASE_PASSWORD_FILE');
    }
  });
  it('the detector is live: a service with no env_file loses TLS_MODE and PUBLIC_ORIGIN', () => {
    const cfg = render('prod');
    delete cfg.services.web.env_file;
    expect(notSet(cfg, 'web')).toEqual(expect.arrayContaining(['TLS_MODE', 'PUBLIC_ORIGIN']));
  });
});
