// Shared harness for the POLY-148 checks (POLY-148a). Zero npm dependencies of its own: HTTP through fetch, the catalog
// through `docker exec psql`, better-auth's own password hash loaded from the workspace pin (packages/auth). The checks own
// the mail sink and the fake Google; the spike owns everything behind the ports in README.md.
import { spawnSync } from 'node:child_process';
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign as edSign } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SPIKE = path.resolve(HERE, '..');
export const ROOT = path.resolve(SPIKE, '..', '..');
export const CFG = {
  origin: process.env.POLY148_ORIGIN ?? 'http://127.0.0.1:58480',
  web: process.env.POLY148_WEB ?? 'http://127.0.0.1:58481',
  service: process.env.POLY148_SERVICE ?? 'http://127.0.0.1:58482',
  container: process.env.POLY148_PG_CONTAINER ?? 'poly148-pg',
  db: process.env.POLY148_DB ?? 'poly148',
  mailPort: 58489,
  idpPort: 58488,
  handle: process.env.POLY148_HANDLE_COOKIE ?? '__Host-poly_handle',
  option: process.env.POLY148_OPTION ?? '1',
};
export const PW = 'qa148 correct horse battery staple';
export const BA_TABLES = ['public.user', 'public.session', 'public.account', 'public.verification', 'public.two_factor', 'public.passkey'];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const b64u = (b) => Buffer.from(b).toString('base64url');
export const sha256 = (b) => createHash('sha256').update(b).digest();
export const sha256hex = (s) => sha256(Buffer.from(s, 'utf8')).toString('hex');

// ---------- database (superuser, through the container) ----------
const SEP = '\u001f';
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 300_000, ...opts });
  return { code: r.status ?? (r.error ? 127 : 1), out: r.stdout ?? '', err: (r.stderr ?? '') + (r.error ? String(r.error) : '') };
}
export function psql(sql) {
  const r = run('docker', ['exec', '-i', CFG.container, 'psql', '-X', '-q', '-At', '-F', SEP, '-v', 'ON_ERROR_STOP=1',
    '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', CFG.db, '-f', '-'], { input: sql });
  const m = /ERROR:\s+([0-9A-Z]{5}):/.exec(r.err);
  return { ok: r.code === 0, rows: r.out.split('\n').filter((l) => l.length).map((l) => l.split(SEP)), sqlstate: m?.[1] ?? null, err: r.err.trim() };
}
export function must(sql) {
  const r = psql(sql);
  if (!r.ok) throw new Error(`SQL failed: ${r.err.split('\n')[0]} :: ${sql.trim().slice(0, 120)}`);
  return r.rows;
}
export const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
export const one = (sql) => must(sql)[0]?.[0] ?? null;

// ---------- cookies: a browser-shaped jar (RFC 6265 path match, prefix rules, deletion) ----------
export const SEEN = []; // every Set-Cookie any check received: { reqPath, cookie }
export function parseSetCookie(sc) {
  const [kv, ...rest] = sc.split(';');
  const i = kv.indexOf('=');
  const c = { name: kv.slice(0, i).trim(), value: kv.slice(i + 1).trim(), raw: sc, path: null, domain: null, maxAge: null, expires: null, secure: false, httpOnly: false, sameSite: null };
  for (const a of rest) {
    const [k, ...v] = a.split('=');
    const key = k.trim().toLowerCase();
    const val = v.join('=').trim();
    if (key === 'path') c.path = val;
    else if (key === 'domain') c.domain = val;
    else if (key === 'max-age') c.maxAge = Number(val);
    else if (key === 'expires') c.expires = new Date(val);
    else if (key === 'secure') c.secure = true;
    else if (key === 'httponly') c.httpOnly = true;
    else if (key === 'samesite') c.sameSite = val.toLowerCase();
  }
  return c;
}
export const isDeletion = (c) => c.value === '' || (c.maxAge !== null && c.maxAge <= 0) || (c.expires && c.expires.getTime() <= Date.now());
const defaultPath = (p) => (p.lastIndexOf('/') <= 0 ? '/' : p.slice(0, p.lastIndexOf('/')));
const pathMatch = (req, cp) => req === cp || (req.startsWith(cp) && (cp.endsWith('/') || req[cp.length] === '/'));

