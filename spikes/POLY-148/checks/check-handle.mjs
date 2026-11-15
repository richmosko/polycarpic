// (H) The hashed session handle, option 1 of POLY-145 comparison.md §7 point 1: a second random cookie, only sha256(handle) in
// app.session_handle, cascading from session. One named line per path that creates or replaces a session on better-auth 1.7.18.
// [issue] lines are the paths POLY-148 names; [beyond] lines are the other session-creating routes our allowlist leaves open
// (read from the 1.7.18 dist: every internalAdapter.createSession call reachable through AUTH_ROUTES). /two-factor/enable rotates
// only with skipVerificationOnEnable or method otp, neither configured, and /verify-email only with autoSignInAfterVerification: no lines.
// POLY148_OPTION=2 switches the per-path predicate to option 2: the session row stores sha256(token), never the token.
import {
  CFG, Jar, Lines, PW, SESSION_RE, IDP_LOG, auth, enrolTotp, get, handleRow, handleSet, isDeletion, lit, magicLink, must, oauth, one,
  handlesOfUser, passkeySignIn, post, psql, psqlAs, registerPasskey, run, seedInvitation, seedUser, sessionExists, sessionOfJar, sessionsOf, setRecentAuth,
  sha256, sha256hex, signIn, tokenOf, whoami,
} from './lib.mjs';

const OPT2 = CFG.option === '2';
const L = new Lines('H', OPT2 ? 'hashed session token (option 2: symmetric rewrite in the adapter)' : 'hashed session handle (option 1)');
const handleOnly = (v) => Jar.of({ [CFG.handle]: v });

function attrs(t, h) {
  t.ok(h.name.startsWith('__Host-'), `handle cookie name ${h.name} has no __Host- prefix`);
  t.ok(h.secure, 'handle cookie lacks Secure');
  t.ok(h.httpOnly, 'handle cookie lacks HttpOnly');
  t.ok(h.sameSite === 'lax' || h.sameSite === 'strict', `handle cookie SameSite is ${h.sameSite ?? 'absent'}, expected Lax or Strict`);
  t.ok(h.path === '/', `handle cookie Path is ${h.path ?? 'absent'}, expected /`);
  t.ok(!h.domain, `handle cookie carries Domain=${h.domain}`);
  t.ok(h.value.length >= 22, `handle value is ${h.value.length} characters: under 128 bits if base64url`);
  t.note(`handle cookie: ${h.raw.replace(/=[^;]+/, '=<value>')}`);
}

/** The predicate for one response that created or replaced a session. Returns { session, handle }. */
async function issued(t, res, jar) {
  t.need(res.status < 400, `the path answered ${res.status}: ${res.text.slice(0, 160)}`);
  if (res.location) {
    const u = new URL(res.location, CFG.origin);
    t.need(!u.searchParams.has('error') && !u.pathname.endsWith('/error'), `redirected to an error: ${res.location}`);
  }
  const s = sessionOfJar(jar);
  t.need(s, `no BetterAuth session cookie in the jar, or no session row for it (cookies set: ${res.cookies.map((c) => c.name).join(', ') || 'none'}; rejected by the browser rules: ${jar.rejected.join(', ') || 'none'})`);
  if (OPT2) {
    t.ok(s.stored === 'hashed', 'option 2: the session row stores the plain token');
    const w = await whoami(jar);
    t.ok(w.status === 200 && w.json?.sessionId === s.id, `GET /spike/whoami answered ${w.status}; expected 200 for session ${s.id}`);
    return { session: s, handle: null };
  }
  const h = handleSet(res);
  t.need(h, `no ${CFG.handle} cookie on this response (cookies set: ${res.cookies.map((c) => c.name).join(', ') || 'none'})`);
  attrs(t, h);
  t.ok(h.value !== tokenOf(jar.find(SESSION_RE).value), "the handle equals BetterAuth's session token");
  const row = handleRow(h.value);
  t.need(!row.error, `app.session_handle: ${row.error}`);
  t.ok(row.sessionId === s.id, row.sessionId ? `sha256(handle) maps to session ${row.sessionId}, not the new session ${s.id}` : 'no app.session_handle row holds sha256(handle)');
  t.ok(Number(one(`SELECT count(*) FROM app.session_handle h WHERE strpos(h::text, ${lit(h.value)}) > 0`)) === 0, 'app.session_handle stores the plain handle');
  const w = await whoami(handleOnly(h.value));
  t.ok(w.status === 200 && w.json?.userId === s.userId && w.json?.sessionId === s.id,
    `GET /spike/whoami with the handle cookie alone answered ${w.status} ${w.text.slice(0, 100)}; expected 200 for user ${s.userId}, session ${s.id}`);
  return { session: s, handle: h.value };
}

