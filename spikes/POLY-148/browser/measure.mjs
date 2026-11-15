// Each line says CONFIRMED when the expectation stated in it held, REFUTED when not.
// POLY-148 RECORD.md §2: same-origin reach, measured in Chromium. Run after bin/up:  node spikes/POLY-148/browser/measure.mjs
// "Web's script" is page.evaluate on web's page at /: main world, same origin, under web's CSP, which is what a persistent compromise of web runs.
// The sign-in page is served by the service (Caddy routes /sign-in there). Cookies are never read; nothing here touches document.cookie.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { chromium } = createRequire(path.join(root, 'apps/web/package.json'))('@playwright/test');
const ORIGIN = 'http://127.0.0.1:58480';
const ORIGIN_SW = 'http://127.0.0.1:58490';
const out = [];
const report = (id, ok, detail) => { out.push({ id, ok }); console.log(`${ok ? 'CONFIRMED' : 'REFUTED'}  ${id}  ${detail}`); };
const browser = await chromium.launch();
const fresh = async (origin) => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await page.goto(`${origin}/`); return { ctx, page }; };

// (a) window.open('/sign-in'): does web's script get the sign-in page's DOM, and the password as it is typed?
{
  const { ctx, page } = await fresh(ORIGIN);
  const popup = page.waitForEvent('popup', { timeout: 5000 });
  await page.evaluate(() => { window.__w = window.open('/sign-in'); });
  const p = await popup;
  await p.waitForLoadState('load');
  const r = await page.evaluate(async () => {
    const w = window.__w;
    for (let i = 0; i < 50 && !(w.document.readyState === 'complete' && w.document.querySelector('#password')); i++) await new Promise((r) => setTimeout(r, 50));
    const input = w.document.querySelector('#password');
    window.__seen = [];
    input.addEventListener('input', (e) => window.__seen.push(e.target.value));
    return { dom: !!input, title: w.document.title };
  });
  await p.fill('#password', 'typed-secret-1');
  const seen = await page.evaluate(() => window.__seen);
  report('B.a-window-open', r.dom && seen.at(-1) === 'typed-secret-1', `web's script reached the sign-in page's DOM (title ${r.title}) and read the typed value: ${JSON.stringify(seen.at(-1))}. The page's CSP sends frame-ancestors 'none'; window.open is not framing, so it does not apply.`);
  await ctx.close();
}

// (b) <iframe src="/sign-in">: with frame-ancestors 'none' on the service's page, and the control without it.
for (const [label, q] of [['frame-ancestors none', ''], ['control, no frame-ancestors', '?csp=open']]) {
  const { ctx, page } = await fresh(ORIGIN);
  const r = await page.evaluate(async (query) => {
    const f = document.createElement('iframe');
    f.src = `/sign-in${query}`;
    document.body.appendChild(f);
    await new Promise((res) => { f.onload = res; setTimeout(res, 3000); });
    let doc = null; let err = null;
    try { doc = f.contentDocument; } catch (e) { err = String(e); }
    return { reached: !!doc?.querySelector('#password'), url: doc?.URL ?? null, err };
  }, q);
  const blocked = label.startsWith('frame');
  report(`B.b-iframe (${label})`, blocked ? !r.reached : r.reached,
    blocked ? `the iframe ${r.reached ? 'WAS' : 'was not'} reachable by web's script (document url ${r.url ?? 'none'}); frame-ancestors 'none' ${r.reached ? 'does not stop it' : 'stops it'}`
      : `control: without frame-ancestors the iframe ${r.reached ? 'is' : 'is not'} reachable, so the block above is the CSP's doing`);
  await ctx.close();
}

// (c) a service worker registered by web with scope / that rewrites /sign-in; then the same behind the Caddy that refuses Service-Worker: script.
for (const [label, origin, expectAltered] of [['no Caddy rule', ORIGIN, true], ['Caddy refuses Service-Worker: script', ORIGIN_SW, false]]) {
  const { ctx, page } = await fresh(origin);
  const reg = await page.evaluate(async () => {
    try {
      const r = await navigator.serviceWorker.register('/spike/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      return { registered: true, scope: r.scope };
    } catch (e) { return { registered: false, err: String(e).slice(0, 120) }; }
  });
  let altered = false;
  if (reg.registered) {
    const p2 = await ctx.newPage();
    await p2.goto(`${origin}/sign-in`);
    altered = (await p2.locator('body[data-altered="yes"]').count()) === 1;
  }
  report(`B.c-service-worker (${label})`, expectAltered ? reg.registered && altered : !reg.registered && !altered,
    `registered ${reg.registered}${reg.err ? ` (${reg.err})` : ` at scope ${reg.scope}`}; /sign-in served altered by the worker: ${altered}`);
  await ctx.close();
}

// (d) cookie scope in a real browser: which cookies Chromium stores and which it sends to web versus the service.
{
  const { seedUser, PW } = await import(path.join(root, 'spikes/POLY-148/checks/lib.mjs'));
  const u = await seedUser();
  const { ctx, page } = await fresh(ORIGIN);
  const res = await page.evaluate(async ({ email, pw }) => {
    const r = await fetch('/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
    return r.status;
  }, { email: u.email, pw: PW });
  const stored = (await ctx.cookies()).map((c) => `${c.name} Path=${c.path} Secure=${c.secure} HttpOnly=${c.httpOnly} SameSite=${c.sameSite}`);
  const toWeb = await page.evaluate(async () => (await (await fetch('/spike/cookies')).json()).names);
  const toAuth = await page.evaluate(async () => (await (await fetch('/api/auth/ok')).status));
  report('B.d-cookies-stored', res === 200 && stored.length === 2, `sign-in ${res}; Chromium stored: ${stored.join(' | ')}`);
  report('B.d-cookies-sent-to-web', toWeb.length === 1 && toWeb[0] === '__Host-poly_handle', `web received cookie names ${JSON.stringify(toWeb)} (expected only the handle); /api/auth/ok answered ${toAuth}`);
  await ctx.close();
}
await browser.close();
process.exit(out.every((x) => x.ok) ? 0 : 1);
