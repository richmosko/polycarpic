// (C) BetterAuth's cookie scope (seceng #13). On one origin the browser sends a Path=/ cookie to web too, and BetterAuth accepts
// its session cookie for auth actions. Measured: whether every cookie BetterAuth sets can carry Path=/api/auth (so web never
// receives one), which forces the __Secure- prefix (__Host- requires Path=/), and whether the flows still finish when the
// browser sends each cookie only where its Path allows. The handle cookie is excluded: it is meant for web.
import {
  CFG, Jar, Lines, SEEN, SESSION_RE, auth, enrolTotp, get, lit, magicLink, must, oauth, passkeySignIn, post, registerPasskey, seedUser,
  sessionOfJar, sessionsOf, signIn,
} from './lib.mjs';

const L = new Lines('C', "BetterAuth's cookie scope");
const SCOPE = '/api/auth';
const isAuthCookie = (e) => e.reqPath.startsWith(SCOPE) && e.cookie.name !== CFG.handle;
let flows = null; // filled by setup: what each flow ended with

async function driveAll() {
  const r = {};
  const a = await seedUser();
  r.email = await signIn(a.email);
  r.magic = await magicLink((await seedUser()).email);
  r.oauth = await oauth((await seedUser()).email);
  const t = await seedUser();
  r.enrol = await enrolTotp(t);
  r.held = await signIn(t.email);
  r.heldUser = t;
  r.heldVerify = await post(auth('/two-factor/verify-totp'), { code: await r.enrol.totp.next() }, { jar: r.held.jar });
  const p = await seedUser();
  const { jar } = await signIn(p.email);
  try {
    const { pk } = await registerPasskey(p, jar);
    r.passkey = await passkeySignIn(pk);
  } catch (e) { r.passkeyError = e.message; }
  r.signOut = { jar: r.email.jar, res: await post(auth('/sign-out'), {}, { jar: r.email.jar }) };
  return r;
}

const defs = [
  ['path-scoped', `every cookie set under ${SCOPE} carries Path=${SCOPE} and the __Secure- prefix`, async (t) => {
    const seen = SEEN.filter(isAuthCookie);
    t.need(seen.length > 0, 'no cookie was set by any /api/auth response');
    const names = new Map();
    for (const { cookie: c } of seen) names.set(`${c.name} Path=${c.path ?? '(none)'}${c.secure ? ' Secure' : ''}${c.httpOnly ? ' HttpOnly' : ''} SameSite=${c.sameSite ?? '(none)'}`, c);
    for (const [label, c] of names) {
      t.note(`set: ${label}`);
      t.ok(c.path === SCOPE || (c.path ?? '').startsWith(`${SCOPE}/`), `${c.name} is set with Path=${c.path ?? '(none)'}: web receives it`);
      t.ok(c.name.startsWith('__Secure-'), `${c.name} lacks the __Secure- prefix (a path-scoped cookie cannot be __Host-)`);
      t.ok(c.secure, `${c.name} lacks Secure`);
      t.ok(c.httpOnly, `${c.name} lacks HttpOnly`);
    }
    const leaked = ['/', '/settings', '/spike/whoami'].flatMap((p) => [flows.email.jar, flows.held.jar].map((j) => j.header(p)))
      .flatMap((h) => h.split('; ').filter(Boolean).map((kv) => kv.split('=')[0])).filter((n) => n !== CFG.handle);
    t.ok(leaked.length === 0, `a browser would send ${[...new Set(leaked)].join(', ')} to web pages`);
  }],
  ['flows-finish', 'with each cookie sent only where its Path allows, the flows that need a cookie back still finish', async (t) => {
    t.ok(sessionOfJar(flows.oauth.jar), `OAuth callback (state cookie) produced no session: ${flows.oauth.res.status} ${flows.oauth.res.text.slice(0, 100)}`);
    t.ok(flows.heldVerify.status === 200 && sessionOfJar(flows.held.jar), `second-factor verify (two_factor cookie) answered ${flows.heldVerify.status}: ${flows.heldVerify.text.slice(0, 100)}`);
    t.ok(flows.passkey && sessionOfJar(flows.passkey.jar), `passkey sign-in (challenge cookie) produced no session: ${flows.passkeyError ?? flows.passkey?.res.status}`);
    t.ok(flows.signOut.res.status < 400 && !flows.signOut.jar.find(SESSION_RE), `sign-out (session cookie) answered ${flows.signOut.res.status} or left the session cookie in the browser`);
    const rejected = [flows.email, flows.magic, flows.oauth, flows.held].flatMap((f) => f.jar.rejected);
    t.ok(rejected.length === 0, `the browser rules drop: ${rejected.join(', ')}`);
  }],
  ['capped-out-clear', 'the 30-day cap clears the session cookie at the Path it was set on', async (t) => {
    const u = await seedUser();
    const { jar } = await signIn(u.email);
    const s = sessionOfJar(jar);
    t.need(s, 'sign-in gave no session');
    must(`UPDATE public.session SET created_at = now() - interval '31 days' WHERE id = ${lit(s.id)}`);
    const r = await get(auth('/ok'), { jar });
    const clears = r.cookies.filter((c) => SESSION_RE.test(c.name));
    t.note(`capped-out response: ${r.status}; clearing cookies: ${clears.map((c) => `${c.name} Path=${c.path}`).join(', ') || 'none'}`);
    t.ok(sessionsOf(u.id) === 0, 'the capped-out session row survives');
    t.ok(!jar.find(SESSION_RE), 'after the capped-out response the browser still holds the session cookie: the clearing Set-Cookie names a different Path or name');
  }],
  ['host-vs-secure', 'the __Host- versus __Secure- trade-off, as observed (report only)', async (t) => {
    const s = SEEN.filter(isAuthCookie).map((e) => e.cookie).find((c) => SESSION_RE.test(c.name));
    t.need(s, 'no BetterAuth session cookie was observed');
    t.note(`session cookie: ${s.name}, Path=${s.path}. __Host- needs Path=/ and no Domain; __Secure- allows Path=${SCOPE} but also allows a Domain attribute, so a sibling subdomain could set a same-name cookie. The record weighs this (README → record).`);
    return 'report';
  }],
];

L.runAll(defs, async () => { flows = await driveAll(); });
