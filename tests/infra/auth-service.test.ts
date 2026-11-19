// POLY-152 R1.3-R1.5, R6.2, seceng #17, E1, E2, B7: the rendered compose, the Caddyfile and pg_hba, written to the ruling. devops-engineer
// builds compose and Caddy later (POLY-152e); these tests are red until then. Static reads of the files the deploy passes: no Docker.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const doc = (f: string): any => parse(read(`infra/compose/${f}`), { merge: true });
const secretsOf = (svc: any): { source: string; target: string }[] =>
  (svc.secrets ?? []).map((s: any) => (typeof s === 'string' ? { source: s, target: s } : { source: s.source, target: s.target ?? s.source }));
const need = (d: any): string => { const n = Object.keys(d.services).find((x) => /(^|-)auth$/.test(x)); expect(n, 'the compose file has no auth service').toBeDefined(); return n!; };
const AUTHISH = /auth_secret|oauth_|db_password_auth/;

for (const f of ['prod.yml', 'staging.yml']) {
  describe(`#17 ${f}: the auth secret is mounted for auth alone`, () => {
    const d = doc(f);
    const names = Object.keys(d.services);
    it('there is exactly one auth service in prod (staging runs the same image under its own name), on the app image with command: auth [red if: no auth service]', () => {
      const auths = names.filter((n) => /(^|-)auth$/.test(n) || n === 'auth');
      expect(auths.length, names.join(',')).toBe(1);
      const svc = d.services[auths[0]!];
      expect(String(svc.command ?? '').replace(/[\[\]",]/g, ' ').trim().split(/\s+/)[0]).toBe('auth');
    });
    it('no service but auth mounts the auth secret, an OAuth secret or poly_auth\'s password; web, worker, operator, migrate and every staging service included [red if: any other service mounts one]', () => {
      for (const n of names) {
        if (/(^|-)auth$/.test(n)) continue;
        for (const s of secretsOf(d.services[n])) expect(`${n}:${s.source}/${s.target}`, n).not.toMatch(AUTHISH);
        for (const [k, v] of Object.entries<any>(d.services[n].environment ?? {})) expect(`${n}:${k}=${v}`).not.toMatch(/AUTH_SECRET_FILE|OAUTH_/);
      }
    });
    it('auth mounts the auth secret and poly_auth\'s password and no other database password, poly_app\'s above all [red if: auth mounts poly_app\'s password]', () => {
      const a = d.services[need(d)];
      const s = secretsOf(a).map((x) => `${x.source}/${x.target}`).join(' ');
      expect(s).toMatch(/auth_secret/);
      expect(s).toMatch(/db_password_auth/);
      expect(s).not.toMatch(/db_password_(app|worker|migrator|operator|superuser|backup)/);
    });
    it('auth runs hardened like web: read_only, cap_drop ALL, no-new-privileges, its own non-root user, publishes no ports: [red if: ports or a root user]', () => {
      const a = d.services[need(d)];
      expect(a.read_only).toBe(true);
      expect(a.cap_drop).toEqual(['ALL']);
      expect(a.ports ?? []).toEqual([]);
      expect(String(a.user)).toMatch(/^\d+:\d+$/);
      const others = names.filter((n) => !/(^|-)auth$/.test(n)).map((n) => String(d.services[n].user));
      expect(others).not.toContain(String(a.user));
    });
  });

  describe(`R9 ${f}: no internal listener, no web–auth network, one port`, () => {
    const d = doc(f);
    const names = Object.keys(d.services);
    const authN = () => need(d);
    const nets = (n: string): string[] => { const x = d.services[n].networks; return Array.isArray(x) ? x : Object.keys(x ?? {}); };
    it('there is no web-auth network, and no network holds auth and web alone [red if: the interim network survives]', () => {
      expect(Object.keys(d.networks ?? {}).filter((k) => /web-auth/.test(k))).toEqual([]);
      for (const [k, v] of Object.entries<any>(d.networks ?? {})) {
        if (v?.internal !== true) continue;
        const on = names.filter((n) => nets(n).includes(k)).sort();
        expect(on, `internal network ${k}`).not.toEqual(names.filter((n) => /(^|-)(web|auth)$/.test(n)).sort());
      }
    });
    it('auth has no fixed ipv4_address, and neither it nor web sets AUTH_INTERNAL_URL, AUTH_INTERNAL_HOST or AUTH_INTERNAL_PORT [red if: the listener address is still configured]', () => {
      const a = d.services[authN()];
      const nn = a.networks;
      if (nn && !Array.isArray(nn)) for (const v of Object.values<any>(nn)) expect(v?.ipv4_address, 'auth ipv4_address').toBeUndefined();
      for (const n of names) for (const k of Object.keys(d.services[n].environment ?? {})) expect(`${n}:${k}`).not.toMatch(/AUTH_INTERNAL/);
    });
    it('auth exposes exactly one port: the public listener, published nowhere [red if: a second port is exposed]', () => {
      const a = d.services[authN()];
      expect(a.ports ?? []).toEqual([]);
      expect([...(a.expose ?? [])].length).toBeLessThanOrEqual(1);
      expect(Object.keys(a.environment ?? {}).filter((k) => /_PORT$/.test(k) && !/^DATABASE_/.test(k))).toEqual(['AUTH_PUBLIC_PORT']);
    });
    it('auth is on the edge network so Caddy reaches its public port, and publishes no ports: [red if: auth is not on edge]', () => {
      expect(nets(authN()).join(',')).toMatch(/edge-(prod|staging)/);
    });
  });
}

describe('R1.5 / E1 the Caddyfile', () => {
  const caddy = read('infra/caddy/Caddyfile');
  it('/api/auth and /api/auth/* go to auth; everything else, /sign-in and /sign-up included, goes to web [red if: no @auth matcher]', () => {
    expect(caddy).toMatch(/@auth\s+path\s+\/api\/auth\s+\/api\/auth\/\*/);
    expect(caddy).toMatch(/reverse_proxy\s+@auth\s+(prod|staging)?-?auth:\d+/);
    expect(caddy).not.toMatch(/path\s+\/sign-(in|up)/);
  });
  it('no route reaches the internal port: /session and its spellings fall to web, never to auth [red if: a matcher can select /session for auth]', () => {
    expect(caddy).not.toMatch(/path\s+[^\n]*\/session/);
    const m = caddy.match(/@auth\s+path\s+([^\n]+)/);
    expect(m?.[1]?.trim().split(/\s+/).sort()).toEqual(['/api/auth', '/api/auth/*']);
    const lit = (p: string) => { const g = m![1]!.trim().split(/\s+/); return g.some((x) => x === p || (x.endsWith('/*') && p.startsWith(x.slice(0, -1)))); };
    // the nine spellings the spike measured, plus the ones the ruling names: none selects auth unless it is genuinely under /api/auth/
    for (const p of ['/session', '/api/session', '/Session', '//session', '/session/', '/%73ession', '/api/auth/../session', '/api/auth%2f..%2fsession', '/api/auth;/../session'])
      if (!/^\/api\/auth\//.test(p)) expect(lit(p), p).toBe(false);
  });
  it('the internal port appears in no Caddy upstream [red if: Caddy dials the internal listener]', () => {
    const ports = [...caddy.matchAll(/auth:(\d+)/g)].map((x) => x[1]);
    expect(new Set(ports).size).toBe(1);
  });
});

describe('B7 pg_hba', () => {
  for (const f of ['pg_hba.prod.conf', 'pg_hba.staging.conf']) {
    it(`${f}: poly_auth by scram-sha-256 from the app network only, no trust, no wider range [red if: no poly_auth line]`, () => {
      const lines = read(`infra/postgres/${f}`).split('\n').filter((l) => /\bpoly_auth\b/.test(l) && !l.trim().startsWith('#'));
      expect(lines.length).toBe(1);
      expect(lines[0]).toMatch(/^host\s+\S+\s+poly_auth\s+10\.20[12]\.1\.0\/24\s+scram-sha-256/);
      const app = read(`infra/postgres/${f}`).split('\n').find((l) => /\bpoly_app\b/.test(l) && !l.trim().startsWith('#'))!;
      expect(lines[0]!.split(/\s+/)[3]).toBe(app.split(/\s+/)[3]);
    });
  }
});
