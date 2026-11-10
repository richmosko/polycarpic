// The `check-config` subcommand every entrypoint shares (POLY-85 R3): one `check-config: <message>` line per fault on
// stderr, exit 0 or 1, connects nowhere. A message names the variable and the path; never content.
import { checkConfig, type Env } from './check.ts';
import type { Service } from './registry.ts';

export function runCheckConfig(service: Service, env: Env = process.env): number {
  const problems = checkConfig(service, env);
  for (const p of problems) process.stderr.write(`check-config: ${p.message}\n`);
  return problems.length ? 1 : 0;
}