export class Jar {
  constructor() { this.c = new Map(); this.rejected = []; }
  static of(pairs) { const j = new Jar(); for (const [name, value] of Object.entries(pairs)) j.c.set(`${name}|/`, { name, value, path: '/' }); return j; }
  store(setCookies, reqPath) {
    for (const sc of setCookies) {
      const c = parseSetCookie(sc);
      const p = c.path && c.path.startsWith('/') ? c.path : defaultPath(reqPath);
      // a browser drops a prefixed cookie that breaks its prefix's rule
      if (c.name.startsWith('__Host-') && !(c.secure && c.path === '/' && !c.domain)) { this.rejected.push(`${c.name} (Path=${c.path}, Secure=${c.secure}, Domain=${c.domain})`); continue; }
      if (c.name.startsWith('__Secure-') && !c.secure) { this.rejected.push(`${c.name} (no Secure)`); continue; }
      const key = `${c.name}|${p}`;
      if (isDeletion(c)) this.c.delete(key);
      else this.c.set(key, { name: c.name, value: c.value, path: p });
    }
  }
  header(reqPath) {
    return [...this.c.values()].filter((c) => pathMatch(reqPath, c.path)).sort((a, b) => b.path.length - a.path.length).map((c) => `${c.name}=${c.value}`).join('; ');
  }
  get(name) { for (const c of this.c.values()) if (c.name === name) return c.value; return null; }
  find(re) { for (const c of this.c.values()) if (re.test(c.name)) return c; return null; }
  without(re) { const j = new Jar(); for (const [k, c] of this.c) if (!re.test(c.name)) j.c.set(k, { ...c }); return j; }
  only(re) { const j = new Jar(); for (const [k, c] of this.c) if (re.test(c.name)) j.c.set(k, { ...c, path: '/' }); return j; }
}
export const SESSION_RE = /session_token$/;

// ---------- HTTP ----------
export async function http2(method, p, { body, jar, base = CFG.origin, headers = {} } = {}) {
  const u = new URL(p, base);
  const h = { ...headers };
  if (method !== 'GET' && method !== 'HEAD') h.origin ??= CFG.origin;
  if (body !== undefined) h['content-type'] ??= 'application/json';
  const cookie = jar?.header(u.pathname);
  if (cookie) h.cookie = cookie;
  let res;
  try {
    res = await fetch(u, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  } catch (e) {
    throw new Error(`${method} ${u.href} unreachable (${e.cause?.code ?? e.message})`);
  }
  const setCookies = res.headers.getSetCookie();
  for (const sc of setCookies) SEEN.push({ reqPath: u.pathname, base, cookie: parseSetCookie(sc) });
  jar?.store(setCookies, u.pathname);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json, setCookies, cookies: setCookies.map(parseSetCookie), location: res.headers.get('location') };
}
export const get = (p, o) => http2('GET', p, o);
export const post = (p, body, o = {}) => http2('POST', p, { ...o, body });
export const auth = (p) => `/api/auth${p}`;

