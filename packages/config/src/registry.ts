// The registry of operator secrets (POLY-85 ruling R3) and the secret-looking-name pattern (R2, S-1).
// One table: a feature adds its row here, in its own PR, and makes it required when it needs it.
export type Service = 'web' | 'worker' | 'migrate';
export const SERVICES: readonly Service[] = ['web', 'worker', 'migrate'];

export interface SecretRow {
  /** The *_FILE variable name. */
  readonly var: string;
  readonly services: readonly Service[];
  readonly required: boolean;
  /** line: exactly one line, no surrounding whitespace. text: any content (a keyring). */
  readonly shape: 'line' | 'text';
}

export const REGISTRY: readonly SecretRow[] = [
  { var: 'DATABASE_PASSWORD_FILE', services: ['web', 'worker', 'migrate'], required: true, shape: 'line' },
  { var: 'AUTH_SECRET_FILE', services: ['web', 'worker'], required: true, shape: 'line' },
  { var: 'CREDENTIAL_KEYRING_FILE', services: ['worker'], required: false, shape: 'text' },
  { var: 'OAUTH_GOOGLE_SECRET_FILE', services: ['web'], required: false, shape: 'line' },
  { var: 'OAUTH_GITHUB_SECRET_FILE', services: ['web'], required: false, shape: 'line' },
  { var: 'RESEND_API_KEY_FILE', services: ['web', 'worker'], required: false, shape: 'line' },
  { var: 'PLAID_SECRET_FILE', services: ['web', 'worker'], required: false, shape: 'line' },
  { var: 'PRICE_API_KEY_FILE', services: ['worker'], required: false, shape: 'line' },
  { var: 'BLS_API_KEY_FILE', services: ['worker'], required: false, shape: 'line' },
];

/** S-2: names a library reads itself (BetterAuth has a dev default secret), plus the POLY-83 DB refusals. Refused in every APP_ENV. */
export const FORBIDDEN_PLAIN = ['BETTER_AUTH_SECRET', 'DATABASE_URL', 'DATABASE_PASSWORD'] as const;

/** The plain-variable stem of each registry row (AUTH_SECRET_FILE -> AUTH_SECRET). */
export const stemOf = (fileVar: string): string => fileVar.replace(/_FILE$/, '');

/**
 * A variable name that looks like it holds a secret (SECURITY 6.2, S-1). Refused in staging and production unless it
 * ends in _FILE. The one source: the Dockerfile test imports this, it does not copy it.
 */
export const SECRET_NAME_RE = /PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|KEYRING|CREDENTIAL|(^|_)(KEY|PASS|PWD|DSN)(_|$)/i;

/** Names that match SECRET_NAME_RE and are not secrets. Short on purpose; seceng reviews every change to it. */
export const SECRET_NAME_ALLOW: readonly string[] = [
  'PWD', // the shell's working directory
];
