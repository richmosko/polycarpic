// C-33 canary harness (POLY-85 ruling R6). Every value below is shaped like something that must never reach a log line,
// a status/health body, or check-config output. A test plants one, drives the code, and calls assertNoCanary on the text.
// Later adapters (broker, Plaid) extend CANARIES; they never replace the assertion.
export const CANARIES = {
  token: 'tok_live_QACANARY9f3a7c1d5e',
  bearer: 'Bearer eyJQACANARY.payloadpart.sigpart',
  url: 'https://user:QACANARYpw@provider.example/api?access_token=QACANARYqs',
  accountNumber: '9876543210QACANARY',
  memo: 'QACANARY memo: paid ACME rent 1,234.56',
  secretFile: 'qa-canary-secret-file-value-71b2',
} as const;

const needles = (): string[] =>
  Object.values(CANARIES).flatMap((v) => [v, ...v.split(/[ :/@?=]+/).filter((p) => p.includes('QACANARY') || p.startsWith('qa-canary'))]);

/** Throws naming the canary (never printing the surrounding text) when any canary, or a fragment of one, is present. */
export function assertNoCanary(text: string, where = 'output'): void {
  for (const n of needles()) {
    if (text.includes(n)) throw new Error(`canary leaked into ${where}: ${n.slice(0, 12)}…`);
  }
}