// ---------- check-owned servers: the mail sink and the fake Google ----------
export const MAILS = [];
export const IDP_LOG = [];
const listen = (srv, port) => new Promise((res, rej) => { srv.once('error', rej); srv.listen(port, '127.0.0.1', () => res(srv)); });
const readBody = (req) => new Promise((res) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => res(d)); });
export const oauthCode = (email) => `qa148.${b64u(email)}`;
const emailOfCode = (code) => Buffer.from(String(code).replace(/^at-/, '').replace(/^qa148\./, ''), 'base64url').toString();
function idToken(email) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: `sub-${email}`, email, email_verified: true, name: 'QA148 Oauth', iss: 'https://accounts.google.com', aud: 'qa-google', iat: now, exp: now + 3600 };
  return `${b64u('{"alg":"none","typ":"JWT"}')}.${b64u(JSON.stringify(claims))}.`;
}
export async function startSinks() {
  const mail = http.createServer(async (req, res) => {
    const body = await readBody(req);
    try { MAILS.push(JSON.parse(body)); res.writeHead(204).end(); } catch { res.writeHead(400).end(); }
  });
  const idp = http.createServer(async (req, res) => {
    const body = await readBody(req);
    IDP_LOG.push({ method: req.method, url: req.url, body });
    const u = new URL(req.url, 'http://idp');
    const send = (o) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
    if (req.method === 'POST' && /token/.test(u.pathname)) {
      const code = new URLSearchParams(body).get('code') ?? (() => { try { return JSON.parse(body).code; } catch { return null; } })();
      const email = emailOfCode(code);
      return send({ access_token: `at-${b64u(email)}`, id_token: idToken(email), token_type: 'Bearer', expires_in: 3600, scope: 'openid email profile' });
    }
    if (/userinfo/.test(u.pathname)) {
      const email = emailOfCode((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
      return send({ sub: `sub-${email}`, email, email_verified: true, name: 'QA148 Oauth' });
    }
    if (/certs/.test(u.pathname)) return send({ keys: [] });
    return send({});
  });
  try {
    await listen(mail, CFG.mailPort);
    await listen(idp, CFG.idpPort);
  } catch (e) {
    throw new Error(`cannot listen on the check-owned ports ${CFG.mailPort}/${CFG.idpPort}: ${e.code ?? e.message}`);
  }
  return { close: () => { mail.close(); idp.close(); } };
}
export async function waitMail(email, since, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const m = MAILS.slice(since).find((x) => x.email === email);
    if (m) return m;
  }
  throw new Error(`no magic-link mail for ${email} reached the sink at 127.0.0.1:${CFG.mailPort}/mail within ${ms} ms`);
}

// ---------- better-auth from the workspace pin ----------
function pkgDir(fromDir, name) {
  for (let d = fromDir; ; d = path.dirname(d)) {
    const p = path.join(d, 'node_modules', name);
    if (fs.existsSync(p)) return fs.realpathSync(p);
    if (path.dirname(d) === d) return null;
  }
}
export const pinnedVersion = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/auth/package.json'), 'utf8')).dependencies['better-auth'];
/** The better-auth a file at `entry` would load: directly, or through @poly/auth. */
export function betterAuthFrom(entry) {
  let dir = pkgDir(path.dirname(entry), 'better-auth');
  if (!dir) { const pa = pkgDir(path.dirname(entry), '@poly/auth'); dir = pa && pkgDir(pa, 'better-auth'); }
  return dir ? { dir, version: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version } : null;
}
let cryptoMod;
export async function baCrypto() {
  if (cryptoMod) return cryptoMod;
  const dir = pkgDir(path.join(ROOT, 'packages/auth'), 'better-auth');
  if (!dir) throw new Error('better-auth is not installed in packages/auth (run pnpm install at the repo root)');
  const ex = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).exports['./crypto'];
  cryptoMod = await import(pathToFileURL(path.join(dir, typeof ex === 'string' ? ex : ex.default)).href);
  return cryptoMod;
}