/** seceng #14: the handle rotates with the session; the old pair is dead. */
async function rotated(t, before, after) {
  t.need(before.session, 'no session before the rotation to compare with');
  t.ok(after.session.id !== before.session.id, 'the session id did not change: no rotation happened');
  t.ok(!sessionExists(before.session.id), 'the old session row survives the rotation');
  if (OPT2) return;
  t.ok(after.handle !== before.handle, 'the handle did not rotate with the session');
  t.ok(before.handle && handleRow(before.handle).sessionId === null, 'the old handle still has an app.session_handle row');
  const w = await whoami(handleOnly(before.handle));
  t.ok(w.status === 401, `the old handle still answers GET /spike/whoami with ${w.status}`);
}

let enrolled; // one TOTP user, enrolled through the real routes; reused by lines that need an enrolled user
const enrolledUser = async () => {
  if (!enrolled) { const u = await seedUser(); enrolled = { u, ...(await enrolTotp(u)) }; }
  return enrolled;
};

const defs = [
  ['email', '[issue] POST /api/auth/sign-in/email', async (t) => {
    const u = await seedUser();
    const { res, jar } = await signIn(u.email);
    await issued(t, res, jar);
  }],
  ['magic-link', '[issue] GET /api/auth/magic-link/verify from the mailed link', async (t) => {
    const u = await seedUser();
    const { res, jar } = await magicLink(u.email);
    await issued(t, res, jar);
  }],
  ['oauth-callback', '[issue] GET /api/auth/callback/google (fake Google owned by the check)', async (t) => {
    const u = await seedUser();
    const calls = IDP_LOG.length;
    const { res, jar } = await oauth(u.email);
    t.ok(IDP_LOG.length > calls, 'the service never called the fake Google: its outbound fetch is not redirected (README)');
    await issued(t, res, jar);
  }],
  ['second-factor-totp', '[issue] POST /api/auth/two-factor/verify-totp after a held sign-in', async (t) => {
    const e = await enrolledUser();
    t.need(e.verify.status === 200, `enrolment's first verify answered ${e.verify.status}`);
    const n = sessionsOf(e.u.id);
    const h = handlesOfUser(e.u.id);
    const { res: held, jar } = await signIn(e.u.email);
    t.need(sessionsOf(e.u.id) === n, 'the held sign-in left a session row');
    t.ok(handlesOfUser(e.u.id) === h, 'the held sign-in left an app.session_handle row');
    t.ok(!handleSet(held), 'the held sign-in set a handle cookie');
    const res = await post(auth('/two-factor/verify-totp'), { code: await e.totp.next() }, { jar });
    await issued(t, res, jar);
  }],
  ['totp-first-verify-rotation', '[issue] the session rotation at the first TOTP verify (enrolment)', async (t) => {
    const e = await enrolledUser();
    const before = { session: e.before.session, handle: OPT2 ? null : handleSet(e.before.signRes)?.value };
    t.need(OPT2 || before.handle, 'the enrolment sign-in set no handle cookie, so there is nothing to rotate');
    const after = await issued(t, e.verify, e.jar);
    await rotated(t, before, after);
  }],
  ['refresh', '[issue] session refresh (updateAge passed), driven by GET /spike/whoami then GET /api/auth/ok', async (t) => {
    const u = await seedUser();
    const { res, jar } = await signIn(u.email);
    const b = await issued(t, res, jar);
    const first = handleSet(res);
    must(`UPDATE public.session SET expires_at = now() + interval '5 days', updated_at = now() - interval '2 days' WHERE id = ${lit(b.session.id)}`);
    const left = () => Number(one(`SELECT extract(epoch FROM expires_at - now()) FROM public.session WHERE id = ${lit(b.session.id)}`));
    let by = null;
    let r;
    for (const [label, go] of [['GET /spike/whoami', () => whoami(jar)], ['GET /api/auth/ok', () => get(auth('/ok'), { jar })]]) {
      r = await go();
      if (left() > 6.5 * 86400) { by = label; break; }
    }
    t.need(by, 'no request refreshed the session: neither GET /spike/whoami nor GET /api/auth/ok, with the browser\'s cookies, extended expires_at');
    t.note(`refreshed by ${by}; the session now expires in ${Math.round(left() / 3600)} h`);
    const sc = r.cookies.find((c) => SESSION_RE.test(c.name) && !isDeletion(c));
    t.note(sc ? `the refreshing response re-issued ${sc.name} (Max-Age ${sc.maxAge})` : 'the refreshing response re-issued no BetterAuth session cookie: the browser keeps the sign-in expiry');
    if (OPT2) return;
    const h = handleSet(r);
    if (h) {
      t.ok(handleRow(h.value).sessionId === b.session.id, 'the re-issued handle does not map to the refreshed session');
      if (h.value !== b.handle) t.ok((await whoami(handleOnly(b.handle))).status === 401, 'the handle rotated on refresh but the old one still answers');
    } else {
      t.ok((first?.maxAge ?? 0) >= left() - 60, `after refresh the session outlives the handle cookie: handle Max-Age ${first?.maxAge ?? 'session-only'} s, session expires in ${Math.round(left())} s, and the refreshing response set no handle`);
    }
    t.ok((await whoami(handleOnly(h?.value ?? b.handle))).status === 200, 'after refresh the current handle no longer answers GET /spike/whoami');
  }],
  ['sign-up', '[beyond] POST /api/auth/sign-up/email with a live invitation (autoSignIn)', async (t) => {
    const email = `qa148-signup-${Date.now()}@qa.test`;
    const inv = seedInvitation(email);
    const jar = new Jar();
    const res = await post(auth('/sign-up/email'), { email, password: PW, name: 'QA148 Invited', invitationToken: inv.token }, { jar });
    await issued(t, res, jar);
  }],
  ['backup-code', '[beyond] POST /api/auth/two-factor/verify-backup-code after a held sign-in', async (t) => {
    const e = await enrolledUser();
    t.need(e.backupCodes.length > 0, '/two-factor/enable returned no backup codes');
    const { jar } = await signIn(e.u.email);
    const res = await post(auth('/two-factor/verify-backup-code'), { code: e.backupCodes.shift() }, { jar });
    await issued(t, res, jar);
  }],
  ['two-factor-disable', '[beyond] POST /api/auth/two-factor/disable (step-up; rotates the session)', async (t) => {
    const u = await seedUser();
    const e = await enrolTotp(u);
    const before = { session: sessionOfJar(e.jar), handle: OPT2 ? null : handleSet(e.verify)?.value };
    t.need(before.session, 'the enrolled user has no session to disable from');
    setRecentAuth(before.session.id);
    const res = await post(auth('/two-factor/disable'), { password: PW }, { jar: e.jar });
    const after = await issued(t, res, e.jar);
    await rotated(t, before, after);
  }],
  ['change-password', '[beyond] POST /api/auth/change-password with revokeOtherSessions (rotates the session)', async (t) => {
    const u = await seedUser();
    const { res: r0, jar } = await signIn(u.email);
    const before = { session: sessionOfJar(jar), handle: OPT2 ? null : handleSet(r0)?.value };
    const res = await post(auth('/change-password'), { currentPassword: PW, newPassword: `${PW} changed`, revokeOtherSessions: true }, { jar });
    const after = await issued(t, res, jar);
    await rotated(t, before, after);
  }],
  ['passkey-sign-in', '[beyond] POST /api/auth/passkey/verify-authentication (software passkey)', async (t) => {
    const u = await seedUser();
    const { jar } = await signIn(u.email);
    const { pk } = await registerPasskey(u, jar);
    const { res, jar: j2 } = await passkeySignIn(pk);
    await issued(t, res, j2);
  }],
  ['passkey-register-session', '[beyond] POST /api/auth/passkey/verify-registration with createSession: true', async (t) => {
    const u = await seedUser();
    const { jar } = await signIn(u.email);
    const old = sessionOfJar(jar);
    const { res } = await registerPasskey(u, jar, { createSession: true });
    const now = sessionOfJar(jar);
    if (!now || now.id === old?.id) { t.note('verify-registration created no new session on 1.7.18 with a session present: not a session-creating path here'); return 'report'; }
    await issued(t, res, jar);
  }],
  ['handle-insert-failure', 'report: with the handle INSERT forced to fail, does a sign-in leave a session with no handle?', async (t) => {
    if (OPT2) return 'report';
    const u = await seedUser();
    must(`ALTER TABLE app.session_handle ADD CONSTRAINT qa148_block CHECK (false) NOT VALID`);
    let res;
    try {
      ({ res } = await signIn(u.email));
    } finally {
      must(`ALTER TABLE app.session_handle DROP CONSTRAINT IF EXISTS qa148_block`);
    }
    const orphans = Number(one(`SELECT count(*) FROM public.session s WHERE s.user_id = ${lit(u.id)} AND NOT EXISTS (SELECT 1 FROM app.session_handle h WHERE h.session_id = s.id)`));
    t.note(`sign-in answered ${res.status}; session cookie set: ${res.cookies.some((c) => SESSION_RE.test(c.name) && !isDeletion(c))}; handle cookie set: ${!!handleSet(res)}`);
    t.note(orphans ? `${orphans} session row(s) committed with no handle: the session and its handle are not one transaction (fails safe: web refuses it)` : 'no orphan session: the session and its handle commit or roll back together');
    return 'report';
  }],
  ['sign-out','revocation: POST /api/auth/sign-out kills the handle in the same transaction', async (t) => {
    const u = await seedUser();
    const { res, jar } = await signIn(u.email);
    const b = await issued(t, res, jar);
    const out = await post(auth('/sign-out'), {}, { jar });
    t.ok(out.status < 400, `/sign-out answered ${out.status}`);
    t.ok(!sessionExists(b.session.id), 'the session row survives sign-out');
    if (OPT2) return;
    t.ok(handleRow(b.handle).sessionId === null, 'the handle row survives sign-out (no cascade)');
    t.ok((await whoami(handleOnly(b.handle))).status === 401, 'the handle still answers GET /spike/whoami after sign-out');
    t.note(out.cookies.some((c) => c.name === CFG.handle && isDeletion(c)) ? 'sign-out clears the handle cookie' : 'sign-out leaves the (dead) handle cookie in the browser');
  }],
  ['forgery', 'web accepts only the handle: not the BetterAuth cookie, not a value read from the database or a backup', async (t) => {
    const u = await seedUser();
    const { res, jar } = await signIn(u.email);
    const b = await issued(t, res, jar);
    const ba = jar.only(SESSION_RE);
    t.ok((await whoami(ba)).status === 401, 'GET /spike/whoami accepts the BetterAuth session cookie alone');
    if (OPT2) {
      const stored = one(`SELECT token FROM public.session WHERE id = ${lit(b.session.id)}`);
      const forged = Jar.of({ [jar.find(SESSION_RE).name]: encodeURIComponent(stored) });
      t.ok((await whoami(forged)).status === 401, 'the stored token value, presented as the cookie, is accepted');
      return;
    }
    const h = sha256(Buffer.from(b.handle, 'utf8'));
    for (const [label, v] of [['hex sha256', h.toString('hex')], ['base64url sha256', h.toString('base64url')], ['random', sha256hex(String(Math.random()))]])
      t.ok((await whoami(handleOnly(v))).status === 401, `a handle cookie holding the ${label} is accepted`);
    // The SQL layer (web's own role): no definer poly_app can call resolves a value read from the database. Web hashing in Node
    // and passing the hash makes the stored hash a credential; the definer must take the plain handle and hash it in Postgres.
    const stored = one(`SELECT encode(handle_hash, 'hex') FROM app.session_handle WHERE session_id = ${lit(b.session.id)}`);
    const fns = must(`SELECT p.oid::regprocedure::text, p.proname, n.nspname, format_type(p.proargtypes[0], NULL) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND p.pronargs = 1 AND format_type(p.proargtypes[0], NULL) IN ('bytea', 'text')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'qa148') AND has_function_privilege('poly_app', p.oid, 'EXECUTE')`);
    t.need(psqlAs('poly_app', 'SELECT 1').ok, `cannot log in as poly_app (README: password qa-poly_app over TCP in the container): ${psqlAs('poly_app', 'SELECT 1').err.split('\n')[0]}`);
    t.note(`definers poly_app can call with one bytea or text argument: ${fns.map((f) => f[0]).join(', ') || 'none'}`);
    for (const [sig, name, nsp, type] of fns) {
      const arg = type === 'bytea' ? `decode('${stored}', 'hex')` : `'${stored}'`;
      const r = psqlAs('poly_app', `BEGIN; SELECT * FROM "${nsp}"."${name}"(${arg}); ROLLBACK;`);
      t.ok(!(r.out.includes(b.session.id) || r.out.includes(b.session.userId)), `${sig}, called as poly_app with the stored handle_hash, returns the user or session: a hash from a backup is a credential`);
    }
    const dump = run('docker', ['exec', CFG.container, 'pg_dump', '-U', 'postgres', '-d', CFG.db, '--data-only']);
    t.need(dump.code === 0, `pg_dump failed: ${dump.err.slice(0, 160)}`);
    t.ok(!dump.out.includes(b.handle), 'a data-only pg_dump (a backup) contains the plain handle');
    t.note(dump.out.includes(tokenOf(jar.find(SESSION_RE).value)) ? 'the backup holds the plain BetterAuth token (expected under option 1: it needs the auth secret to present)' : 'the backup holds no plain BetterAuth token');
  }],
];

L.runAll(defs, () => { if (!psql('SELECT 1 FROM public.session LIMIT 1').ok) throw new Error('public.session is not readable as postgres'); });
