// (M) Magic link and the second factor (POLY-145 comparison.md §6, open item). Through the service and Caddy: an enrolled user
// (TOTP, enrolled through the real routes; passkey-only, second_step_at set) who signs in by magic link, by email or by OAuth is
// asked for the second factor and leaves with no session row, no session cookie and no handle. A user with no second step gets
// a session on the same path (the control), so a hold that refuses everyone does not pass. A gap here goes to POLY-89.
import { CFG, Lines, SESSION_RE, enrolTotp, isDeletion, magicLink, oauth, seedUser, sessionsOf, signIn } from './lib.mjs';

const L = new Lines('M', 'magic link and the second factor');
const PATHS = { 'magic-link': magicLink, email: (e) => signIn(e), 'oauth-callback': oauth };
let totpUser;

const live = (res, re) => res.cookies.some((c) => re.test(c.name) && !isDeletion(c));

async function held(t, label, u, kind, path) {
  const before = sessionsOf(u.id);
  const { res } = await PATHS[path](u.email);
  t.ok(sessionsOf(u.id) === before, `${label}: ${path} left a session row`);
  t.ok(!live(res, SESSION_RE), `${label}: ${path} set a session cookie`);
  t.ok(!live(res, new RegExp(`^${CFG.handle}$`)), `${label}: ${path} set a handle cookie`);
  if (kind === 'totp') t.ok(live(res, /two_factor$/), `${label}: ${path} set no two_factor cookie (the user cannot finish)`);
  else t.ok(/secondStepRequired|second-step/.test(res.text + (res.location ?? '')), `${label}: ${path} did not send the user to the passkey step (${res.status} ${res.location ?? res.text.slice(0, 80)})`);
  t.note(`${label} on ${path}: ${res.status} ${res.location ? `-> ${res.location}` : res.text.slice(0, 80)}`);
}

const defs = Object.keys(PATHS).map((path) => [path, `an enrolled user signing in by ${path} is asked for the second factor`, async (t) => {
  if (!totpUser) {
    const u = await seedUser();
    const e = await enrolTotp(u);
    t.need(e.verify.status === 200, `TOTP enrolment's verify answered ${e.verify.status}: ${e.verify.text.slice(0, 120)}`);
    totpUser = u;
  }
  await held(t, 'TOTP user', totpUser, 'totp', path);
  await held(t, 'passkey-only user', await seedUser({ secondStepAt: true }), 'passkey', path);
  const c = await seedUser();
  const { res } = await PATHS[path](c.email);
  t.ok(sessionsOf(c.id) === 1 && live(res, SESSION_RE), `control: a user with no second step got no session on ${path} (${res.status}), so the hold refuses everyone`);
}]);

L.runAll(defs);
