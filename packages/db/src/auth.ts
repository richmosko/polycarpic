// db/auth: importable by packages/auth alone (layers.json). BetterAuth's connection path is neither withTenant nor
// withSystem, so it lives here: the plain poly_app pool, the context-free transaction, and the fields map.
import { getTableColumns, type Table } from 'drizzle-orm';
import * as schema from './schema/auth.ts';

export { withContextFreeTx, clientOf, NestedContextError, ContextNotEmptyError, type Tx } from './context.ts';
export { appPool as authPool } from './pool.ts';

type Fields<T extends Table> = { [K in keyof T['_']['columns']]: string };

/** property key -> column name, read from the Drizzle table, never hand-written. */
export function fieldsOf<T extends Table>(table: T): Fields<T> {
  return Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, col]) => [key, col.name])) as Fields<T>;
}

/** Passed to BetterAuth (plugins included) so its Kysely lookups meet our snake_case columns. */
export const authFields = {
  user: { fields: fieldsOf(schema.user) },
  session: { fields: fieldsOf(schema.session) },
  account: { fields: fieldsOf(schema.account) },
  verification: { fields: fieldsOf(schema.verification) },
};
