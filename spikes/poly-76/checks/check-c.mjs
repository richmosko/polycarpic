// (c) custom SQL migration with trigger + SECURITY DEFINER function applies through the real runner as poly_migrator.
import fs from 'node:fs';
import path from 'node:path';
import { Checker, needChain, q, psql, CFG, MIG_DIR } from './lib.mjs';

const t = new Checker('c', 'trigger + SECURITY DEFINER function applied as poly_migrator, owned by poly_owner (NOLOGIN), tracking row written');
const s = needChain(t);

const role = q(`select rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname='poly_owner'`).rows[0];
t.ok(role && role[0] === 'f', 'poly_owner is not NOLOGIN');
t.ok(role && role[1] === 'f' && role[2] === 'f', 'poly_owner is superuser or BYPASSRLS');

const fn = q(`select pg_get_userbyid(proowner), prosecdef, prorettype::regtype::text from pg_proc where oid = to_regprocedure('public.spike_note_touch()')`).rows[0];
t.need(fn, 'function public.spike_note_touch() does not exist after migrate');
t.ok(fn[0] === 'poly_owner', `spike_note_touch() is owned by ${fn[0]}, expected poly_owner`);
t.ok(fn[1] === 't', 'spike_note_touch() is not SECURITY DEFINER');
t.ok(fn[2] === 'trigger', `spike_note_touch() returns ${fn[2]}, expected trigger`);

const trg = q(`select pg_get_triggerdef(t.oid), t.tgenabled from pg_trigger t
  where t.tgname='spike_note_touch_trg' and t.tgrelid = to_regclass('public.spike_note') and not t.tgisinternal
    and t.tgfoid = to_regprocedure('public.spike_note_touch()')`).rows[0];
t.ok(trg && trg[1] === 'O', 'trigger spike_note_touch_trg on public.spike_note (function spike_note_touch) missing or disabled');
t.ok(trg && /BEFORE INSERT/.test(trg[0]), 'trigger is not BEFORE INSERT');
t.ok(owner('public.spike_note') === 'poly_owner', `public.spike_note is owned by ${owner('public.spike_note')}, expected poly_owner`);

// behaviour: the trigger really fires
const b = psql(`set role poly_owner; insert into public.spike_note(id, body) values (gen_random_uuid(), 'x') returning touched_at is not null;`);
t.ok(b.ok && b.rows[0]?.[0] === 't', `trigger did not set touched_at on insert${b.ok ? '' : ': ' + b.err}`);

// real runner, real login: every DDL statement in the migrate window came from session_user poly_migrator
const ddl = q(`select login, tag from qa_harness.ddl_log where at >= '${s.tMigrate}'`).rows;
t.ok(ddl.length > 0, 'no DDL was logged during bin/migrate');
t.ok(ddl.some((r) => r[0] === 'poly_migrator' && r[1] === 'CREATE TRIGGER'), 'no CREATE TRIGGER by poly_migrator logged during bin/migrate');
t.ok(ddl.some((r) => r[0] === 'poly_migrator' && r[1] === 'CREATE FUNCTION'), 'no CREATE FUNCTION by poly_migrator logged during bin/migrate');
const others = [...new Set(ddl.filter((r) => r[0] !== 'poly_migrator').map((r) => r[0]))];
t.ok(!others.length, `DDL ran as other logins during bin/migrate: ${others.join(', ')}`);

// tracking row: one per journal entry, written by the runner
const tr = q(`select count(*) from ${CFG.tracking}`);
t.need(tr.ok, `tracking table ${CFG.tracking} not readable: ${tr.err.split('\n')[0]}`);
const j = path.join(MIG_DIR, 'meta', '_journal.json');
const entries = fs.existsSync(j) ? JSON.parse(fs.readFileSync(j, 'utf8')).entries.length : -1;
t.ok(entries > 0, 'drizzle/meta/_journal.json lists no migrations');
t.ok(Number(tr.rows[0][0]) === entries, `${CFG.tracking} has ${tr.rows[0][0]} rows, journal lists ${entries} migrations`);
t.done();
function owner(rel) { return q(`select pg_get_userbyid(relowner) from pg_class where oid = to_regclass('${rel}')`).rows[0]?.[0]; }
