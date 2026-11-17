// The operator's second-step reset (POLY-89 R6). The only file that names app.reset_second_step (layers.json reservedLiterals),
// and confined to the CLI's user-reset-mfa.ts. The definer matches the email lower-cased and raises when no user matches.
import { sql, type Tx } from '@poly/db';

export class NoSuchUser extends Error {
  constructor() {
    super('NoSuchUser');
    this.name = 'NoSuchUser';
  }
}

type PgError = { code?: string; cause?: PgError };
const pgError = (e: unknown): PgError => {
  const x = e as PgError;
  return x.code ? x : (x.cause ?? x);
};

/** Clears the user's factors, sessions, challenges and grants; true when it ran. */
export async function resetSecondStep(tx: Tx, args: { email: string }): Promise<boolean> {
  try {
    const r = await tx.execute<{ reset_second_step: boolean }>(sql`SELECT app.reset_second_step(${args.email})`);
    return r.rows[0]?.reset_second_step === true;
  } catch (e) {
    if (pgError(e).code === 'P0002') throw new NoSuchUser();
    throw e;
  }
}
