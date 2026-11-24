#!/usr/bin/env node
// Compose-policy lint (SECURITY C-70, C-79; INFRA §2.2, §6.1a). POLY-95.
//   node infra/lint/compose-policy.mjs --root <dir> [--policy <file>]
// Renders infra/compose/{edge,prod,staging}.yml (each on its own, every profile on) with `docker compose config`, checks
// the rendered and the raw files against the rules, and checks the Postgres tag/digest/major, pg_hba, and Caddyfile
// files. Prints one `[rule-id] file: message` per violation to stderr; exit 1 on any. Fails closed: a missing compose
// file, a render error, a missing/invalid policy, or a missing `docker compose` is a violation, never a skip.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const KINDS = ['edge', 'prod', 'staging'];
const violations = [];
const SERVICE_EXEC = {
  postgres: { command: ['postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'] },
  web: { command: ['web'] }, auth: { command: ['auth'] }, worker: { command: ['worker'] }, migrate: { command: ['migrate'] },
  operator: { entrypoint: ['/app/bin/polycarpic', 'cli'] },
};
const v = (id, file, msg) => violations.push(`[${id}] ${file}: ${msg}`);
const HOST_SECRETS = /(^|\/)secrets\/host(\/|$)/;

function args() {
  const a = process.argv.slice(2);
  const o = { root: null, policy: join(HERE, 'policy.json') };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--root') o.root = a[++i];
    else if (a[i] === '--policy') o.policy = a[++i];
  }
  return o;
}
const { root: rootArg, policy: policyPath } = args();
if (!rootArg) { console.error('usage: compose-policy.mjs --root <dir> [--policy <file>]'); process.exit(2); }
const ROOT = resolve(rootArg);
const read = (rel) => { const p = join(ROOT, rel); return existsSync(p) ? readFileSync(p, 'utf8') : null; };

let policy;
try { policy = JSON.parse(readFileSync(policyPath, 'utf8')); } catch (e) { console.error(`[policy] ${policyPath}: ${e.message}`); process.exit(1); }
for (const k of ['renderEnv', 'allowedVars', 'secretMatrix', 'secretPrefix', 'binds']) {
  if (policy[k] == null) { console.error(`[policy] ${policyPath}: missing "${k}"`); process.exit(1); }
}

// ---- helpers
const ipInt = (s) => s.split('.').reduce((n, o) => n * 256 + Number(o), 0);
function cidr(c) {
  const [ip, bits = '32'] = c.split('/');
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
  const size = 2 ** (32 - Number(bits));
  const start = Math.floor(ipInt(ip) / size) * size;
  return [start, start + size - 1];
}
const overlap = (a, b) => { const x = cidr(a), y = cidr(b); return x && y && x[0] <= y[1] && y[0] <= x[1]; };
const list = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const projectOf = (netName) => /^polycarpic-(?:edge-)?(prod|staging)(?=[-_]|$)/.exec(netName)?.[1] ?? null;
const EDGE_NET = /^polycarpic-edge-(prod|staging)$/;

function hbaRules(text) {
  return text.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).map((l) => l.split(/\s+/));
}

// ---- compose files
const composeDir = join(ROOT, 'infra', 'compose');
const files = {};
for (const k of KINDS) {
  const p = join(composeDir, `${k}.yml`);
  if (existsSync(p)) files[k] = p;
}
if (existsSync(composeDir)) {
  for (const f of readdirSync(composeDir)) if (/compose\.override\.ya?ml$/i.test(f)) v('override-file', `infra/compose/${f}`, 'a compose override file must not exist');
}
if (Object.keys(files).length === 0) v('no-files', 'infra/compose', 'no compose files found');
for (const k of KINDS) if (!files[k] && Object.keys(files).length) v('missing-file', `infra/compose/${k}.yml`, 'required compose file is missing');

const renderEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...policy.renderEnv };
// POLY_POSTGRES_IMAGE and POLY_BIND_ADDR have no default anywhere: unset fails the render (fail closed).
for (const k of ['POLY_POSTGRES_IMAGE', 'POLY_BIND_ADDR']) if (process.env[k]) renderEnv[k] = process.env[k];
for (const k of ['DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'XDG_RUNTIME_DIR']) if (process.env[k]) renderEnv[k] = process.env[k];

const BYPASS = { network_mode: 'network-mode', privileged: 'privileged', cap_add: 'cap-add', devices: 'devices', sysctls: 'sysctls', extra_hosts: 'extra-hosts', links: 'links', external_links: 'links', group_add: 'group-add', build: 'no-build', extends: 'bypass' };
const SECRETISH = /(SECRET|PASSWORD|PASSWD|TOKEN|KEY|CREDENTIAL|DSN|DATABASE_URL)/;
const varsIn = (s) => [...String(s).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
const hasVar = (x) => /\$\{|\$[A-Za-z_]/.test(JSON.stringify(x ?? ''));

const rendered = {};
const pending = [];
// The three renders run concurrently; each reports its own violations.
function render(kind, path, rel) {
  return new Promise((done) => {
    const c = spawn('docker', ['compose', '-f', path, '--profile', '*', 'config', '--no-env-resolution', '--format', 'json'], { env: renderEnv });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('error', (e) => {
      if (e.code === 'ENOENT') v('no-docker', rel, '`docker compose` is not available');
      else v('render-error', rel, String(e));
      done();
    });
    c.on('close', (code) => {
      if (code !== 0) { v('render-error', rel, err.trim().split('\n').slice(-2).join(' | ')); return done(); }
      try { rendered[kind] = JSON.parse(out); } catch (e) { v('render-error', rel, `unparsable config output: ${e.message}`); return done(); }
      if (!Object.keys(rendered[kind].services ?? {}).length) v('no-services', rel, 'renders zero services');
      done();
    });
  });
}
// one source: the env_file lists are the installed guard's own policy (infra/deploy/compose-allow.json), so the CI lint and the box guard cannot disagree
let guardPolicy = null;
try { guardPolicy = JSON.parse(read('infra/deploy/compose-allow.json') ?? 'null'); } catch { guardPolicy = null; }
if (guardPolicy == null) v('guard-policy', 'infra/deploy/compose-allow.json', 'missing or unparsable: the lint and the box guard read the env_file list from it');
for (const [kind, path] of Object.entries(files)) {
  const rel = `infra/compose/${kind}.yml`;
  // raw checks run even when the render fails
  let raw;
  try { raw = parse(readFileSync(path, 'utf8'), { merge: true }) ?? {}; } catch (e) { v('render-error', rel, `YAML: ${e.message}`); continue; }
  if (raw.include) v('bypass', rel, 'include is not allowed');
  for (const [sn, s] of Object.entries(raw.services ?? {})) {
    for (const [key, id] of Object.entries(BYPASS)) if (s[key] !== undefined) v(id, rel, `${sn}: ${key} is not allowed`);
    for (const key of ['pid', 'ipc', 'userns_mode']) if (s[key] === 'host') v('host-namespace', rel, `${sn}: ${key}: host`);
    // S27: the whole env_file list, empty included, read from the raw YAML: same length and order, each path the exact string, only `path` and `required: true`
    {
      const want = guardPolicy?.projects?.[kind]?.services?.[sn]?.env_files ?? [];
      const got = s.env_file === undefined ? [] : Array.isArray(s.env_file) ? s.env_file : [s.env_file];
      const same = got.length === want.length && got.every((e, i) => {
        const ent = typeof e === 'string' ? { path: e } : e;
        return ent !== null && typeof ent === 'object' && ent.path === want[i] && ent.required !== false && Object.keys(ent).every((k) => k === 'path' || k === 'required');
      });
      if (!same) v('env-file', rel, `${sn}: env_file`);
    }
    // S20: caddy's environment is exactly the three ${NAME:?} forms and it has no command or entrypoint: {$NAME} is substituted before the Caddyfile is parsed
    if (kind === 'edge' && sn === 'caddy') {
      const env = s.environment;
      const okEnv = env && !Array.isArray(env) && JSON.stringify(Object.keys(env).sort()) === JSON.stringify(['POLY_DOMAIN', 'POLY_STAGING_ALLOW', 'POLY_TLS']) && Object.entries(env).every(([k, val]) => val === `\${${k}:?}`);
      if (!okEnv) v('caddy-env', rel, 'caddy environment must be exactly POLY_DOMAIN, POLY_STAGING_ALLOW and POLY_TLS as ${NAME:?}');
      if (s.command !== undefined || s.entrypoint !== undefined) v('caddy-env', rel, 'caddy must have no command or entrypoint');
    }
    if (typeof s.image === 'string') for (const name of varsIn(s.image)) if (!policy.allowedVars.includes(name)) v('raw-interpolation', rel, `${sn}: image uses \${${name}}`);
    // G15: web's health check asks /api/v1/health and requires exactly 200 (a 404 must not pass)
    if (sn === 'web' && JSON.stringify(s.healthcheck?.test ?? null) !== JSON.stringify(['CMD', 'node', '-e', "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"]))
      v('web-health', rel, 'web healthcheck must fetch /api/v1/health and require 200');
    // G14: every service's `command` and `entrypoint` is the exact value below or absent (the image's own default is `web`, so each app service names its own)
    {
      const want = SERVICE_EXEC[sn] ?? {};
      for (const k of ['command', 'entrypoint'])
        if (JSON.stringify(s[k] ?? null) !== JSON.stringify(want[k] ?? null)) v('app-command', rel, `${sn}: ${k} must be ${JSON.stringify(want[k] ?? null)}`);
    }
    for (const key of ['networks', 'secrets', 'volumes', 'user', 'cap_drop', 'cap_add', 'security_opt', 'healthcheck', 'command', 'tmpfs'])
      if (hasVar(s[key])) v('raw-interpolation', rel, `${sn}: \${…} in ${key}`);
    for (const p of list(s.ports)) {
      const t = typeof p === 'string' ? p : JSON.stringify(p);
      if (/\$/.test(t) && !/^\$\{POLY_BIND_ADDR:\?\}:\d+:\d+$/.test(t)) v('raw-interpolation', rel, `${sn}: ports entry ${t}`);
      else if (!/^\$\{POLY_BIND_ADDR:\?\}:\d+:\d+$/.test(t)) v('ports-bind', rel, `${sn}: ports entry ${t} must be \${POLY_BIND_ADDR:?}:host:container`);
    }
    for (const [ek, ev] of Object.entries(s.environment && !Array.isArray(s.environment) ? s.environment : {}))
      for (const name of varsIn(ev)) if (!policy.allowedVars.includes(name)) v('raw-interpolation', rel, `${sn}: environment ${ek} uses \${${name}}`);
  }
  if (raw.volumes && Object.keys(raw.volumes).length) v('top-level-volumes', rel, 'top-level volumes: are not used');
  for (const key of ['networks', 'secrets', 'configs', 'volumes']) if (hasVar(raw[key])) v('raw-interpolation', rel, `\${…} in top-level ${key}`);

  pending.push(render(kind, path, rel));
}
await Promise.all(pending);

// ---- caddy-allow (POLY-100 A12): the Caddyfile is an allowlist. The seven top-level block heads appear exactly once and every non-comment, non-blank
// trimmed line of a block equals one in the fixed list for that block, with that list's count. A Caddyfile change therefore carries a lint change.
{
  const text = read('infra/caddy/Caddyfile');
  const want = policy.caddyAllow;
  if (text == null) v('caddy-allow', 'infra/caddy/Caddyfile', 'missing');
  else if (!want) v('caddy-allow', 'infra/lint/policy.json', 'caddyAllow is missing');
  else {
    const got = {};
    let cur = null;
    let depth = 0;
    for (const raw of text.split('\n')) {
      const t = raw.trim();
      if (t === '' || t.startsWith('#')) continue;
      if (depth === 0) {
        if (!t.endsWith('{')) { v('caddy-allow', 'infra/caddy/Caddyfile', `a line outside any block: ${t.slice(0, 60)}`); continue; }
        cur = t === '{' ? '{' : t.slice(0, -1).trim();
        if (Object.hasOwn(got, cur)) v('caddy-allow', 'infra/caddy/Caddyfile', `block head repeated: ${cur.slice(0, 60)}`);
        got[cur] ??= [];
        depth = 1;
        continue;
      }
      if (t === '}') { depth -= 1; if (depth === 0) continue; } else if (t.endsWith('{')) depth += 1;
      got[cur].push(t);
    }
    if (depth !== 0) v('caddy-allow', 'infra/caddy/Caddyfile', 'unbalanced braces');
    for (const head of Object.keys(got)) if (!Object.hasOwn(want, head)) v('caddy-allow', 'infra/caddy/Caddyfile', `block head not allowed: ${head.slice(0, 60)}`);
    for (const head of Object.keys(want)) if (!Object.hasOwn(got, head)) v('caddy-allow', 'infra/caddy/Caddyfile', `block head missing: ${head.slice(0, 60)}`);
    for (const head of Object.keys(got)) {
      if (!Object.hasOwn(want, head)) continue;
      // S20: an ordered sequence, braces included; the first difference is reported
      const a = got[head];
      const b = want[head];
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) { v('caddy-allow', 'infra/caddy/Caddyfile', `${head.slice(0, 30)}: line ${i + 1} of the block is ${a[i] === undefined ? 'missing' : `not the allowed one: ${a[i].slice(0, 70)}`}`); break; }
      }
    }
  }
}

// ---- pg_hba
// R12(a) (POLY-100): the migrate preflight sweeps only the current database for poly_backup and relies on these four lines; a PR that widens
// pg_hba.prod.conf must widen that sweep in the same PR.
const hbaProd = read('infra/postgres/pg_hba.prod.conf');
const hbaStaging = read('infra/postgres/pg_hba.staging.conf');
const backupCidrs = [];
if (hbaProd == null) v('pg-hba-prod', 'infra/postgres/pg_hba.prod.conf', 'missing');
else {
  const rules = hbaRules(hbaProd);
  const [r1, r2, r3, r4] = rules;
  const ok = r1 && r2 && r3 && r4
    && r1.join(' ').startsWith('host replication poly_backup') && r2.join(' ').startsWith('host polycarpic poly_backup')
    && r1[3] === r2[3] && r1[4] === 'scram-sha-256' && r2[4] === 'scram-sha-256'
    && r3.join(' ') === 'host all poly_backup all reject' && r4.join(' ') === 'host replication all all reject';
  if (!ok) v('pg-hba-prod', 'infra/postgres/pg_hba.prod.conf', "the four C-79 lines must come first, in order; R12(a)'s preflight sweeps only this database and relies on it");
  for (const r of rules) if (r[2] === 'poly_backup' && r[4] !== 'reject') backupCidrs.push(r[3]);
}
if (hbaStaging == null) v('pg-hba-staging', 'infra/postgres/pg_hba.staging.conf', 'missing');
else for (const r of hbaRules(hbaStaging)) {
  if ((r[2] === 'poly_backup' || r[1] === 'replication') && r[4] !== 'reject') v('pg-hba-staging', 'infra/postgres/pg_hba.staging.conf', `allow line for ${r[2]}/${r[1]}`);
}
const allowCidrs = [hbaProd, hbaStaging].flatMap((t) => (t ? hbaRules(t) : []).filter((r) => r[4] && r[4] !== 'reject' && /\//.test(r[3] ?? '')).map((r) => r[3]));

// ---- rendered rules
for (const [kind, cfg] of Object.entries(rendered)) {
  const rel = `infra/compose/${kind}.yml`;
  const nets = cfg.networks ?? {};
  const netName = (key) => nets[key]?.name ?? `${cfg.name}_${key}`;
  const matrix = policy.secretMatrix[kind] ?? {};
  const svcs = cfg.services ?? {};
  for (const [sn, s] of Object.entries(svcs)) {
    const at = `${sn}`;
    if (!/^[1-9]\d*:[1-9]\d*$/.test(String(s.user ?? ''))) v('user-nonroot', rel, `${at}: user must be an explicit non-root uid:gid (got ${s.user ?? 'none'})`);
    if (s.read_only !== true) v('read-only', rel, `${at}: read_only: true required`);
    if (!list(s.cap_drop).map((c) => String(c).toUpperCase()).includes('ALL')) v('cap-drop', rel, `${at}: cap_drop: [ALL] required`);
    if (!list(s.security_opt).some((o) => /^no-new-privileges[:=]true$/.test(o))) v('no-new-privs', rel, `${at}: no-new-privileges:true required`);
    if (!s.restart) v('restart', rel, `${at}: restart policy required`);
    if (!s.healthcheck || s.healthcheck.disable || !list(s.healthcheck.test).length) v('healthcheck', rel, `${at}: healthcheck required`);
    if (!/@sha256:[0-9a-f]{64}$/.test(String(s.image ?? ''))) v('image-digest', rel, `${at}: image must end @sha256:<64 hex> (got ${s.image})`);
    if (s.build) v('no-build', rel, `${at}: build: not allowed`);
    if (s.network_mode) v('network-mode', rel, `${at}: network_mode`);
    for (const key of ['pid', 'ipc', 'userns_mode']) if (s[key] === 'host') v('host-namespace', rel, `${at}: ${key}: host`);
    if (s.privileged) v('privileged', rel, `${at}: privileged`);
    if (list(s.cap_add).length) v('cap-add', rel, `${at}: cap_add`);
    if (list(s.devices).length) v('devices', rel, `${at}: devices`);
    if (list(s.security_opt).some((o) => /unconfined/.test(o))) v('unconfined', rel, `${at}: unconfined security_opt`);
    if (s.sysctls && Object.keys(s.sysctls).length) v('sysctls', rel, `${at}: sysctls`);
    for (const [ek, ev] of Object.entries(s.environment ?? {})) {
      const fileOk = ek.endsWith('_FILE') && String(ev ?? '').startsWith('/run/secrets/');
      if ((SECRETISH.test(ek.toUpperCase()) || ek.endsWith('_FILE')) && !fileOk) v('env-secret', rel, `${at}: environment ${ek} must be a *_FILE pointing under /run/secrets/`);
    }
    // POLY-99 C2: no core file holds plaintext (the root disk is not LUKS): ulimits core 0 on every prod and staging service
    if (kind !== 'edge') {
      const core = s.ulimits?.core;
      const coreOk = core !== undefined && (typeof core === 'object' ? Number(core.soft ?? 0) === 0 && Number(core.hard ?? 0) === 0 : Number(core) === 0);
      if (!coreOk) v('core-dump', rel, `${at}: ulimits core must be 0`);
    }
    // POLY-99 C1: backup and uploader have a /tmp tmpfs of at most 1 MiB (it holds a passfile or a rclone config, never a dump)
    if (kind === 'prod' && (sn === 'backup' || sn === 'uploader')) {
      const entry = list(s.tmpfs).find((x) => String(x).split(':')[0] === '/tmp');
      const m = /(?:^|[:,])size=(\d+)([kmg]?)$/i.exec(String(entry ?? '').split(':').slice(1).join(':'));
      const size = m ? Number(m[1]) * ({ '': 1, k: 1024, m: 1048576, g: 1073741824 }[m[2].toLowerCase()]) : 0;
      if (!entry || !(size > 0 && size <= 1048576)) v('tmp-size', rel, `${at}: /tmp must be a tmpfs of at most 1 MiB`);
    }
    // POLY-99 C10: root's record files live under /var/lib/polycarpic/state; no service mounts it or a parent of it
    for (const vol of s.volumes ?? []) {
      const src = String(vol.source ?? '').replace(/\/+$/, '');
      if (vol.type === 'bind' && (src === '/var' || src === '/var/lib' || src === '/var/lib/polycarpic' || src.startsWith('/var/lib/polycarpic/state'))) v('state-mount', rel, `${at}: mounts ${src}: root's records are mounted by no service`);
    }
    // POLY-99 C3: the uploader reads the spool and changes nothing
    if (kind === 'prod' && sn === 'uploader') {
      const spoolMounts = (s.volumes ?? []).filter((x) => x.type === 'bind' && String(x.source ?? '').startsWith('/srv/polycarpic/spool'));
      if (!spoolMounts.length) v('uploader-spool-ro', rel, `${at}: the spool must be mounted (read-only)`);
      for (const x of spoolMounts) if (!x.read_only) v('uploader-spool-ro', rel, `${at}: ${x.source} must be mounted read-only`);
    }
    if (s.ports?.length && sn !== 'caddy') v('ports-caddy-only', rel, `${at}: ports: only caddy publishes a port`);
    // mounts
    for (const vol of s.volumes ?? []) {
      const src = vol.source ?? '';
      const base = src.split('/').pop();
      if (vol.type !== 'bind' && vol.type !== 'tmpfs') v('volume-type', rel, `${at}: volume ${src || vol.target} has type ${vol.type}; only bind and tmpfs`);
      if (vol.type === 'bind' && /docker\.sock|containerd\.sock/.test(base)) v('docker-sock', rel, `${at}: mounts ${src}`);
      if (vol.type === 'bind' && (src === '/' || src === '/var/run' || src === '/run' || src.startsWith('/var/run/') || src.startsWith('/run/'))) v('mount-forbidden', rel, `${at}: mounts ${src}`);
      if (HOST_SECRETS.test(src)) v('host-secrets', rel, `${at}: mounts ${src}: secrets/host/ holds what root reads and no service mounts`);
      if (vol.type === 'bind') {
        const norm = src.startsWith(ROOT + sep) ? relative(resolve(composeDir), src) : src;
        const hit = (policy.binds[`${kind}.${sn}`] ?? []).find((b) => b.source === norm && b.target === vol.target);
        if (!hit) v('mount-allowlist', rel, `${at}: bind ${norm}:${vol.target} is not in the allowlist`);
        else if (!hit.rw && !vol.read_only) v('mount-allowlist', rel, `${at}: bind ${norm}:${vol.target} must be :ro`);
      }
    }
    // secrets: one top-level secret per (service, name), sourced from the service's own directory (ruling A1)
    const allowed = matrix[sn] ?? [];
    const seenTargets = new Set();
    for (const sec of s.secrets ?? []) {
      const key = typeof sec === 'string' ? sec : sec.source;
      const target = (typeof sec === 'string' ? sec : sec.target) ?? key;
      if (!allowed.includes(target)) v('secret-matrix', rel, `${at}: secret ${target} is not allowed for this service (${kind})`);
      if (seenTargets.has(target)) v('secret-matrix', rel, `${at}: secret ${target} mounted twice`);
      seenTargets.add(target);
      const file = cfg.secrets?.[key]?.file ?? '';
      const want = `${policy.secretPrefix[kind]}${sn}/${target}`;
      if (file !== want) v('secret-path', rel, `${at}: secret ${target} must come from ${want} (got ${file || 'none'})`);
    }
    // the operator password is mounted only by the one-shot operator service (POLY-146)
    if (list(s.secrets).some((q) => (typeof q === 'string' ? q : q.target ?? q.source) === 'db_password_operator')) {
      const profiles = list(s.profiles);
      if (sn !== 'operator' || s.restart !== 'no' || profiles.length !== 1 || profiles[0] !== 'operator' || s.logging?.driver !== 'none') v('operator-one-shot', rel, `${at}: db_password_operator belongs to a service named operator with restart "no", profiles [operator] and logging driver none (its stdout carries the invitation link)`);
    }
    // networks
    const sNets = Object.keys(s.networks ?? {});
    const names = sNets.map(netName);
    if (s.group_add?.length) v('group-add', rel, `${at}: group_add`);
    const projects = new Set(names.map(projectOf).filter(Boolean));
    if (kind === 'edge') {
      if (sn === 'caddy') for (const n of names) if (!EDGE_NET.test(n)) v('edge-network', rel, `caddy joins ${n}; only the edge networks`);
    } else {
      if (projects.size > 1 || [...projects].some((p) => p !== kind)) v('cross-project', rel, `${at}: on networks of another project (${names.join(', ')})`);
      for (const n of names) if (EDGE_NET.test(n) && sn !== 'web' && sn !== 'auth') v('edge-network', rel, `${at}: only web and auth join ${n}`);
      // edge-alias (POLY-138 F11): Caddy sits on both edge networks, so what answers to <kind>-web there is a name this file
      // controls. Exactly one alias, the ruled one; container_name and the link keys each register another name.
      for (const key of sNets) {
        if (!EDGE_NET.test(netName(key)) || (sn !== 'web' && sn !== 'auth')) continue;
        const aliases = list(s.networks[key]?.aliases);
        if (aliases.length !== 1 || aliases[0] !== `${kind}-${sn}`) v('edge-alias', rel, `${at}: aliases on ${netName(key)} must be exactly [${kind}-${sn}] (got [${aliases.join(', ')}])`);
        for (const k of ['container_name', 'links', 'external_links']) {
          if (Array.isArray(s[k]) ? s[k].length : s[k]) v('edge-alias', rel, `${at}: ${k} registers a name on the edge network and is not allowed`);
        }
      }
    }
  }
  {
    const ids = Object.entries(svcs).map(([n, x]) => [n, ...String(x.user ?? '').split(':')]);
    for (const i of [1, 2]) {
      const seen = new Map();
      for (const r of ids) { if (seen.has(r[i])) v('user-distinct', rel, `${r[0]} and ${seen.get(r[i])} share ${i === 1 ? 'uid' : 'gid'} ${r[i]}`); else seen.set(r[i], r[0]); }
    }
  }
  for (const [key, sec] of Object.entries(cfg.secrets ?? {})) {
    if (sec.environment || sec.content) v('secret-source', rel, `secret ${key}: only file: sources`);
    const f = sec.file ?? '';
    if (HOST_SECRETS.test(f)) v('host-secrets', rel, `secret ${key}: file ${f} is under secrets/host/, which no service mounts`);
    const pre = policy.secretPrefix[kind];
    if (!f.startsWith(pre) || f.includes('..')) v('secret-path', rel, `secret ${key}: file ${f} must be under ${pre}`);
    if (!Object.values(svcs).some((x) => (x.secrets ?? []).some((q) => (typeof q === 'string' ? q : q.source) === key))) v('secret-path', rel, `secret ${key} is mounted by no service`);
  }
  if (Object.keys(cfg.volumes ?? {}).length) v('top-level-volumes', rel, 'top-level volumes: are not used');
  for (const [key, c] of Object.entries(cfg.configs ?? {})) if (c.content) v('config-inline', rel, `config ${key}: inline content`);

  if (kind === 'prod' || kind === 'staging') {
    // T-net: a project file only declares its own edge network, external, by its exact name, with no ipam; it never creates one
    const key = `edge-${kind}`;
    const n = nets[key];
    if (n && (n.name !== `polycarpic-${key}` || n.external !== true || (n.ipam && (n.ipam.config ?? []).length))) v('edge-overlap', rel, `network ${key} must be external, named polycarpic-${key}, with no ipam`);
    for (const k of Object.keys(nets)) if (/^edge/.test(k) && k !== key) v('edge-overlap', rel, `unexpected edge network ${k} in ${kind}.yml`);
  }
  if (kind === 'edge') {
    // T-net: both edge networks are external, by their fixed names, with no ipam; provision.sh creates them with the fixed subnets below,
    // and those subnets must stay outside every pg_hba allow range and the 10.200.0.0/16 pool (S24).
    const FIXED = { 'edge-prod': ['polycarpic-edge-prod', '10.201.30.0/28'], 'edge-staging': ['polycarpic-edge-staging', '10.202.30.0/28'] };
    for (const [key, [name, sub]] of Object.entries(FIXED)) {
      const n = nets[key];
      if (!n || n.name !== name || n.external !== true || (n.ipam && (n.ipam.config ?? []).length)) v('edge-overlap', rel, `network ${key} must be external, named ${name}, with no ipam`);
      for (const a of [...allowCidrs, '10.200.0.0/16']) if (overlap(sub, a)) v('edge-overlap', rel, `network ${key} ${sub} overlaps ${a}`);
    }
    for (const key of Object.keys(nets)) if (!FIXED[key]) v('edge-overlap', rel, `unexpected network ${key} in the edge project`);
    const caddy = svcs.caddy;
    if (caddy) for (const other of Object.keys(svcs)) if (other !== 'caddy') v('edge-network', rel, `unexpected service ${other} in the edge project`);
  }
  if (kind === 'prod') {
    const bn = nets['backup-net'];
    if (!bn?.internal) v('backup-net-internal', rel, 'backup-net must be internal: true');
    const subs = (bn?.ipam?.config ?? []).map((c) => c.subnet).filter(Boolean);
    if (subs.length !== 1) v('backup-net-subnet', rel, 'backup-net needs exactly one fixed subnet');
    else if (backupCidrs.length === 0 || backupCidrs.some((c) => c !== subs[0])) v('backup-net-subnet', rel, `backup-net subnet ${subs[0]} differs from the poly_backup lines of pg_hba.prod.conf (${backupCidrs.join(', ') || 'none'})`);
    const members = Object.entries(svcs).filter(([, s]) => 'backup-net' in (s.networks ?? {})).map(([n]) => n).sort();
    if (members.join() !== 'backup,postgres') v('backup-net-members', rel, `backup-net members must be backup and postgres (got ${members.join(', ')})`);
    if (svcs.backup && Object.keys(svcs.backup.networks ?? {}).join() !== 'backup-net') v('backup-net-members', rel, 'backup must be on backup-net only');
    if (svcs.uploader && svcs.postgres) {
      const pn = new Set(Object.keys(svcs.postgres.networks ?? {}).map(netName));
      for (const n of Object.keys(svcs.uploader.networks ?? {}).map(netName)) if (pn.has(n)) v('uploader-isolation', rel, `uploader shares ${n} with postgres`);
    }
  }
  // postgres command: exactly one -c, the config_file
  if (svcs.postgres) {
    const cmd = typeof svcs.postgres.command === 'string' ? svcs.postgres.command.split(/\s+/) : list(svcs.postgres.command);
    const cs = cmd.map((t, i) => (t === '-c' ? cmd[i + 1] : /^-c./.test(t) ? t.slice(2) : null)).filter((x) => x != null);
    if (cs.length !== 1 || !String(cs[0]).startsWith('config_file=')) v('extra-c-flag', rel, 'postgres command takes exactly one -c config_file=…');
    if (kind === 'staging') {
      const conf = read('infra/postgres/postgresql.staging.conf');
      if (conf == null || !/^\s*archive_mode\s*=\s*off\b/m.test(conf) || /^\s*archive_mode\s*=\s*(on|always)\b/m.test(conf)) v('staging-archive-mode', 'infra/postgres/postgresql.staging.conf', 'archive_mode must be off');
    }
  }
}

// ---- R4: one place for the Postgres tag and digest
const dockerfile = read('infra/postgres/Dockerfile');
const majorFile = read('infra/postgres-major');
if (dockerfile == null) v('from-digest', 'infra/postgres/Dockerfile', 'missing');
else {
  const from = dockerfile.split('\n').find((l) => /^FROM\s/.test(l)) ?? '';
  if (!/^FROM postgres:\d+\.\d+@sha256:[0-9a-f]{64}$/.test(from)) v('from-digest', 'infra/postgres/Dockerfile', `FROM line must be postgres:N.M@sha256:<64 hex> (got "${from}")`);
  const fromMajor = /^FROM postgres:(\d+)/.exec(from)?.[1];
  if (majorFile == null || !/^\d+\n?$/.test(majorFile)) v('major-drift', 'infra/postgres-major', 'must be a bare major version');
  else if (fromMajor !== majorFile.trim()) v('major-drift', 'infra/postgres-major', `FROM major ${fromMajor} differs from infra/postgres-major ${majorFile.trim()}`);
}
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); }
  return out;
}
const scan = [...walk(composeDir), ...walk(join(ROOT, '.github', 'workflows')), ...walk(join(ROOT, 'tests', 'db', 'docker'))];
for (const p of scan) if (/\bpostgres:\d/.test(readFileSync(p, 'utf8'))) v('postgres-tag-literal', relative(ROOT, p), 'a postgres:<version> tag outside infra/postgres/Dockerfile');
{
  const imgs = [];
  for (const [kind, sn] of [['prod', 'postgres'], ['prod', 'backup'], ['staging', 'postgres']]) {
    if (!files[kind]) continue;
    let raw; try { raw = parse(readFileSync(files[kind], 'utf8'), { merge: true }); } catch { continue; }
    imgs.push([kind, sn, raw?.services?.[sn]?.image]);
  }
  for (const [kind, sn, img] of imgs) if (img !== '${POLY_POSTGRES_IMAGE:?}') v('image-var-same', `infra/compose/${kind}.yml`, `${sn}: image must be \${POLY_POSTGRES_IMAGE:?}`);
}

// ---- R1: Caddyfile
const caddy = read('infra/caddy/Caddyfile');
if (caddy == null) v('caddy-headers', 'infra/caddy/Caddyfile', 'missing');
else {
  if (/content-security-policy/i.test(caddy)) v('caddy-csp', 'infra/caddy/Caddyfile', 'Caddy sets or strips no Content-Security-Policy');
  if (/trusted_proxies/.test(caddy)) v('caddy-headers', 'infra/caddy/Caddyfile', 'no trusted_proxies');
  const blocks = [];
  let depth = 0, cur = null;
  for (const line of caddy.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    if (depth === 0 && t.endsWith('{')) { cur = { head: t.slice(0, -1).trim(), body: [], depths: [] }; blocks.push(cur); depth = 1; continue; }
    if (depth > 0) {
      let d = depth;
      if (t.endsWith('{')) depth++;
      else if (t === '}') { depth--; d = depth; if (depth === 0) { cur = null; continue; } }
      cur.body.push(t);
      cur.depths.push(d); // 1 = a direct child of the block; an opener and its closer share a depth
    }
  }
  const snippet = blocks.find((b) => b.head === '(security_headers)');
  const need = ['defer', 'Strict-Transport-Security "max-age=31536000"', 'X-Content-Type-Options "nosniff"', 'X-Frame-Options "DENY"', 'Referrer-Policy "strict-origin-when-cross-origin"'];
  if (!snippet) v('caddy-headers', 'infra/caddy/Caddyfile', 'snippet (security_headers) missing');
  else for (const n of need) if (!snippet.body.includes(n)) v('caddy-headers', 'infra/caddy/Caddyfile', `snippet lacks: ${n}`);
  for (const b of blocks) {
    if (b.head === '' || b.head === '(security_headers)' || b.head === '(upstream)' || b.head === '(no_store)') continue; // these snippets import no headers, by design
    // a direct child: the import inside handle_errors covers only the error responses
    if (!b.body.some((t, i) => t === 'import security_headers' && b.depths[i] === 1)) v('caddy-headers', 'infra/caddy/Caddyfile', `site block "${b.head}" does not import security_headers`);
  }

  // ---- POLY-138 R5: upstream names, the client-address snippet, the Service-Worker refusal, the log filter
  const CF = 'infra/caddy/Caddyfile';
  const sites = blocks.filter((b) => b.head !== '' && !b.head.startsWith('('));
  const kindOf = (b) => (b.head.startsWith('http://') ? 'http' : b.head.startsWith('app.') ? 'prod' : b.head.startsWith('staging.') ? 'staging' : null);

  // caddy-upstream: each site proxies only its own kind's web and auth
  for (const b of sites) {
    const kind = kindOf(b);
    const ok = kind === 'prod' || kind === 'staging' ? [`${kind}-web:3000`, `${kind}-auth:3000`] : [];
    for (const t of b.body) {
      if (!/^reverse_proxy(\s|$)/.test(t)) continue;
      const target = t.replace(/\{$/, '').trim().split(/\s+/).filter((w) => !w.startsWith('@')).pop();
      if (!ok.includes(target)) v('caddy-upstream', CF, `site block "${b.head}" proxies ${target === 'reverse_proxy' ? 'nothing named' : target}; allowed: ${ok.join(', ') || 'none'}`);
    }
  }

  // caddy-xff: one snippet, exactly four lines, imported as the first line inside every reverse_proxy block
  const up = blocks.find((b) => b.head === '(upstream)');
  const UP_LINES = ['header_up X-Forwarded-For {remote_host}', 'header_up -X-Real-IP', 'header_up -Forwarded', 'lb_try_duration 10s'];
  if (!up) v('caddy-xff', CF, 'snippet (upstream) missing');
  else if (up.body.join('\n') !== UP_LINES.join('\n')) v('caddy-xff', CF, `snippet (upstream) must hold exactly: ${UP_LINES.join('; ')}`);
  for (const b of sites) {
    b.body.forEach((t, i) => {
      if (!/^reverse_proxy(\s|$)/.test(t)) return;
      if (!t.endsWith('{') || b.body[i + 1] !== 'import upstream') v('caddy-xff', CF, `site block "${b.head}": "${t}" must open a block whose first line is "import upstream"`);
    });
  }

  // caddy-sw: the refusal sits in each HTTPS site's route, first among the matchers' consumers
  for (const b of sites) {
    if (kindOf(b) === 'http') continue;
    const at = b.body.findIndex((t, i) => t === 'route {' && b.depths[i] === 1);
    if (at < 0) { v('caddy-sw', CF, `site block "${b.head}" has no route block`); continue; }
    const route = [];
    for (let i = at + 1; i < b.body.length && b.depths[i] > 1; i++) if (b.depths[i] === 2) route.push(b.body[i]);
    const m = route.indexOf('@sw header Service-Worker *');
    if (m < 0 || route[m + 1] !== 'respond @sw 403') { v('caddy-sw', CF, `site block "${b.head}": route must hold "@sw header Service-Worker *" followed by "respond @sw 403"`); continue; }
    const first = route.findIndex((t) => /^(basic_auth|reverse_proxy)(\s|$)/.test(t));
    if (first >= 0 && first < m) v('caddy-sw', CF, `site block "${b.head}": the Service-Worker refusal must come before basic_auth and every reverse_proxy`);
  }

  // caddy-cache (R10): a browser keeps nothing from a page the upstream controls, except the content-hashed files
  const ns = blocks.find((b) => b.head === '(no_store)');
  const NS_LINES = ['@mutable not path /_app/immutable/*', 'header @mutable {', 'defer', 'Cache-Control "no-store"', '}'];
  if (!ns) v('caddy-cache', CF, 'snippet (no_store) missing');
  else if (ns.body.join('\n') !== NS_LINES.join('\n')) v('caddy-cache', CF, `snippet (no_store) must hold exactly: ${NS_LINES.join('; ')}`);
  for (const b of sites) {
    const at = b.body.map((t, i) => [t, b.depths[i]]).filter(([t]) => t === 'import no_store').map(([, d]) => d);
    if (kindOf(b) === 'http') { if (at.length) v('caddy-cache', CF, `site block "${b.head}" imports no_store; the redirect block serves no page`); continue; }
    if (at.length !== 1 || at[0] !== 1) v('caddy-cache', CF, `site block "${b.head}" must import no_store exactly once, directly in the site block (not in handle_errors)`);
  }

  // caddy-log: the filtered default logger in the global block; no site logger, no debug, no log_credentials
  const global = blocks.find((b) => b.head === '');
  const LOG_LINES = ['log {', 'output stderr', 'format filter {', 'request>uri regexp "^(/api/auth/[^/?#]*)[^?#]*|[?#].*" "${1}"', 'request>headers>Referer delete'];
  if (!global) v('caddy-log', CF, 'global options block missing');
  else {
    const g = global.body.join('\n');
    if (!g.includes(LOG_LINES.join('\n'))) v('caddy-log', CF, `global block must hold the filtered log block: ${LOG_LINES.join('; ')}`);
    if (global.body.some((t) => /^debug(\s|$)/.test(t))) v('caddy-log', CF, 'no global debug option (it logs every upstream round trip)');
  }
  for (const b of sites) if (b.body.some((t) => /^log(\s|$)/.test(t))) v('caddy-log', CF, `site block "${b.head}" has a log directive; a site logger bypasses the filter`);
  if (blocks.some((b) => b.body.some((t) => /^log_credentials(\s|$)/.test(t)))) v('caddy-log', CF, 'log_credentials appears nowhere');
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('compose-policy: clean');