// ---------- users and sessions ----------
let n = 0;
export async function seedUser({ secondStepAt = false, password = true } = {}) {
  const email = `qa148-${process.pid}-${++n}-${randomBytes(3).toString('hex')}@qa.test`;
  const id = one(`INSERT INTO public."user" (name, email, email_verified) VALUES ('QA148 User', ${lit(email)}, true) RETURNING id`);
  if (password) {
    const hash = await (await baCrypto()).hashPassword(PW);
    must(`INSERT INTO public.account (account_id, provider_id, user_id, password, updated_at) VALUES (${lit(id)}, 'credential', ${lit(id)}, ${lit(hash)}, now())`);
  }
  if (secondStepAt) must(`UPDATE public."user" SET second_step_at = now() WHERE id = ${lit(id)}`);
  return { id, email };
}
export const tokenOf = (cookieValue) => decodeURIComponent(cookieValue).split('.')[0];
/** The session row for a BetterAuth token, whether stored plain (option 1) or as sha256 (option 2). */
export function sessionByToken(tok) {
  const h = sha256(Buffer.from(tok, 'utf8'));
  const r = must(`SELECT id, user_id, expires_at, created_at, CASE WHEN token = ${lit(tok)} THEN 'plain' ELSE 'hashed' END
    FROM public.session WHERE token IN (${lit(tok)}, ${lit(h.toString('hex'))}, ${lit(h.toString('base64url'))}, ${lit(h.toString('base64'))})`);
  return r[0] ? { id: r[0][0], userId: r[0][1], expiresAt: r[0][2], createdAt: r[0][3], stored: r[0][4] } : null;
}
export const sessionOfJar = (jar) => { const c = jar.find(SESSION_RE); return c ? sessionByToken(tokenOf(c.value)) : null; };
export const sessionExists = (id) => Number(one(`SELECT count(*) FROM public.session WHERE id = ${lit(id)}`)) === 1;
export const sessionsOf = (uid) => Number(one(`SELECT count(*) FROM public.session WHERE user_id = ${lit(uid)}`));
export function handleRow(handle) {
  const r = psql(`SELECT session_id FROM app.session_handle WHERE handle_hash = decode(${lit(sha256hex(handle))}, 'hex')`);
  if (!r.ok) return { error: r.err.split('\n')[0] };
  return { sessionId: r.rows[0]?.[0] ?? null };
}
export const handlesOfUser = (uid) => Number(one(`SELECT count(*) FROM app.session_handle h JOIN public.session s ON s.id = h.session_id WHERE s.user_id = ${lit(uid)}`));
export const setRecentAuth = (sid) => must(`UPDATE public.session SET recent_auth_at = now() WHERE id = ${lit(sid)}`);
export const whoami = (jar) => get('/spike/whoami', { jar });
export const handleSet = (res) => res.cookies.filter((c) => c.name === CFG.handle && !isDeletion(c)).at(-1) ?? null;

export async function signIn(email, jar = new Jar()) {
  const res = await post(auth('/sign-in/email'), { email, password: PW }, { jar });
  return { res, jar };
}
export async function magicLink(email, jar = new Jar()) {
  const since = MAILS.length;
  const start = await post(auth('/sign-in/magic-link'), { email, callbackURL: '/' }, { jar });
  if (start.status >= 400) throw new Error(`/sign-in/magic-link answered ${start.status}: ${start.text.slice(0, 160)}`);
  const m = await waitMail(email, since);
  const u = new URL(m.url);
  return { res: await get(u.pathname + u.search, { jar }), jar };
}
export async function oauth(email, jar = new Jar()) {
  const start = await post(auth('/sign-in/social'), { provider: 'google', callbackURL: '/' }, { jar });
  const loc = start.json?.url ?? start.location;
  if (!loc) throw new Error(`/sign-in/social gave no provider URL (status ${start.status}): ${start.text.slice(0, 160)}`);
  const state = new URL(loc).searchParams.get('state');
  return { res: await get(auth(`/callback/google?code=${encodeURIComponent(oauthCode(email))}&state=${encodeURIComponent(state)}`), { jar }), jar };
}

// ---------- TOTP (RFC 6238, independent of better-auth) ----------
function b32decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export class Totp {
  constructor(uri) { this.key = b32decode(new URL(uri).searchParams.get('secret')); this.last = -1; }
  code(step) {
    const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
    const h = createHmac('sha1', this.key).update(msg).digest();
    const o = h[h.length - 1] & 0xf;
    return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
  }
  async next() { // a code for a step never used before, never ahead of the server's window
    for (;;) {
      const now = Math.floor(Date.now() / 30000);
      const step = Math.max(now, this.last + 1);
      if (step <= now) { this.last = step; return this.code(step); }
      await sleep(1000);
    }
  }
}

// ---------- enrolment through the real routes ----------
/** Signs in, marks the second step (POLY-89's grant does not exist yet), enables TOTP and verifies it: the first-verify rotation. */
export async function enrolTotp(u) {
  const { res: signRes, jar } = await signIn(u.email);
  const before = { session: sessionOfJar(jar), handle: handleSet(signRes)?.value ?? null, signRes };
  if (!before.session) throw new Error(`enrolment: sign-in by email gave no session (status ${signRes.status}): ${signRes.text.slice(0, 160)}`);
  must(`UPDATE public."user" SET second_step_at = now() WHERE id = ${lit(u.id)}`);
  setRecentAuth(before.session.id);
  const en = await post(auth('/two-factor/enable'), { password: PW }, { jar });
  if (en.status !== 200 || !en.json?.totpURI) throw new Error(`/two-factor/enable answered ${en.status}: ${en.text.slice(0, 160)}`);
  const totp = new Totp(en.json.totpURI);
  const verify = await post(auth('/two-factor/verify-totp'), { code: await totp.next() }, { jar });
  return { jar, totp, backupCodes: en.json.backupCodes ?? [], before, verify };
}

