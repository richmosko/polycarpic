// POLY-149c: the planted-mutation tests for pgTAP 11 and 12 (ruling R1, R2, R3). Each plant runs inside the file's own rolled-back transaction
// on a clone and must turn the file red; the control (no plant) must be clean, so no plant passes vacuously. Titles end [red if: <mutation>].
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { cloneMigrated } from './helpers/api';
import { psql } from './helpers/pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'pgtap');
const file = (n: string) => readFileSync(join(dir, n), 'utf8');
let db: string;
beforeAll(() => { db = cloneMigrated(); expect(psql('CREATE EXTENSION IF NOT EXISTS pgtap', db).ok).toBe(true); });
const run = (body: string, plant: string) => psql(body.replace('BEGIN;', () => `BEGIN;\n${plant};`), db).out.split('\n').filter((l) => /^not ok/.test(l));

describe('11_poly_app_grants.sql bites (ruling R1: ten functions, no BetterAuth table, nothing else)', () => {
  const body = file('11_poly_app_grants.sql');
  it('control: no plant, no failure [red if: 11 fails unplanted, so the plants below would pass vacuously]', () => { expect(run(body, 'SELECT 1')).toEqual([]); });
  const plants: [string, string][] = [
    ['GRANT SELECT ON public.session TO poly_app', 'a SELECT on a BetterAuth table'],
    ['GRANT UPDATE (name) ON public."user" TO poly_app', 'a column grant on user'],
    ['GRANT EXECUTE ON FUNCTION app.enter_auth_session(text) TO poly_app', 'an EXECUTE on another enter_*'],
    ['GRANT SELECT (id) ON app.email_challenge TO poly_app', 'the email_challenge column read that R1 revokes'],
    [`SET LOCAL ROLE poly_owner; CREATE FUNCTION app.qa_plant_pub() RETURNS int LANGUAGE sql AS 'SELECT 1'; GRANT EXECUTE ON FUNCTION app.qa_plant_pub() TO PUBLIC; RESET ROLE`, 'a new app function granted to PUBLIC (effective only)'],
    ['REVOKE EXECUTE ON FUNCTION app.enter_session(text) FROM poly_app', 'a listed EXECUTE missing'],
    ['REVOKE EXECUTE ON FUNCTION app.my_second_step() FROM poly_app', 'my_second_step (RC1) missing from the eleven'],
  ];
  for (const [plant, label] of plants) it(`${label} turns 11 red [red if: 11 does not read that surface]`, () => { expect(run(body, plant).length, plant).toBeGreaterThanOrEqual(1); });
});

describe('12_sign_in_controls.sql bites (ruling R2, R3, R5; seceng T-L5, T-S3)', () => {
  const body = file('12_sign_in_controls.sql');
  it('control: no plant, no failure [red if: 12 fails unplanted]', () => { expect(run(body, 'SELECT 1')).toEqual([]); });
  const plants: [string, string][] = [
    ['DROP TRIGGER two_factor_15_lock ON public.two_factor', 'the lock guard dropped'],
    ['ALTER TABLE public.two_factor DISABLE TRIGGER two_factor_15_lock', 'the lock guard disabled'],
    ['DROP TRIGGER two_factor_16_lock_delete ON public.two_factor', 'the delete guard dropped'],
    ['ALTER TABLE public.two_factor DISABLE TRIGGER two_factor_16_lock_delete', 'the delete guard disabled'],
    ['GRANT UPDATE ON app.second_step_streak TO poly_auth', 'a direct UPDATE of the streak for poly_auth'],
    ['GRANT SELECT ON app.second_step_streak TO PUBLIC', 'the streak readable through PUBLIC'],
    ['GRANT DELETE ON public."user" TO poly_auth', 'DELETE on user for a login role (the cascade could reset the streak)'],
    ['DROP TRIGGER session_80_sign_in_record ON public.session', 'the session trigger dropped'],
    ['ALTER TABLE public.session DISABLE TRIGGER session_80_sign_in_record', 'the session trigger disabled'],
    ['DROP TRIGGER sign_in_record_10_immutable ON app.sign_in_record', 'the append-only trigger dropped'],
    ['DROP TRIGGER sign_in_record_05_refuse ON app.sign_in_record', 'the statement-level refusal dropped'],
    ['ALTER TABLE app.sign_in_record DISABLE TRIGGER sign_in_record_05_refuse', 'the statement-level refusal disabled'],
    ['GRANT EXECUTE ON FUNCTION app.sign_in_address(text) TO poly_app', 'the address helper executable by poly_app'],
    ['ALTER FUNCTION app.sign_in_address(text) VOLATILE', 'the address helper made volatile'],
    ['ALTER FUNCTION app.sign_in_address(text) IMMUTABLE', 'the address helper made IMMUTABLE again (claims more than pg_input_is_valid)'],
    ['GRANT DELETE ON app.sign_in_record TO poly_auth', 'DELETE on the record for poly_auth'],
    ['GRANT SELECT ON app.sign_in_record TO poly_worker', 'a runtime role reading the record'],
    ['GRANT UPDATE ON app.sign_in_record TO poly_govern, PUBLIC', 'UPDATE on the record through PUBLIC'],
    ['GRANT EXECUTE ON FUNCTION app.guard_second_step_lock() TO PUBLIC', 'the guard executable by PUBLIC'],
    ['GRANT EXECUTE ON FUNCTION app.purge_sign_in_record() TO poly_app', 'the purge executable by poly_app'],
    [`UPDATE pg_proc SET prosrc = prosrc || E'\\n-- current_setting(''role'')' WHERE oid = 'app.guard_second_step_lock()'::regprocedure`, 'current_setting(role) added to the guard'],
    [`UPDATE pg_proc SET prosrc = prosrc || E'\\n-- current_setting(''poly.now'')' WHERE oid = 'app.sign_in_address(text)'::regprocedure`, 'an unlisted setting read by sign_in_address'],
    [`UPDATE pg_proc SET prosrc = prosrc || E'\\n-- EXECUTE ''x''' WHERE oid = 'app.record_session_sign_in()'::regprocedure`, 'a dynamic EXECUTE in the record writer'],
    [`CREATE FUNCTION public.qa_plant_exec() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'SELECT 1'; END $$`, 'a function in public running a dynamic EXECUTE'],
    [`CREATE SCHEMA qa_plant_s; CREATE FUNCTION qa_plant_s.clock() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('app.now') $$`, 'a function in another schema reading a clock setting (outside an app-only scan)'],
    [`CREATE SCHEMA qa_plant_s2; CREATE FUNCTION qa_plant_s2.f() RETURNS text LANGUAGE sql AS $$ SELECT setting FROM pg_settings LIMIT 1 $$`, 'a function reading pg_settings'],
    [`SET LOCAL ROLE poly_owner; CREATE FUNCTION app.qa_plant_clock() RETURNS timestamptz LANGUAGE sql AS $$ SELECT current_setting('app.now')::timestamptz $$; RESET ROLE`, 'a function reading a clock from a setting'],
    [`SET LOCAL ROLE poly_owner; CREATE FUNCTION app.qa_plant_set() RETURNS text LANGUAGE sql AS $$ SELECT set_config('app.now', 'x', true) $$; RESET ROLE`, 'a function calling set_config'],
  ];
  for (const [plant, label] of plants) it(`${label} turns 12 red [red if: 12 does not read that surface]`, () => { expect(run(body, plant).length, plant).toBeGreaterThanOrEqual(1); });
});
