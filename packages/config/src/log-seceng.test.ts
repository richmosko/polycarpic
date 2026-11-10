// POLY-85 seceng conditions S-5, S-6, S-7(a) on the logger and its schema. Same assumed surface as log.test.ts.
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
const schema = () => JSON.parse(readFileSync(join(HERE, '..', 'log.schema.json'), 'utf8'));
const validator = () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  (addFormats as any).default ? (addFormats as any).default(ajv) : (addFormats as any)(ajv);
  return ajv.compile(schema());
};
const make = () => {
  const lines: string[] = [];
  const stream = new Writable({ write(c, _e, cb) { lines.push(...String(c).split('\n').filter(Boolean)); cb(); } });
  const log: any = createLogger({ service: 'web', stream } as any);
  return { log, out: () => lines.join('\n'), json: () => lines.map((l) => JSON.parse(l)), lines };
};
const UUID = '3f2b8c1e-9d4a-4e6b-8a57-0c1d2e3f4a5b';

describe('S-5 a declared key is kept only if its value passes that field\'s schema (compiled from log.schema.json)', () => {
  const cases: [string, string, unknown][] = [
    ['route: an object carrying a canary', 'route', { body: CANARIES.token }],
    ['route: a URL (has ? and ://)', 'route', CANARIES.url],
    ['route: a path with a query', 'route', `/api/v1/x?access_token=${CANARIES.token}`],
    ['job: a canary past maxLength', 'job', CANARIES.memo.repeat(20)],
    ['var: not a variable name', 'var', CANARIES.memo],
    ['fault: not in the enum', 'fault', CANARIES.token],
    ['migration: free text', 'migration', CANARIES.memo],
    ['method: free text', 'method', CANARIES.memo],
    ['status: an object', 'status', { raw: CANARIES.token }],
    ['user_id: not a uuid', 'user_id', CANARIES.accountNumber],
    ['commit: not 40 hex', 'commit', CANARIES.token],
    ['count: a string', 'count', CANARIES.memo],
  ];
  for (const [name, key, val] of cases) {
    it(`${name} is dropped and counted`, () => {
      const { log, json, out } = make();
      log.error('a.b', { [key]: val });
      const o = json()[0];
      expect(o, 'a line is emitted').toBeDefined();
      expect(o).not.toHaveProperty(key);
      expect(o.dropped).toBeGreaterThanOrEqual(1);
      assertNoCanary(out(), 'log output');
      expect(validator()(o)).toBe(true);
    });
  }
  it('err.code holding a canary is dropped and counted; err.type survives', () => {
    const { log, json, out } = make();
    const e: any = new Error('x'); e.code = CANARIES.memo;
    log.error('db.query_failed', { err: e });
    const o = json()[0];
    expect(o.err?.code).toBeUndefined();
    expect(o.err?.type).toBe('Error');
    expect(o.dropped).toBeGreaterThanOrEqual(1);
    assertNoCanary(out());
  });
  it('err.type that is not a class-name shape is dropped (a thrown value with a hostile name)', () => {
    const { log, out } = make();
    const e = new Error('x'); e.name = CANARIES.memo;
    log.error('a.b', { err: e });
    assertNoCanary(out());
  });
  it('the filter is compiled from the schema: a schema-valid value for every key passes, so the two cannot drift (parity)', () => {
    const s = schema();
    const sample: Record<string, unknown> = {
      commit: 'a'.repeat(40), req_id: UUID, user_id: UUID, entity_id: UUID, run_id: UUID, route: '/api/v1/accounts/[id]', method: 'GET', status: 200,
      outcome: 'ok', latency_ms: 1.5, job: 'prices', migration: '0000_init', var: 'AUTH_SECRET_FILE', fault: s.properties.fault?.enum?.[0] ?? 'empty', count: 3,
    };
    const v = validator();
    const keys = Object.keys(s.properties).filter((k) => !['ts', 'level', 'service', 'event', 'dropped', 'err'].includes(k));
    for (const k of keys) expect(sample, `add a sample for schema key ${k}`).toHaveProperty(k);
    const { log, json } = make();
    log.info('a.b', sample);
    const o = json()[0];
    for (const k of keys) expect(o, `schema key ${k} must pass the filter`).toHaveProperty(k, sample[k]);
    expect(o).not.toHaveProperty('dropped');
    expect(v(o), JSON.stringify(v.errors)).toBe(true);
    // ... and nothing else passes
    const m = make();
    m.log.info('a.b', { not_in_schema: 'x', another: 1 });
    expect(m.json()[0]).not.toHaveProperty('not_in_schema');
    expect(m.json()[0].dropped).toBe(2);
  });
});

describe('S-6 the schema is closed and every string is bounded', () => {
  type P = Record<string, any>;
  const walk = (props: P, path: string, out: string[]) => {
    for (const [k, p] of Object.entries(props)) {
      const at = `${path}${k}`;
      if (p.type === undefined) { out.push(`${at}: no type`); continue; }
      if (p.type === 'array') out.push(`${at}: array`);
      else if (p.type === 'object') {
        if (at !== 'err') out.push(`${at}: object`);
        else {
          if (p.additionalProperties !== false) out.push('err: not closed');
          walk(p.properties ?? {}, 'err.', out);
        }
      } else if (p.type === 'string') {
        if (p.enum === undefined && p.pattern === undefined && p.format === undefined) out.push(`${at}: string with no enum, pattern or format`);
        if (p.maxLength === undefined && p.enum === undefined) out.push(`${at}: string with no maxLength`);
      }
    }
  };
  it('no untyped, object (except closed err), array or unbounded string property', () => {
    const problems: string[] = [];
    walk(schema().properties, '', problems);
    expect(problems).toEqual([]);
  });
  it('the walker has teeth: it flags each kind of bad property', () => {
    const out: string[] = [];
    walk({ a: {}, b: { type: 'object' }, c: { type: 'array' }, d: { type: 'string' }, e: { type: 'string', pattern: '^x$' }, f: { type: 'string', maxLength: 3 } }, '', out);
    expect(out).toHaveLength(7); // d is flagged twice: no enum/pattern/format, and no maxLength
  });
  it('err is closed and primitive-only', () => {
    const e = schema().properties.err;
    expect(e.additionalProperties).toBe(false);
    for (const p of Object.values<any>(e.properties)) expect(['string', 'integer', 'number', 'boolean']).toContain(p.type);
  });
});

describe('S-7(a) child bindings go through the same filter, or there is no child()', () => {
  it('a child bound with a canary does not emit it', () => {
    const { log, out, lines } = make();
    if (typeof log.child !== 'function') return; // no child(): the condition is met by absence
    const c = log.child({ token: CANARIES.token, route: CANARIES.url, user_id: UUID });
    c.info('a.b', { status: 200 });
    assertNoCanary(out(), 'child output');
    const v = validator();
    for (const l of lines) expect(v(JSON.parse(l)), l).toBe(true);
    expect(JSON.parse(lines[0]!)).toMatchObject({ user_id: UUID, status: 200 });
  });
});
