// @poly/auth (L1): BetterAuth on the routing pool, the route allowlist, the session loader (ARCH §2.2, §3.1c; POLY-86).
import { authFields } from '@poly/db/auth';
import { betterAuth } from 'better-auth';
import { getAuthTables } from 'better-auth/db';
import { authOptions } from './options.ts';
import { widenTwoFactorMatcher } from './second-step.ts';

export const name = '@poly/auth';

export { authOptions, type AuthInput } from './options.ts';
export { AUTH_ROUTES, USER_INSERTING, SIGN_IN_PATHS, matchAuthPath, refusedByHandle, type RouteClass, type TlsMode } from './route-policy.ts';
export { createRoutingPool } from './routing-pool.ts';
export { requireRecentAuth } from './recent-auth.ts';
export { handleAuthRequest, setDefaultAuth } from './handler.ts';
export { loadSession, listSessions, revokeSession, listMySessions, revokeMySession, myLandingEntity, type ShellSession, type LoadedSession, type Identity } from './session.ts';

type Options = ReturnType<typeof authOptions>;

/**
 * Every model BetterAuth reads or writes, plugins included, must resolve each of its fields to the column db/auth maps
 * (criterion 8). A missing or different entry refuses to start, instead of failing on the first query.
 */
function assertFieldsMapped(options: Options): void {
  const tables = getAuthTables(options as never) as Record<string, { modelName: string; fields: Record<string, { fieldName?: string }> }>;
  const maps = authFields as Record<string, { fields: Record<string, string> }>;
  for (const [model, table] of Object.entries(tables)) {
    const map = maps[model];
    if (!map) {
      if (model === 'rateLimit') continue;
      throw new Error(`auth fields: BetterAuth model ${model} has no map in db/auth`);
    }
    for (const [key, field] of Object.entries(table.fields)) {
      if (map.fields[key] === undefined || field.fieldName !== map.fields[key]) {
        throw new Error(`auth fields: ${model}.${key} resolves to ${String(field.fieldName)}, db/auth maps ${String(map.fields[key])}`);
      }
    }
  }
}

/** Builds BetterAuth from `authOptions(input)` and starts it. Throws if the fields map or the second-step hold does not fit. */
export async function createAuth(options: Options) {
  widenTwoFactorMatcher(options.plugins);
  assertFieldsMapped(options);
  const auth = betterAuth(options as never);
  await auth.$context;
  return auth;
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;
