// POLY-162 G13 (ruling.md, section G): `provision --stage database` creates the database `polycarpic` from template0 when it is missing.
// Real Postgres (the infra/postgres derivative the image job builds), the fake box for the script, and NO database made by the helper: the clusters here
// start without POSTGRES_DB, as the real compose's does. A run that finds the database already there changes nothing; a failed read creates nothing.
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HOST, ROOT, build, makeHost, run, sh } from '../provision/box.ts';
import { STAGE as STAGE_AT, asSuper, namesFor, startPg, superPassword, waitPg } from '../provision/pg.ts';

const NET = `poly162g13net${process.pid}`;
const PGIMG = 'poly97-pg:test';
const names = namesFor('g13');
const STAGE = (host: string) => STAGE_AT(host, 'prod');

let setupError: string | null = null;
beforeAll(() => {
  try {
    build();
    const h = makeHost();
    if (h.code !== 0) throw new Error(`host stage failed on the fake box:\n${h.all.slice(-1200)}`);
    const superPw = superPassword();
    const b = sh('docker', ['build', '-q', '-t', PGIMG, join(ROOT, 'infra', 'postgres')]);
    if (b.code !== 0) throw new Error(`docker build infra/postgres: ${b.err.slice(-400)}`);
    sh('docker', ['network', 'create', NET]);
    for (const n of [names.good, names.bad, names.fail, names.stg]) startPg(n, NET, PGIMG, superPw, [], false);
    for (const n of [names.good, names.bad, names.fail, names.stg]) waitPg(n, 'postgres');
  } catch (e) { setupError = String((e as Error).message); }
}, 900_000);
beforeEach(() => { if (setupError) throw new Error(setupError); });
afterAll(() => {
  for (const n of [names.good, names.bad, names.fail, names.stg]) sh('docker', ['rm', '-f', n]);
  sh('docker', ['network', 'rm', NET]);
});

/** One statement as the superuser over TCP on database `db`; the answer (psql -tA) and whether psql succeeded. */
const q = (host: string, sql: string, db = 'postgres') => {
  const r = run(asSuper(`psql -X -h ${host} -U postgres -d ${db} -v ON_ERROR_STOP=1 -tAc "${sql.replace(/"/g, '\\"')}" 2>&1; echo "rc=$?"`), { image: HOST, network: NET });
  const m = /rc=(\d+)\s*$/.exec(r.out);
  return { out: r.out.replace(/rc=\d+\s*$/, '').trim(), rc: Number(m?.[1] ?? 127) };
};
const stage = (host: string) => {
  const r = run(`${STAGE(host)} > /tmp/stage.out 2>&1; echo "rc=$?"; cat /tmp/stage.out`, { image: HOST, network: NET });
  return { rc: Number(/^rc=(\d+)/m.exec(r.out)?.[1] ?? 127), out: r.out };
};
const OID = "select oid from pg_database where datname = 'polycarpic'";

describe('G13: provision --stage database creates the database', () => {
  it('control: the cluster has no polycarpic database before the stage (the helper made none)', () => {
    expect(q(names.good, "select count(*) from pg_database where datname = 'polycarpic'").out).toBe('0');
  });

  it('absent: created from template0 (a table planted in template1 is not in it), owned by poly_owner after roles.sql, PUBLIC has no CONNECT; exit 0', () => {
    expect(q(names.good, 'create table planted_in_template1 (x int)', 'template1').rc).toBe(0);
    const r = stage(names.good);
    expect(r.rc, r.out).toBe(0);
    expect(r.out).toMatch(/change: created database polycarpic on /);
    expect(q(names.good, "select pg_get_userbyid(datdba) from pg_database where datname = 'polycarpic'").out).toBe('poly_owner');
    const acl = q(names.good, "select coalesce(datacl::text, 'null') from pg_database where datname = 'polycarpic'").out;
    expect(acl, 'datacl names no PUBLIC entry (an entry with an empty grantee reads `=...`)').not.toMatch(/(^\{|,)=/);
    expect(acl).toContain('poly_app=c/poly_owner');
    expect(q(names.good, "select to_regclass('public.planted_in_template1') is null", 'polycarpic').out, 'created from template1, not template0').toBe('t');
    expect(q(names.good, "select to_regclass('public.planted_in_template1') is null", 'template1').out, 'control: the plant is in template1').toBe('f');
  });

  it('a second run changes nothing: exit 0, no "created database", the same database (oid)', () => {
    const before = q(names.good, OID).out;
    expect(before).toMatch(/^\d+$/);
    const r = stage(names.good);
    expect(r.rc, r.out).toBe(0);
    expect(r.out).not.toMatch(/created database/);
    expect(q(names.good, OID).out).toBe(before);
  });

  it('a restored cluster that already has the database is untouched: its data stays, its oid stays, nothing is "created"', () => {
    expect(q(names.stg, 'create database polycarpic').rc).toBe(0);
    expect(q(names.stg, "create table restored_marker as select 'kept'::text as v", 'polycarpic').rc).toBe(0);
    const before = q(names.stg, OID).out;
    const r = stage(names.stg);
    expect(r.rc, r.out).toBe(0);
    expect(r.out).not.toMatch(/created database/);
    expect(q(names.stg, OID).out).toBe(before);
    expect(q(names.stg, 'select v from restored_marker', 'polycarpic').out).toBe('kept');
  });

  it('a failed read stops the stage with exit non-zero and nothing is created (the `postgres` database is gone, so the read really fails inside Postgres)', () => {
    expect(q(names.fail, 'drop database postgres', 'template1').rc).toBe(0);
    const r = stage(names.fail);
    expect(r.rc, r.out).not.toBe(0);
    expect(r.out).toMatch(/could not read the database list of /);
    expect(r.out).not.toMatch(/created database/);
    expect(q(names.fail, "select count(*) from pg_database where datname = 'polycarpic'", 'template1').out).toBe('0');
  });

  it('the new database is not created by roles.sql running on `postgres` (the roles settings land on polycarpic, and `postgres` keeps its own owner and ACL)', () => {
    expect(q(names.bad, "select pg_get_userbyid(datdba) from pg_database where datname = 'postgres'").out).toBe('postgres');
    const r = stage(names.bad);
    expect(r.rc, r.out).toBe(0);
    expect(q(names.bad, "select pg_get_userbyid(datdba) from pg_database where datname = 'postgres'").out).toBe('postgres');
    expect(q(names.bad, "select coalesce(datacl::text, 'null') from pg_database where datname = 'postgres'").out).toBe('null');
    expect(q(names.bad, "select pg_get_userbyid(datdba) from pg_database where datname = 'polycarpic'").out).toBe('poly_owner');
  });
});
