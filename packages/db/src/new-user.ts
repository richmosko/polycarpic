// The new-user step (POLY-87 ruling R4; SECURITY C-84). Confined by layers.json to context.ts: nothing else may import it.
// The database decides (app.enter_new_user); this file runs that one statement and nothing else.
import type pg from 'pg';

export async function enterNewUserOn(client: pg.PoolClient, id: string): Promise<void> {
  await client.query('SELECT app.enter_new_user($1)', [id]);
}
