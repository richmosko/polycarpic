// (P) The sign-in pages. Sizing, not pass/fail: which process answers /sign-in and /sign-up through Caddy, and the CSP and
// cookies each page is served with. Evidence for RECORD.md's sign-in pages section; it fails only if it cannot measure.
import { createHash } from 'node:crypto';
import { CFG, Lines, get } from './lib.mjs';

const L = new Lines('P', 'the sign-in pages (report)');
const digest = (s) => createHash('sha256').update(s.replace(/nonce="[^"]*"|nonce-[A-Za-z0-9+/=_-]+/g, '')).digest('hex').slice(0, 12);

const defs = ['/sign-in', '/sign-up'].map((p) => [p.slice(1), `who serves ${p}, with which CSP`, async (t) => {
  const via = await get(p);
  t.need(via.status < 500, `GET ${p} through Caddy answered ${via.status}`);
  const [web, svc] = [await get(p, { base: CFG.web }).catch(() => null), await get(p, { base: CFG.service }).catch(() => null)];
  const d = digest(via.text);
  const from = [web && web.status === via.status && digest(web.text) === d ? 'web' : null, svc && svc.status === via.status && digest(svc.text) === d ? 'service' : null].filter(Boolean);
  t.note(`through Caddy: ${via.status}, ${via.text.length} bytes; served by ${from.join(' and ') || 'neither upstream matched byte-for-byte'}`);
  t.note(`CSP: ${via.headers.get('content-security-policy') ?? '(none)'}`);
  t.note(`Set-Cookie: ${via.cookies.map((c) => `${c.name} Path=${c.path}`).join(', ') || '(none)'}`);
  const scripts = [...via.text.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  t.note(`script sources: ${scripts.join(', ') || '(inline or none)'}`);
  return 'report';
}]);

L.runAll(defs);
