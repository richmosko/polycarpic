// Shared harness for the POLY-76 checks. Zero npm dependencies: catalog queries go through
// `docker exec psql` against a throwaway Postgres container; only check-b-prime and check-f
// load code from the spike (auth.mjs, routing-pool.mjs) and the spike's own `pg`.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SPIKE = path.resolve(HERE, '..');
export const CFG = {
  image: process.env.POLY76_PG_IMAGE ?? 'postgres:17',
  container: process.env.POLY76_PG_CONTAINER ?? 'poly76-checks-pg',
  port: Number(process.env.POLY76_PG_PORT ?? 55476),
  db: 'poly76_check',
  tracking: process.env.POLY76_TRACKING_TABLE ?? 'drizzle.__drizzle_migrations',
};
export const url = (role) =>
  `postgres://${role}:qa-${role}@127.0.0.1:${CFG.port}/${CFG.db}`;
const SEP = '\u001f';

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 300_000, ...opts });
  return { code: r.status ?? (r.error ? 127 : 1), out: r.stdout ?? '', err: (r.stderr ?? '') + (r.error ? String(r.error) : '') };
}

// Run SQL as the container superuser. Returns {ok, rows, sqlstate, err}.
export function psql(sql, { db = CFG.db } = {}) {
  const r = run('docker', ['exec', '-i', CFG.container, 'psql', '-X', '-q', '-At', '-F', SEP,
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', db, '-f', '-'], { input: sql });
  const m = /ERROR:\s+([0-9A-Z]{5}):/.exec(r.err);
  return {
    ok: r.code === 0,
    rows: r.out.split('\n').filter((l) => l.length).map((l) => l.split(SEP)),
    sqlstate: m?.[1] ?? null,
    err: r.err.trim(),
  };
}
export const q = (sql) => psql(sql);

export function ensureContainer() {
  const ins = run('docker', ['inspect', '-f', '{{.State.Running}}', CFG.container]);
  if (ins.code !== 0 || ins.out.trim() !== 'true') {
    run('docker', ['rm', '-f', CFG.container]);
    const r = run('docker', ['run', '-d', '--name', CFG.container, '-e', 'POSTGRES_PASSWORD=qa-postgres',
      '-p', `127.0.0.1:${CFG.port}:5432`, CFG.image]);
    if (r.code !== 0) throw new Error(`cannot start ${CFG.image}: ${r.err.trim()}`);
  }
  for (let i = 0, ok = 0; i < 90; i++) { // initdb restarts the server once; need TCP up twice running
    const r = run('docker', ['exec', CFG.container, 'psql', '-X', '-At', '-h', '127.0.0.1', '-U', 'postgres', '-c', 'select 1']);
    ok = r.code === 0 ? ok + 1 : 0;
    if (ok >= 2) return;
    run('sleep', ['1']);
  }
  throw new Error('postgres container did not become ready');
}

const ROLES = ['poly_owner', 'poly_authz', 'poly_purge', 'poly_govern', 'poly_migrator', 'poly_app'];
export function resetDb() {
  const admin = (sql) => { const r = psql(sql, { db: 'postgres' }); if (!r.ok) throw new Error(r.err); return r; };
  admin(`DROP DATABASE IF EXISTS ${CFG.db} WITH (FORCE);`);
  for (const r of ROLES) admin(`DROP ROLE IF EXISTS ${r};`);
  admin(`
    CREATE ROLE poly_owner    NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE poly_authz    NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE poly_purge    NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE poly_govern   NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE poly_migrator LOGIN PASSWORD 'qa-poly_migrator' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
    CREATE ROLE poly_app      LOGIN PASSWORD 'qa-poly_app'      NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
    GRANT poly_owner, poly_authz, poly_purge, poly_govern TO poly_migrator WITH INHERIT TRUE, SET TRUE;
    CREATE DATABASE ${CFG.db} OWNER poly_owner;`);
  const r = psql(`
    GRANT CREATE ON DATABASE ${CFG.db} TO poly_migrator;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT CREATE ON SCHEMA public TO poly_authz, poly_purge, poly_govern, poly_migrator;
    CREATE SCHEMA qa_harness;
    CREATE TABLE qa_harness.ddl_log (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT clock_timestamp(),
      login text NOT NULL, tag text, object_type text, identity text);
    CREATE FUNCTION qa_harness.log_ddl() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $f$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
        INSERT INTO qa_harness.ddl_log(login, tag, object_type, identity) VALUES (session_user, r.command_tag, r.object_type, r.object_identity);
      END LOOP;
    END $f$;
    CREATE EVENT TRIGGER qa_log_ddl ON ddl_command_end EXECUTE FUNCTION qa_harness.log_ddl();`);
  if (!r.ok) throw new Error(r.err);
}

export function treeHash(dir) {
  if (!fs.existsSync(dir)) return 'absent';
  const h = createHash('sha256');
  const walk = (d) => fs.readdirSync(d).sort().forEach((n) => {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else h.update(path.relative(dir, p) + '\0').update(fs.readFileSync(p)).update('\0');
  });
  walk(dir);
  return h.digest('hex').slice(0, 12);
}
export const MIG_DIR = path.join(SPIKE, 'drizzle');

export function spikeCmd(name, env = {}) {
  const exe = path.join(SPIKE, 'bin', name);
  if (!fs.existsSync(exe)) return { code: 127, out: '', err: `spikes/poly-76/bin/${name} does not exist`, missing: true };
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DATABASE|PG|POSTGRES)/i.test(k)));
  return run(exe, [], { cwd: SPIKE, env: { ...base, ...env } });
}
const tail = (s) => s.trim().split('\n').slice(-4).join(' | ').slice(0, 400);