// ---------- a software passkey (ES256, attestation "none") ----------
function cbor(v) {
  const head = (major, n) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor: unsupported');
}
export class SoftPasskey {
  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.priv = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    this.id = randomBytes(16);
    this.count = 0;
  }
  register(opt) {
    const rp = sha256(Buffer.from(opt.rp?.id ?? new URL(CFG.origin).hostname));
    const cnt = Buffer.alloc(4); cnt.writeUInt32BE(this.count);
    const len = Buffer.alloc(2); len.writeUInt16BE(this.id.length);
    const authData = Buffer.concat([rp, Buffer.from([0x45]), cnt, Buffer.alloc(16), len, this.id, this.cose]);
    const cd = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: opt.challenge, origin: CFG.origin, crossOrigin: false }));
    const att = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return { id: b64u(this.id), rawId: b64u(this.id), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
      response: { clientDataJSON: b64u(cd), attestationObject: b64u(att), transports: ['internal'] } };
  }
  assert(opt) {
    this.count += 1;
    const rp = sha256(Buffer.from(opt.rpId ?? new URL(CFG.origin).hostname));
    const cnt = Buffer.alloc(4); cnt.writeUInt32BE(this.count);
    const authData = Buffer.concat([rp, Buffer.from([0x05]), cnt]);
    const cd = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: opt.challenge, origin: CFG.origin, crossOrigin: false }));
    const sig = edSign('sha256', Buffer.concat([authData, sha256(cd)]), this.priv);
    return { id: b64u(this.id), rawId: b64u(this.id), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
      response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(sig) } };
  }
}
/** Registers a passkey for a signed-in user (enrolment class: second step marked, recent auth). */
export async function registerPasskey(u, jar, { createSession = false } = {}) {
  const s = sessionOfJar(jar);
  if (!s) throw new Error('passkey registration: the jar has no session');
  must(`UPDATE public."user" SET second_step_at = coalesce(second_step_at, now()) WHERE id = ${lit(u.id)}`);
  setRecentAuth(s.id);
  const opts = await get(auth('/passkey/generate-register-options'), { jar });
  if (opts.status !== 200 || !opts.json?.challenge) throw new Error(`/passkey/generate-register-options answered ${opts.status}: ${opts.text.slice(0, 160)}`);
  const pk = new SoftPasskey();
  const res = await post(auth('/passkey/verify-registration'), { response: pk.register(opts.json), name: 'qa148', ...(createSession ? { createSession: true } : {}) }, { jar });
  if (res.status !== 200) throw new Error(`/passkey/verify-registration answered ${res.status}: ${res.text.slice(0, 160)}`);
  return { pk, res };
}
export async function passkeySignIn(pk, jar = new Jar()) {
  const opts = await get(auth('/passkey/generate-authenticate-options'), { jar });
  if (opts.status !== 200 || !opts.json?.challenge) throw new Error(`/passkey/generate-authenticate-options answered ${opts.status}: ${opts.text.slice(0, 160)}`);
  return { res: await post(auth('/passkey/verify-authentication'), { response: pk.assert(opts.json) }, { jar }), jar };
}

// ---------- invitations (superuser, no-entity row; the token hash from the decoded bytes, as tests/db/helpers/invitation.ts) ----------
export function seedInvitation(email, { expired = false } = {}) {
  const token = randomBytes(32).toString('base64url');
  const hex = sha256(Buffer.from(token, 'base64url')).toString('hex');
  must(`INSERT INTO public.invitation (email, role, token_hash, expires_at) VALUES (${lit(email)}, 'viewer', decode('${hex}', 'hex'), now() + interval '${expired ? '-1 hour' : '7 days'}')`);
  return { token, hex };
}

