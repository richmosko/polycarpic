// The last guard for the bundle and its libraries (POLY-161 R5, SECURITY C-33): every output method of `console` is replaced.
// A call logs `web.console_suppressed` with the error type and code if an argument is an Error, and nothing else of the arguments.
import type { Logger } from '@poly/config/log';

export function guardConsole(log: Logger, target: Console = console): void {
  const suppressed = (...args: unknown[]): void => {
    const err = args.find((a): a is Error => a instanceof Error);
    log.warn('web.console_suppressed', err ? { err } : {});
  };
  const t = target as unknown as Record<string, unknown>;
  for (const key of Object.keys(t)) if (typeof t[key] === 'function') t[key] = suppressed;
  // Node prints a process warning's text to stderr by itself (it can quote a value): the default printer goes, the type stays.
  if (target === console) {
    process.removeAllListeners('warning');
    process.on('warning', (w) => log.warn('web.console_suppressed', { err: w }));
  }
}
