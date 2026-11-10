// The redacting logger (POLY-85 ruling R6; SECURITY C-33). Exported as @poly/config/log; the one logging entry point.
//
// Two layers, as C-33 names them:
//   1. an ALLOWLIST compiled from log.schema.json: a key is kept only if the schema declares it AND its value passes
//      that field's type, enum, pattern, length and range. Anything else is dropped and counted in `dropped` (a count,
//      never the key names). There is no free-text field.
//   2. pino's `redact` as a backstop for the usual secret-shaped paths.
// An Error is reduced to { type, code }: its message and stack can quote a bound value (a pg error does).
import { Writable } from 'node:stream';
import pino from 'pino';
import schema from '../log.schema.json' with { type: 'json' };

export type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogService = 'web' | 'worker' | 'migrate';
export type Fields = Record<string, unknown>;

interface Rule {
  type?: string;
  enum?: readonly unknown[];
  pattern?: RegExp;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}
const compile = (p: Record<string, unknown>): Rule => ({
  type: p.type as string | undefined,
  enum: p.enum as unknown[] | undefined,
  pattern: typeof p.pattern === 'string' ? new RegExp(p.pattern) : undefined,
  maxLength: p.maxLength as number | undefined,
  minimum: p.minimum as number | undefined,
  maximum: p.maximum as number | undefined,
});
const RULES = new Map<string, Rule>(Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([k, v]) => [k, compile(v)]));
const ERR_RULES = new Map<string, Rule>(Object.entries(schema.properties.err.properties as Record<string, Record<string, unknown>>).map(([k, v]) => [k, compile(v)]));
/** Set by the logger, never by a caller. */
const RESERVED = new Set(['ts', 'level', 'service', 'event', 'dropped']);

function passes(r: Rule, v: unknown): boolean {
  if (r.enum && !r.enum.includes(v)) return false;
  // fail closed (M-1): a type this filter does not check, including a type array, accepts nothing
  if (r.type === 'string') {
    if (typeof v !== 'string') return false;
    if (r.maxLength !== undefined && v.length > r.maxLength) return false;
    if (r.pattern && !r.pattern.test(v)) return false;
    return true;
  }
  if (r.type === 'integer' || r.type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v) || (r.type === 'integer' && !Number.isInteger(v))) return false;
    if (r.minimum !== undefined && v < r.minimum) return false;
    if (r.maximum !== undefined && v > r.maximum) return false;
    return true;
  }
  if (r.type === 'boolean') return typeof v === 'boolean';
  return false;
}

/** err -> { type, code } with each part checked; null when nothing survives (type is required). */
function errOf(v: unknown): { err: { type: string; code?: string } | null; dropped: number } {
  const type = v instanceof Error ? v.name : (v as { type?: unknown } | null)?.type;
  const code = v instanceof Error ? (v as { code?: unknown }).code : (v as { code?: unknown } | null)?.code;
  if (v === null || typeof v !== 'object' || !passes(ERR_RULES.get('type')!, type)) return { err: null, dropped: 1 };
  // a plain object other than { type, code } is not an error shape
  if (!(v instanceof Error) && Object.keys(v).some((k) => k !== 'type' && k !== 'code')) return { err: null, dropped: 1 };
  if (code === undefined) return { err: { type: type as string }, dropped: 0 };
  if (!passes(ERR_RULES.get('code')!, code)) return { err: { type: type as string }, dropped: 1 };
  return { err: { type: type as string, code: code as string }, dropped: 0 };
}

/** The allowlist filter. Never throws: a hostile object (a getter that throws) drops everything. */
export function sanitize(fields: unknown, reserved: ReadonlySet<string> = RESERVED): { out: Fields; dropped: number } {
  const out: Fields = {};
  let dropped = 0;
  if (fields === null || typeof fields !== 'object') return { out, dropped: fields === undefined ? 0 : 1 };
  let keys: string[];
  try { keys = Object.keys(fields); } catch { return { out, dropped: 1 }; }
  for (const k of keys) {
    try {
      const v = (fields as Fields)[k];
      const rule = RULES.get(k);
      if (!rule || reserved.has(k) || v === undefined) {
        if (v !== undefined) dropped++;
        continue;
      }
      if (k === 'err') {
        const r = errOf(v);
        dropped += r.dropped;
        if (r.err) out.err = r.err;
      } else if (passes(rule, v)) out[k] = v;
      else dropped++;
    } catch {
      dropped++;
    }
  }
  return { out, dropped };
}

export interface Logger {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
  fatal(event: string, fields?: Fields): void;
  /** Bindings pass through the same filter (S-7a). */
  child(fields: Fields): Logger;
}

export interface LoggerOptions {
  service: LogService;
  /** Defaults to stdout. Any Writable receiving one JSON line per call. */
  stream?: Writable;
  level?: Level;
}

const EVENT = new RegExp(schema.properties.event.pattern);
const REDACT = ['*.password', '*.secret', '*.token', '*.authorization', '*.cookie', 'headers.*'];

export function createLogger(opts: LoggerOptions): Logger {
  const base = pino(
    {
      level: opts.level ?? 'debug',
      base: { service: opts.service },
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
      formatters: {
        level: (label) => ({ level: label }),
        // the last guard: whatever reaches pino is filtered again against the schema
        log: (obj) => {
          const { out } = sanitize(obj, new Set(['ts', 'level', 'service']));
          const n = (typeof out.dropped === 'number' ? out.dropped : 0) + (Object.keys(obj).length - Object.keys(out).length);
          return n > 0 ? { ...out, dropped: n } : out;
        },
        bindings: (b) => ({ ...sanitize(b, RESERVED).out, service: opts.service }),
      },
      redact: { paths: REDACT, censor: '[redacted]' },
    },
    opts.stream ?? pino.destination({ fd: 1, sync: true }),
  );

  const wrap = (p: pino.Logger): Logger => {
    const emit = (level: Level) => (event: string, fields?: Fields): void => {
      let dropped = 0;
      let ev = event;
      if (typeof ev !== 'string' || !EVENT.test(ev) || ev.length > 64) { ev = 'log.invalid_event'; dropped++; }
      const s = sanitize(fields);
      dropped += s.dropped;
      p[level]({ event: ev, ...s.out, ...(dropped > 0 ? { dropped } : {}) });
    };
    return {
      debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error'), fatal: emit('fatal'),
      child: (fields) => wrap(p.child(sanitize(fields).out)),
    };
  };
  return wrap(base);
}
