// POLY-86 criterion 6: does twoFactor (better-auth 1.7.18) hold /magic-link/verify and /callback/:id for an enrolled user?
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { twoFactor, magicLink } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
const db = { user: [], session: [], account: [], verification: [], twoFactor: [], passkey: [] };
let link;
const tf = twoFactor({ allowPasswordless: true });
const auth = betterAuth({
  secret: 'x'.repeat(40), baseURL: 'http://localhost:3000', database: memoryAdapter(db),
  emailAndPassword: { enabled: true },
  plugins: [tf, magicLink({ sendMagicLink: async ({ url }) => { link = url; } }), passkey()],
});
const email = 'a@example.com';
await auth.api.signUpEmail({ body: { email, password: 'password1234', name: 'A' } });
db.user[0].twoFactorEnabled = true; db.user[0].emailVerified = true;
const H = (h = {}) => new Headers({ origin: 'http://localhost:3000', 'content-type': 'application/json', ...h });
const tokenOf = (sc) => sc.match(/better-auth\.session_token=([^;]+)/)?.[1];
const s0 = db.session.length;
const r1 = await auth.handler(new Request('http://localhost:3000/api/auth/sign-in/email', { method: 'POST', headers: H(), body: JSON.stringify({ email, password: 'password1234' }) }));
const b1 = await r1.json();
console.log('CONTROL sign-in/email:', r1.status, JSON.stringify(b1).slice(0, 60), '| sessions', s0, '->', db.session.length, '| token cookie:', !!tokenOf(r1.headers.get('set-cookie') || ''));
const s1 = db.session.length;
await auth.handler(new Request('http://localhost:3000/api/auth/sign-in/magic-link', { method: 'POST', headers: H(), body: JSON.stringify({ email }) }));
const r2 = await auth.handler(new Request(link, { headers: H() }));
const sc = r2.headers.get('set-cookie') || '';
const tok = tokenOf(sc);
console.log('magic-link/verify:', r2.status, '| sessions', s1, '->', db.session.length, '| token cookie:', !!tok, '| 2fa cookie:', /two_factor/.test(sc));
const g = await auth.api.getSession({ headers: new Headers({ cookie: `better-auth.session_token=${tok}` }) });
console.log('getSession on magic-link cookie:', g ? `full session, twoFactorEnabled=${g.user.twoFactorEnabled}` : null);
const m = tf.hooks.after[0].matcher;
for (const p of ['/sign-in/email', '/callback/:id', '/magic-link/verify', '/sign-in/social', '/passkey/verify-authentication']) console.log('twoFactor after-hook matcher', p, m({ path: p }));