// ---------- the write log the checks install (who wrote which row, by login role) ----------
export function installWriteLog() {
  must(`
    CREATE SCHEMA IF NOT EXISTS qa148;
    CREATE TABLE IF NOT EXISTS qa148.writes (at timestamptz NOT NULL DEFAULT clock_timestamp(), tbl text, op text, login text, row_id text);
    CREATE OR REPLACE FUNCTION qa148.log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $f$
    BEGIN
      INSERT INTO qa148.writes(tbl, op, login, row_id) VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, TG_OP, session_user,
        CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD)->>'id' ELSE to_jsonb(NEW)->>'id' END);
      RETURN NULL;
    END $f$;
    DO $d$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['public.session', 'public."user"', 'public.invitation', 'public.entity'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS qa148_log ON %s', t);
        EXECUTE format('CREATE TRIGGER qa148_log AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION qa148.log()', t);
      END LOOP;
    END $d$;`);
}
export const writersOf = (tbl, rowId, op = 'INSERT') => must(`SELECT DISTINCT login FROM qa148.writes WHERE tbl = ${lit(tbl)} AND op = ${lit(op)} AND row_id = ${lit(rowId)}`).map((r) => r[0]);

// ---------- reachability ----------
export async function reachable() {
  const out = [];
  for (const [label, base] of [['Caddy (app origin)', CFG.origin], ['web', CFG.web], ['sign-in service', CFG.service]]) {
    try { await fetch(new URL('/', base), { redirect: 'manual' }); } catch (e) { out.push(`${label} at ${base} is not listening (${e.cause?.code ?? e.message})`); }
  }
  const pg = psql('select 1');
  if (!pg.ok) out.push(`database ${CFG.db} in container ${CFG.container} is not reachable: ${pg.err.split('\n')[0]}`);
  return out;
}

// ---------- reporting: named lines ----------
export class Lines {
  constructor(id, title) { this.id = id; this.title = title; this.results = []; }
  async line(name, label, fn) {
    const t = { fails: [], notes: [], ok(c, r) { if (!c) this.fails.push(r); return !!c; }, note(x) { this.notes.push(x); },
      need(c, r) { if (!c) { this.fails.push(r); throw new Stop(); } } };
    let status;
    try {
      const r = await fn(t);
      status = r === 'report' ? 'REPORT' : r === 'unmeasured' ? 'UNMEASURED' : t.fails.length ? 'FAIL' : 'PASS';
    } catch (e) {
      if (!(e instanceof Stop)) t.fails.push(`threw: ${e.message}`);
      status = 'FAIL';
    }
    if (status === 'REPORT' && t.fails.length) status = 'UNMEASURED';
    this.results.push({ name, status });
    console.log(`${status.padEnd(10)} ${this.id}.${name}  ${label}`);
    for (const f of t.fails) console.log(`             - ${f}`);
    for (const x of t.notes) console.log(`             note: ${x}`);
  }
  /** With no harness every line fails for the same named reason. */
  async preflight(names) {
    const down = await reachable();
    if (!down.length) return true;
    for (const [name, label] of names) {
      this.results.push({ name, status: 'FAIL' });
      console.log(`${'FAIL'.padEnd(10)} ${this.id}.${name}  ${label}`);
      for (const d of down) console.log(`             - harness not running: ${d}`);
    }
    return false;
  }
  /** defs: [name, label, fn]. Preflight first; then every line, in order, each independent of the others' result. */
  async runAll(defs, setup) {
    if (await this.preflight(defs.map(([n, l]) => [n, l]))) {
      let sinks;
      try {
        sinks = await startSinks();
        if (setup) await setup();
      } catch (e) {
        for (const [n, l] of defs) await this.line(n, l, (t) => t.need(false, `setup failed: ${e.message}`));
        sinks?.close();
        return this.done();
      }
      for (const [n, l, fn] of defs) await this.line(n, l, fn);
      sinks.close();
    }
    this.done();
  }
  done() {
    const bad = this.results.filter((r) => r.status === 'FAIL' || r.status === 'UNMEASURED').length;
    process.exit(bad ? 1 : 0);
  }
}
class Stop extends Error {}
