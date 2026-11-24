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
  for (const line of body[1].replace(/\\"/g, '"').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/\$origin/, 'https://app.example.com').replace(/\$instance/, 'polycarpic-x').replace(/^"|"$/g, '');
  }
  return out;
}

const FAULTS_THAT_MEAN_WIRING = new Set(['not_set', 'mismatch', 'invalid', 'forbidden', 'secret_in_env']); // not: a secret file that is absent on the runner
/** S27: a mail file holds exactly one key, MAIL_FROM; the host file does not hold it (provision-check asserts both on the box). */
const MAIL_ENV = { MAIL_FROM: 'Polycarpic <no-reply@mail.example.com>' };
export function notSet(cfg: any, svc: Service, hostExtra: Record<string, string> = {}): string[] {
  const s = cfg.services[svc];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.environment ?? {})) env[k] = String(v);
  for (const f of s.env_file ?? []) { // later files override earlier ones, as Compose does
    const path = typeof f === 'string' ? f : f.path;
    if (path.endsWith('mail.env')) Object.assign(env, MAIL_ENV);
    else if (path.endsWith('host.env')) Object.assign(env, hostEnv(), hostExtra);
  }
  return checkConfig(svc, env).filter((p) => FAULTS_THAT_MEAN_WIRING.has(p.fault)).map((p) => `${p.var}:${p.fault}`);
}

describe('T-env: every app service is wired for check-config', () => {
  for (const project of ['staging', 'prod']) {
    for (const svc of APP) {
      it(`${project} ${svc}: nothing the service requires is left unset`, () => {
        expect(notSet(render(project), svc)).toEqual([]);
      });
    }
  }
  it('the host env file carries the keys provision.sh promises and not MAIL_FROM (S27: mail.env holds it)', () => {
    const keys = Object.keys(hostEnv());
    expect(keys).toEqual(expect.arrayContaining(['PUBLIC_ORIGIN', 'TLS_MODE']));
    expect(keys).not.toContain('MAIL_FROM');
  });
  it('the detector is live (S27): mail.env on web is reported, mail.env missing from worker is reported, MAIL_FROM back in host.env is reported', () => {
    for (const project of ['staging', 'prod']) {
      const mail = project === 'prod' ? '/etc/polycarpic/mail.env' : '/etc/polycarpic/staging-mail.env';
      const onWeb = render(project);
      onWeb.services.web.env_file.push(mail);
      expect(notSet(onWeb, 'web'), `${project} web with mail.env`).toContain('MAIL_FROM:forbidden');
      const noMail = render(project);
      noMail.services.worker.env_file = noMail.services.worker.env_file.filter((f: any) => !(typeof f === 'string' ? f : f.path).endsWith('mail.env'));
      expect(notSet(noMail, 'worker'), `${project} worker without mail.env`).toContain('MAIL_FROM:not_set');
      expect(notSet(render(project), 'web', { MAIL_FROM: 'Polycarpic <no-reply@mail.example.com>' }), `${project} web with MAIL_FROM in host.env`).toContain('MAIL_FROM:forbidden');
    }
  });
  it('the detector is live: renaming DATABASE_PASSWORD_FILE to DB_PASSWORD_FILE (the pre-R11 shape) is reported', () => {
    const cfg = render('staging');
    for (const svc of APP) {
      const e = cfg.services[svc].environment;
      e.DB_PASSWORD_FILE = e.DATABASE_PASSWORD_FILE;
      delete e.DATABASE_PASSWORD_FILE;
      expect(notSet(cfg, svc)).toContain('DATABASE_PASSWORD_FILE:not_set');
    }
  });
  it('the detector is live: a service with no env_file loses TLS_MODE and PUBLIC_ORIGIN', () => {
    const cfg = render('prod');
    delete cfg.services.web.env_file;
    expect(notSet(cfg, 'web')).toEqual(expect.arrayContaining(['TLS_MODE:not_set', 'PUBLIC_ORIGIN:not_set']));
  });
  it('the detector is live: PLAID_ENV absent is reported, and the two projects\' values swapped are reported as a mismatch', () => {
    for (const [project, other] of [['staging', 'prod'], ['prod', 'staging']]) {
      const cfg = render(project);
      for (const svc of APP) {
        const e = cfg.services[svc].environment;
        const kept = e.PLAID_ENV;
        delete e.PLAID_ENV;
        expect(notSet(cfg, svc), `${project} ${svc}`).toContain('PLAID_ENV:not_set');
        e.PLAID_ENV = render(other).services[svc].environment.PLAID_ENV;
        expect(e.PLAID_ENV).not.toBe(kept);
        expect(notSet(cfg, svc), `${project} ${svc} swapped`).toContain('PLAID_ENV:mismatch');
      }
    }
  });
});
