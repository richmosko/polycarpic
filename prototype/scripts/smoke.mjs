// Smoke: every route at 960 and 1280, light and dark. Needs `npm run dev` running.
// Fails on console errors, page overflow, or in-card overflow. CHROME=/path overrides detection.
import puppeteer from 'puppeteer-core';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';

const base = process.env.BASE || 'http://localhost:5173';
const routes = readdirSync(new URL('../src/routes', import.meta.url), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name).sort();
const cands = [
  process.env.CHROME,
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
];
const executablePath = cands.find((c) => c && existsSync(c));
if (!executablePath) { console.error('no Chrome found; set CHROME=/path'); process.exit(2); }

const browser = await puppeteer.launch({ executablePath, headless: true });
let bad = 0;
for (const r of routes) {
  for (const w of [960, 1280]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: 800 });
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      page.on('pageerror', (e) => errs.push(String(e)));
      await page.evaluateOnNewDocument((t) => localStorage.setItem('theme', t), theme);
      await page.goto(`${base}/${r}`, { waitUntil: 'networkidle0' });
      const o = await page.evaluate(() => {
        const de = document.documentElement;
        const cards = [...document.querySelectorAll('.card')].filter((c) => c.scrollWidth > c.clientWidth + 1).length;
        return { page: Math.max(de.scrollWidth, document.body.scrollWidth) - innerWidth, cards, dark: de.classList.contains('dark') };
      });
      const problems = [...errs, ...(o.page > 0 ? [`page overflow ${o.page}px`] : []), ...(o.cards ? [`${o.cards} card(s) overflow`] : []), ...(o.dark !== (theme === 'dark') ? ['theme not applied'] : [])];
      if (problems.length) { bad++; console.log(`FAIL ${r} ${w} ${theme}: ${problems.join(' | ')}`); }
      await page.close();
    }
  }
}
await browser.close();
console.log(bad ? `${bad} failing combos` : `ok: ${routes.length} routes x 4`);
process.exit(bad ? 1 : 0);
