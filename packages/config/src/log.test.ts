// POLY-85 R6 / criterion 4: structured JSON logs to a committed schema; allowlist first, redaction as backstop (C-33).
// Surface assumed (reconcile in `make` only): `createLogger({ service, stream })` from ./log.ts (= @poly/config/log);
// `log.<level>(event, fields?)`; stream is any Writable receiving one JSON line per call.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { CANARIES, assertNoCanary } from '../../../tests/log/canary.ts';
import { createLogger } from './log.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, '..', 'log.schema.json');
const schema = () => JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const validate = (() => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats.default ? (addFormats as any).default(ajv) : (addFormats as any)(ajv);
  return ajv.compile(schema());
})();

const make = (service: 'web' | 'worker' | 'migrate' = 'web') => {
  const lines: string[] = [];
  const stream = new Writable({ write(c, _e, cb) { lines.push(...String(c).split('\n').filter(Boolean)); cb(); } });
  const log: any = createLogger({ service, stream } as any);
  return { log, lines, out: () => lines.join('\n'), json: () => lines.map((l) => JSON.parse(l)) };
};
const UUID = '3f2b8c1e-9d4a-4e6b-8a57-0c1d2e3f4a5b';

describe('the committed schema', () => {
  it('is JSON Schema 2020-12 with top-level additionalProperties:false', () => {
    const s = schema();
    expect(s.$schema).toMatch(/2020-12/);
    expect(s.additionalProperties).toBe(false);
  });
  it('requires exactly ts, level, service, event', () => expect([...schema().required].sort()).toEqual(['event', 'level', 'service', 'ts']));
  it('declares exactly the allowed fields (SECURITY 9 "Logged" list + R3/R4 needs), and no free-text msg', () => {
    const keys = Object.keys(schema().properties).sort();
    expect(keys).toEqual(['commit', 'count', 'dropped', 'entity_id', 'err', 'event', 'fault', 'job', 'latency_ms', 'level', 'method', 'migration', 'outcome', 'req_id', 'route', 'run_id', 'service', 'status', 'ts', 'user_id', 'var'].sort());
    expect(keys).not.toContain('msg');
    expect(keys).not.toContain('message');
  });
  it('err is { type, code? } only', () => {
    const e = schema().properties.err;
    expect(e.additionalProperties).toBe(false);
    expect(Object.keys(e.properties).sort()).toEqual(['code', 'type']);
  });
  it('the validator has teeth: it rejects an extra key, a bad level, a bad event, a bad service, a missing ts', () => {
    const ok = { ts: '2026-11-10T12:00:00.000Z', level: 'info', service: 'web', event: 'a.b' };
    expect(validate(ok)).toBe(true);
    for (const bad of [{ ...ok, msg: 'hi' }, { ...ok, level: 'trace' }, { ...ok, event: 'Free text here' }, { ...ok, event: 'nodot' }, { ...ok, service: 'api' }, { ...ok, ts: undefined }, { ...ok, user_id: 'not-a-uuid' }, { ...ok, var: 'lower' }, { ...ok, status: 'x' }, { ...ok, outcome: 'maybe' }, { ...ok, latency_ms: -1 }]) {
      expect(validate(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('emitted lines', () => {
  it('one JSON object per call, newline-terminated, and every line validates against the schema', () => {
    const { log, lines } = make();
    log.info('http.request', { req_id: UUID, route: '/api/v1/health', method: 'GET', status: 200, outcome: 'ok', latency_ms: 3.5 });
    log.warn('config.refused', { var: 'AUTH_SECRET_FILE', fault: 'empty' });
    log.error('job.failed', { job: 'prices', run_id: UUID, count: 2, err: new Error('boom') });
    log.debug('a.b'); log.fatal('db.unreachable', { outcome: 'error' });
    expect(lines).toHaveLength(5);
    for (const l of lines) {
      const o = JSON.parse(l);
      expect(validate(o), JSON.stringify(validate.errors)).toBe(true);
    }
  });
  it('level is the label (not pino\'s number); service and ts are set; no pid, hostname or msg', () => {
    const { log, json } = make('worker');
    log.info('a.b');
    const o = json()[0];
    expect(o.level).toBe('info');
    expect(o.service).toBe('worker');
    expect(o.ts).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    for (const k of ['pid', 'hostname', 'msg', 'time', 'v']) expect(o).not.toHaveProperty(k);
  });
  it('declared fields pass through unchanged', () => {
    const { log, json } = make();
    log.info('http.request', { req_id: UUID, user_id: UUID, entity_id: UUID, run_id: UUID, route: '/api/v1/accounts/[id]', status: 404 });
    expect(json()[0]).toMatchObject({ req_id: UUID, user_id: UUID, entity_id: UUID, run_id: UUID, route: '/api/v1/accounts/[id]', status: 404 });
  });
  it('an event that does not match the code-constant pattern is not emitted as free text', () => {
    const { log, lines } = make();
    try { log.info('Free text with spaces and ' + CANARIES.memo); } catch { /* throwing is acceptable */ }
    for (const l of lines) expect(validate(JSON.parse(l)), l).toBe(true);
    assertNoCanary(lines.join('\n'));
  });
});

describe('C-33 allowlist: nothing undeclared reaches output', () => {
  it('an undeclared top-level key is dropped, and `dropped` counts it without naming the key', () => {
    const { log, json, out } = make();
    log.info('a.b', { access_token: CANARIES.token, password: 'x', whatever_field_name: CANARIES.memo });
    const o = json()[0];
    expect(o).not.toHaveProperty('access_token');
    expect(o).not.toHaveProperty('whatever_field_name');
    expect(o.dropped).toBe(3);
    expect(out()).not.toMatch(/access_token|whatever_field_name|password/);
    assertNoCanary(out());
  });
  it('no `dropped` field when nothing was dropped', () => {
    const { log, json } = make();
    log.info('a.b', { status: 200 });
    expect(json()[0]).not.toHaveProperty('dropped');
  });
  const planted: [string, Record<string, unknown>][] = [
    ['a token in an undeclared key', { token: CANARIES.token }],
    ['a bearer authorization header-shaped object', { headers: { authorization: CANARIES.bearer, cookie: CANARIES.token } }],
    ['a nested object', { a: { b: { c: CANARIES.accountNumber } } }],
    ['a raw provider payload (array of records)', { payload: [{ account: CANARIES.accountNumber, memo: CANARIES.memo }] }],
    ['a URL carrying credentials', { url: CANARIES.url }],
    ['a secret-file value under a secret-shaped name', { secret: CANARIES.secretFile, apiKey: CANARIES.secretFile, password: CANARIES.secretFile }],
    ['a Buffer and a Map', { b: Buffer.from(CANARIES.token), m: new Map([['k', CANARIES.token]]) }],
    ['a circular object', (() => { const o: any = { x: CANARIES.token }; o.self = o; return { o }; })()],
    ['a declared key holding an object (status: {…})', { status: { raw: CANARIES.token } }],
  ];
  for (const [name, fields] of planted) {
    it(`${name} never reaches output`, () => {
      const { log, out, lines } = make();
      try { log.error('a.b', fields); } catch { /* an exception is acceptable; a leak is not */ }
      assertNoCanary(out(), 'log output');
      for (const l of lines) expect(validate(JSON.parse(l)), l).toBe(true);
    });
  }
  it('a declared string field holding a canary is the caller\'s bug, but `route` must never be a raw path with a query', () => {
    const { log, out } = make();
    log.info('http.request', { route: `/api/v1/x?access_token=${CANARIES.token}` });
    assertNoCanary(out(), 'route with query');
  });
});

describe('err serialisation (a pg error message can quote a bound value)', () => {
  it('carries { type, code } only: never message, stack or cause', () => {
    const { log, json, out } = make();
    const e: any = new Error(`duplicate key value (${CANARIES.accountNumber}) ${CANARIES.memo}`, { cause: new Error(CANARIES.token) });
    e.code = '23505'; e.detail = CANARIES.memo; e.where = CANARIES.url;
    log.error('db.query_failed', { err: e });
    expect(json()[0].err).toEqual({ type: 'Error', code: '23505' });
    assertNoCanary(out());
    expect(out()).not.toMatch(/stack|at .*\(.*:\d+:\d+\)/);
  });
  it('a thrown non-Error (a string) does not leak', () => {
    const { log, out } = make();
    log.error('a.b', { err: CANARIES.token });
    assertNoCanary(out());
  });
  it('a custom error class reports its name', () => {
    class SchemaBehindError extends Error { constructor() { super('x'); this.name = 'SchemaBehindError'; } }
    const { log, json } = make();
    log.error('db.schema_behind', { err: new SchemaBehindError() });
    expect(json()[0].err.type).toBe('SchemaBehindError');
  });
});

describe('pino redact is a live backstop behind the allowlist', () => {
  it('the logger source configures redact for password, secret, token, authorization, cookie, headers (C-33 names both layers)', () => {
    const src = readFileSync(join(HERE, 'log.ts'), 'utf8');
    for (const k of ['password', 'secret', 'token', 'authorization', 'cookie', 'headers']) expect(src, k).toMatch(new RegExp(k));
    expect(src).toMatch(/redact/);
    expect(src).toMatch(/formatters/);
  });
});
