// POLY-128 criteria 2-4 (ruling R3, R4, R6, R8, R10): the shell, with no session, in light and dark.
// Contract with the builder (ids the spec reads): data-testid="sidebar" on the sidebar root, "top-row" on the single top row,
// "sidebar-toggle" on the brand-row collapse control; avatar trigger = button named "Account" inside the sidebar.
// Expected colours are parsed from src/app.css at test time (tokens.test.ts ties that file to DESIGN); no hex in here.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function token(mode: 'light' | 'dark', name: string): string {
  const sel = mode === 'dark' ? '\\.dark' : ':root';
  const block = [...css.matchAll(new RegExp(`(?:^|\\})\\s*${sel}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join('\n');
  const v = block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1]?.trim();
  if (!v) throw new Error(`token ${name} missing in ${mode}`);
  return toRgb(v);
}
// #rrggbb -> rgb(r, g, b); rgba(r, g, b, a) -> rgba(r, g, b, a) as Chromium prints it.
function toRgb(v: string): string {
  const h = v.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (h) return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
  return v.replace(/\s+/g, ' ').replace(/,(\S)/g, ', $1');
}
const bg = (page: Page, id: string) => page.getByTestId(id).evaluate((e) => getComputedStyle(e).backgroundColor);
const fg = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).color);

for (const mode of ['light', 'dark'] as const) {
  test.describe(`shell, ${mode}`, () => {
    test.beforeEach(async ({ context, page }) => {
      if (mode === 'dark') await context.addCookies([{ name: 'poly-theme', value: 'dark', url: base }]);
      await page.goto(`${base}/dashboard`);
    });

    test(`html class and token values on sidebar and top row  [red if: tokens unwired, wrong mode, or a raw colour used]`, async ({ page }) => {
      await expect(page.locator('html')).toHaveClass(mode === 'dark' ? /(^|\s)dark(\s|$)/ : /^(?!.*\bdark\b)/);
      expect(await bg(page, 'sidebar')).toBe(token(mode, '--sidebar'));
      expect(await fg(page, '[data-testid="sidebar"] a')).toBe(token(mode, '--sidebar-foreground'));
      expect(await bg(page, 'top-row')).toBe(token(mode, '--background'));
      expect(await fg(page, '[data-testid="top-row"] h1, [data-testid="top-row"] [data-testid="title"]')).toBe(token(mode, '--foreground'));
    });

    test(`seven nav items in order, current marked, popover at the foot, one top row, no other header  [red if: item missing/reordered, no aria-current, second <header>]`, async ({ page }) => {
      const links = page.getByTestId('sidebar').getByRole('link');
      const names = ['Dashboard', 'Transactions', 'General Ledger', 'Custodial Accounts', 'Allocation', 'Reports', 'Entities'];
      await expect(links).toHaveText(names);
      await expect(page.getByTestId('sidebar').locator('[aria-current="page"]')).toHaveText('Dashboard');
      await expect(page.getByTestId('top-row')).toHaveCount(1);
      expect(await page.locator('header').count()).toBeLessThanOrEqual(1);
      await expect(page.locator('main > :first-child')).toHaveAttribute('data-testid', 'top-row');
      const trigger = page.getByTestId('sidebar').getByRole('button', { name: 'Account' });
      await trigger.click();
      await expect(page.getByRole('menuitem')).toHaveText(['Profile', 'Settings', 'Notifications', 'Preferences', 'Theme', 'Shortcuts', 'Log out']);
    });

    test(`axe: zero A/AA violations on sidebar and top row incl. contrast  [red if: a token pair fails 4.5:1/3:1 or a control lacks a name]`, async ({ page }) => {
      const r = await new AxeBuilder({ page })
        .include('[data-testid="sidebar"]')
        .include('[data-testid="top-row"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
    });

    test(`Tab order: brand control, seven items, avatar trigger, then top row; focus ring visible; Esc returns focus  [red if: order changes, outline none, focus lost on Esc]`, async ({ page }) => {
      const order: string[] = [];
      const seen = async () =>
        page.evaluate(() => {
          const e = document.activeElement as HTMLElement;
          return { id: e.getAttribute('data-testid') ?? e.textContent?.trim() ?? '', outline: getComputedStyle(e).outlineStyle, ow: getComputedStyle(e).outlineWidth, shadow: getComputedStyle(e).boxShadow };
        });
      for (let i = 0; i < 9; i++) {
        await page.keyboard.press('Tab');
        const s = await seen();
        order.push(s.id);
        expect(s.outline !== 'none' || s.shadow !== 'none', `focus ring on ${s.id}`).toBe(true);
      }
      expect(order.slice(0, 8)).toEqual(['sidebar-toggle', 'Dashboard', 'Transactions', 'General Ledger', 'Custodial Accounts', 'Allocation', 'Reports', 'Entities']);
      expect(order[8]).toMatch(/Account/);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();
      await expect(page.getByTestId('sidebar').getByRole('button', { name: 'Account' })).toBeFocused();
    });
  });
}

test('CSP headers (C-07) and root redirect  [red if: script-src gains unsafe-inline, frame-ancestors/object-src missing, / not 307 -> /dashboard]', async ({ request }) => {
  const res = await request.get(`${base}/dashboard`);
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  const script = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';
  expect(script).not.toContain("'unsafe-inline'");
  const root = await request.get(`${base}/`, { maxRedirects: 0 });
  expect(root.status()).toBe(307);
  expect(root.headers()['location']).toMatch(/\/dashboard$/);
});

test('theme item flips the class and writes the cookie  [red if: class not toggled or cookie not set]', async ({ page, context }) => {
  await page.goto(`${base}/dashboard`);
  await page.getByTestId('sidebar').getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Theme' }).click();
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
  expect((await context.cookies(base)).find((c) => c.name === 'poly-theme')?.value).toBe('dark');
});
