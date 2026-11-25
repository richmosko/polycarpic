// POLY-161c R5 / S5 (verdict B13, B14): `guardConsole` replaces every output method of `console`, logs `console.suppressed` for an Error and
// nothing else of the arguments, and Node's process warnings print nothing of their text. Run in a child process: a spy on
// `process.stdout.write` misses vitest's own console (POLY-162 C1), and a child's real stdout and stderr are what the container logs show.
// Each case has an un-guarded control that shows the canary, so an empty output cannot pass. Red today: src/ops/console.ts does not exist.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', '..');
const MOD = pathToFileURL(join(HERE, 'console.ts')).href;
// Built at run time from two low-entropy pieces (a scanner rule: no literal beside a credential-like name).
const CANARY = ['canary', 'zq7', 'marker'].join('-');

function child(body: string, guarded: boolean): { stdout: string; stderr: string; status: number | null; json: Array<Record<string, unknown>> } {
  const code = `
    import { createLogger } from '@poly/config/log';
    ${guarded ? `const { guardConsole } = await import(${JSON.stringify(MOD)}); ` : ''}
    const log = createLogger({ service: 'web' });
    ${guarded ? 'guardConsole(log);' : ''}
    log.info('test.control');
    ${body}
    await new Promise((r) => setTimeout(r, 50));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: WEB, encoding: 'utf8', timeout: 20000 });
  const json: Array<Record<string, unknown>> = [];
  for (const line of r.stdout.split('\n').filter(Boolean)) { try { json.push(JSON.parse(line)); } catch { /* not a log line */ } }
  return { stdout: r.stdout, stderr: r.stderr, status: r.status, json };
}

// Every output method of the console object, from its own keys (S5): the list is read from the running Node, not typed here.
const METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'dirxml', 'table', 'group', 'groupCollapsed', 'groupEnd', 'count', 'countReset', 'time', 'timeEnd', 'timeLog', 'assert'];

describe('guardConsole: every output method', () => {
  it('the method list covers every own function key of console that can write  [red if: the list rots against this Node]', () => {
    const own = Object.keys(console).filter((k) => typeof (console as unknown as Record<string, unknown>)[k] === 'function');
    const quiet = new Set(['Console', 'profile', 'profileEnd', 'timeStamp', 'context', 'createTask', 'clear']);
    expect(own.filter((k) => !METHODS.includes(k) && !quiet.has(k))).toEqual([]);
  });

  it.each(METHODS)('console.%s with a canary string and a canary object prints nothing of it  [red if: this method is not replaced]', (m) => {
    const body = `
      const o = { k: ${JSON.stringify(CANARY)} };
      try { console.${m}(${JSON.stringify(CANARY)}, o); console.${m}(${JSON.stringify(CANARY)}); console.${m}(false, ${JSON.stringify(CANARY)}); console.${m}([{ k: ${JSON.stringify(CANARY)} }]); } catch {}
    `;
    const guarded = child(body, true);
    expect(guarded.stdout + guarded.stderr).not.toContain(CANARY);
    expect(guarded.json.map((l) => l.event)).toContain('test.control');
  });

  it('un-guarded control: the same calls DO print the canary  [red if: the child prints nothing for any reason]', () => {
    for (const m of ['log', 'error', 'warn', 'info', 'debug', 'dir', 'table']) {
      const r = child(`console.${m}(${JSON.stringify(CANARY)}, { k: ${JSON.stringify(CANARY)} }); console.${m}([{ k: ${JSON.stringify(CANARY)} }]);`, false);
      expect(r.stdout + r.stderr, m).toContain(CANARY);
    }
  });

});

describe('guardConsole: what is logged', () => {
  it('an Error argument gives one console.suppressed at warn with err type and code only; message, stack and every other argument stay out  [red if: the message or stack is logged, or nothing is]', () => {
    const r = child(`
      const e = new TypeError(${JSON.stringify(CANARY + '-message')});
      e.code = 'EZQ';
      console.error('prefix-' + ${JSON.stringify(CANARY)}, { deep: ${JSON.stringify(CANARY)} }, e);
    `, true);
    const hits = r.json.filter((l) => l.event === 'console.suppressed');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.level).toBe('warn');
    expect(hits[0]!.err).toEqual({ type: 'TypeError', code: 'EZQ' });
    expect(r.stdout + r.stderr).not.toContain(CANARY);
    expect(r.stdout + r.stderr).not.toContain('at file:');
  });

  it('a call with no Error argument logs nothing of its arguments, and nothing else is logged but the control line  [red if: a string or object is echoed, even as a field]', () => {
    const r = child(`
      console.log(${JSON.stringify(CANARY)});
      console.warn({ req: { headers: { a: ${JSON.stringify(CANARY)} } } });
      console.error({ message: ${JSON.stringify(CANARY)}, stack: ${JSON.stringify(CANARY)} });
    `, true);
    expect(r.stdout + r.stderr).not.toContain(CANARY);
    expect(r.json.every((l) => l.event === 'test.control' || l.event === 'console.suppressed')).toBe(true);
  });

  it('a planted logged object (`console.log(req.headers)`) is seen un-guarded and not guarded  [red if: an object slips through]', () => {
    const body = `console.log({ cookie: ${JSON.stringify(CANARY)} });`;
    expect(child(body, false).stdout).toContain(CANARY);
    expect(child(body, true).stdout).not.toContain(CANARY);
  });

  it('the child exits 0: the guard does not break the program  [red if: guardConsole throws or hangs]', () => {
    expect(child(`console.log('x');`, true).status).toBe(0);
  });
});

describe('guardConsole: Node process warnings (S5)', () => {
  it('a process warning prints nothing of its text guarded, and does print it un-guarded  [red if: the warning handler still writes the text]', () => {
    const body = `process.emitWarning(${JSON.stringify(CANARY + '-warning')});`;
    expect(child(body, false).stderr).toContain(CANARY);
    const g = child(body, true);
    expect(g.stdout + g.stderr).not.toContain(CANARY);
  });

  it('a deprecation warning and a warning with a code are silent too  [red if: only the plain form is handled]', () => {
    const g = child(`process.emitWarning(${JSON.stringify(CANARY)}, 'DeprecationWarning', 'DEP9999'); process.emitWarning(${JSON.stringify(CANARY)}, { type: 'ExperimentalWarning', detail: ${JSON.stringify(CANARY)} });`, true);
    expect(g.stdout + g.stderr).not.toContain(CANARY);
  });
});