// The shared flow: fresh DB -> generate -> migrate (as poly_migrator only) -> generate again.
// Memoised per POLY76_RUN_ID so run.mjs does it once; a standalone check does it itself.
export function pipeline() {
  const id = process.env.POLY76_RUN_ID ?? `solo-${randomBytes(3).toString('hex')}`;
  const file = path.join(HERE, '.state', `${id}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  ensureContainer();
  resetDb();
  const s = { id };
  const g1 = spikeCmd('generate'); s.gen1 = { code: g1.code, msg: tail(g1.err || g1.out) }; s.h1 = treeHash(MIG_DIR);
  s.tMigrate = q('select clock_timestamp()').rows[0][0];
  const m = spikeCmd('migrate', { DATABASE_URL: url('poly_migrator') }); s.mig = { code: m.code, msg: tail(m.err || m.out) };
  const g2 = spikeCmd('generate'); s.gen2 = { code: g2.code, msg: tail(g2.err || g2.out) }; s.h2 = treeHash(MIG_DIR);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s));
  return s;
}

export class Checker {
  constructor(id, title, { info = false } = {}) { this.id = id; this.title = title; this.fails = []; this.notes = []; this.info = info; }
  ok(cond, reason) { if (!cond) this.fails.push(reason); return !!cond; }
  note(t) { this.notes.push(t); }
  // Precondition: abort with the reason if it does not hold.
  need(cond, reason) { if (!cond) { this.fails.push(reason); this.done(); } }
  done(unmeasured = false) {
    for (const n of this.notes) console.log(`  note: ${n}`);
    if (this.info && !this.fails.length && !unmeasured) { console.log(`REPORT (${this.id}) ${this.title}`); process.exit(0); }
    if (!this.fails.length) { console.log(`PASS (${this.id}) ${this.title}`); process.exit(0); }
    console.log(`${this.info ? 'UNMEASURED' : 'FAIL'} (${this.id}) ${this.title}`);
    for (const f of this.fails) console.log(`  - ${f}`);
    process.exit(this.info ? 2 : 1);
  }
}

// Precondition shared by (a)(b)(c)(e): the chain generated and applied.
export function needChain(t, { needGen2 = false } = {}) {
  let s;
  try { s = pipeline(); } catch (e) { t.need(false, `harness could not prepare Postgres (${CFG.image}) via Docker: ${e.message}`); }
  t.need(s.gen1.code === 0, `bin/generate failed (exit ${s.gen1.code}): ${s.gen1.msg}`);
  t.need(s.mig.code === 0, `bin/migrate as poly_migrator failed (exit ${s.mig.code}): ${s.mig.msg}`);
  if (needGen2) t.need(s.gen2.code === 0, `second bin/generate failed (exit ${s.gen2.code}): ${s.gen2.msg}`);
  return s;
}

export const owner = (rel) => q(`select pg_get_userbyid(relowner) from pg_class where oid = to_regclass('${rel}')`).rows[0]?.[0] ?? null;
export const spikeRequire = () => createRequire(path.join(SPIKE, 'package.json'));
export const spikeImport = (f) => import(pathToFileURL(path.join(SPIKE, f)).href);
