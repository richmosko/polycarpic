// (b) BetterAuth's generated Drizzle schema migrates cleanly in the same chain.
import { Checker, needChain, q } from './lib.mjs';

const t = new Checker('b', "BetterAuth's core tables migrate in the same chain (applied by poly_migrator, owned by poly_owner)");
const s = needChain(t, { needGen2: true });
t.ok(s.h1 === s.h2, 'second generate is not clean: BetterAuth tables and the rest of the chain disagree');
const norm = (x) => x.toLowerCase().replace(/_/g, '');
const want = {
  user: ['id', 'name', 'email', 'emailVerified', 'image', 'createdAt', 'updatedAt'],
  session: ['id', 'expiresAt', 'token', 'createdAt', 'updatedAt', 'ipAddress', 'userAgent', 'userId'],
  account: ['id', 'accountId', 'providerId', 'userId', 'accessToken', 'refreshToken', 'idToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt', 'scope', 'password', 'createdAt', 'updatedAt'],
  verification: ['id', 'identifier', 'value', 'expiresAt', 'createdAt', 'updatedAt'],
};
const log = q(`select identity from qa_harness.ddl_log where tag='CREATE TABLE' and login='poly_migrator' and at >= '${s.tMigrate}'`).rows.map((r) => r[0]);
for (const [tbl, cols] of Object.entries(want)) {
  const have = q(`select attname from pg_attribute where attrelid = to_regclass('public."${tbl}"') and attnum > 0 and not attisdropped`).rows.map((r) => norm(r[0]));
  if (!have.length) { t.ok(false, `table public."${tbl}" does not exist after migrate`); continue; }
  const missing = cols.filter((c) => !have.includes(norm(c)));
  t.ok(!missing.length, `public."${tbl}" lacks BetterAuth columns: ${missing.join(', ')}`);
  const o = q(`select pg_get_userbyid(relowner) from pg_class where oid = to_regclass('public."${tbl}"')`).rows[0][0];
  t.ok(o === 'poly_owner', `public."${tbl}" is owned by ${o}, expected poly_owner`);
  t.ok(log.includes(`public.${tbl}`) || log.includes(`public."${tbl}"`), `public."${tbl}" was not created by poly_migrator during bin/migrate (event-trigger log)`);
}
t.done();
