// The spike's stand-in for web: no BetterAuth, no auth secret. 404 on /api/auth/*; GET /spike/whoami resolves the handle cookie
// through the database as poly_app (the lookup definer, the only thing poly_app may call here). Option 2 resolves the BetterAuth
// session cookie instead (see option2.mjs; started by bin/up --option 2).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pg = createRequire(path.join(root, 'packages/db/package.json'))('pg');
const HANDLE = process.env.POLY148_HANDLE_COOKIE ?? '__Host-poly_handle';
const pool = new pg.Pool({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT), database: process.env.DATABASE_NAME, user: process.env.DATABASE_USER,
  password: fs.readFileSync(process.env.DATABASE_PASSWORD_FILE, 'utf8').trim(), max: 4,
});

const cookies = (h) => Object.fromEntries((h ?? '').split(';').map((c) => c.trim()).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; }));
const send = (res, status, body, type = 'application/json') => res.writeHead(status, { 'content-type': type }).end(typeof body === 'string' ? body : JSON.stringify(body));

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://web');
  try {
    if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) return send(res, 404, { message: 'Not found' });
    if (url.pathname === '/spike/whoami') {
      const v = cookies(req.headers.cookie)[HANDLE];
      if (!v) return send(res, 401, { message: 'no handle' });
      const hash = createHash('sha256').update(v, 'utf8').digest();
      const r = await pool.query('SELECT user_id, session_id FROM app.spike_session_of_handle($1)', [hash]);
      if (!r.rows[0]) return send(res, 401, { message: 'unknown handle' });
      return send(res, 200, { userId: r.rows[0].user_id, sessionId: r.rows[0].session_id });
    }
    if (url.pathname === '/spike/cookies') return send(res, 200, { names: Object.keys(cookies(req.headers.cookie)) }); // names only, never values
    if (url.pathname === '/') {
      // web's own page, under web's CSP (apps/web/vite.config.ts kit.csp): the script the measurements run is the page's, same origin as the sign-in page
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
      return res.end('<!doctype html><html><head><meta charset="utf-8"><title>web</title></head><body>web</body></html>');
    }
    if (url.pathname === '/spike/sw.js') {
      // a compromised web can answer its own script path with a wide scope
      res.writeHead(200, { 'content-type': 'text/javascript', 'service-worker-allowed': '/' });
      return res.end(`self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => { if (new URL(e.request.url).pathname === '/sign-in') e.respondWith(new Response('<!doctype html><title>altered</title><body data-altered="yes"><input id="password" type="password"></body>', { headers: { 'content-type': 'text/html' } })); });`);
    }
    return send(res, 404, { message: 'Not found' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { message: 'error' });
  }
}).listen(Number(process.env.WEB_PORT), '127.0.0.1');
