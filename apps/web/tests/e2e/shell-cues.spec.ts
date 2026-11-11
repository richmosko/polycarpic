// POLY-128 V6 (rail expand cue) and V7 (current Theme choice visible); ruling file, Verdict section, items V6/V7.
// Reads: data-testid "sidebar-toggle" / "brand-mark" as in shell-geometry.spec.ts; the open icon is found by Lucide
// panel-left-open's chevron path data (icons.ts `panelOpen`: m14 9 3 3-3 3), the tooltip by role=tooltip.
// Expected colours come from src/app.css (tokens.test.ts ties it to DESIGN); no hex in here.
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
  const h = v.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!h) return v.replace(/\s+/g, ' ').replace(/,(\S)/g, ', $1');
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
}

test.use({ viewport: { width: 1409, height: 840 } });
const openIcon = (page: Page) => page.getByTestId('sidebar-toggle').locator('svg:has(path[d="m14 9 3 3-3 3"])');
const style = (page: Page, sel: string, prop: 'backgroundColor' | 'color') => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e)[p as 'color'], prop);

for (const mode of ['light', 'dark'] as const) {
  test.describe(`V6 rail expand cue, ${mode}`, () => {
    test.beforeEach(async ({ page, context }) => {
      if (mode === 'dark') await context.addCookies([{ name: 'poly-theme', value: 'dark', url: base }]);
      await page.goto(`${base}/dashboard`);
      await page.waitForLoadState('networkidle');
      await page.getByTestId('sidebar-toggle').click();
      await expect.poll(async () => (await page.getByTestId('sidebar').boundingBox())!.width).toBeLessThan(90);
      await page.mouse.move(700, 500);
    });

    test('at rest: mark shown, open icon and tooltip absent  [red if: the cue shows without hover/focus]', async ({ page }) => {
      await expect(page.getByTestId('brand-mark')).toBeVisible();
      await expect(openIcon(page)).toBeHidden();
      await expect(page.getByRole('tooltip')).toHaveCount(0);
    });

    test('hover swaps the mark for panel-left-open on --sidebar-accent, tooltip right of the button  [red if: no swap, wrong fill, tooltip missing/left/wrong ink]', async ({ page }) => {
      const btn = page.getByTestId('sidebar-toggle');
      await btn.hover();
      await expect(openIcon(page)).toBeVisible();
      await expect(page.getByTestId('brand-mark')).toBeHidden();
      expect(await style(page, '[data-testid="sidebar-toggle"]', 'backgroundColor')).toBe(token(mode, '--sidebar-accent'));
      const tip = page.getByRole('tooltip');
      await expect(tip).toBeVisible();
      await expect(tip).toHaveText('Expand sidebar');
      const b = (await btn.boundingBox())!;
      const t = (await tip.boundingBox())!;
      expect(t.x, 'tooltip opens to the right').toBeGreaterThanOrEqual(b.x + b.width - 1);
      expect(await style(page, '[role="tooltip"]', 'backgroundColor')).toBe(token(mode, '--foreground'));
      expect(await style(page, '[role="tooltip"]', 'color')).toBe(token(mode, '--background'));
    });

    test('keyboard focus does the same  [red if: the cue is hover-only]', async ({ page }) => {
      await page.getByTestId('sidebar').getByRole('link', { name: 'Dashboard', exact: true }).focus();
      await page.keyboard.press('Shift+Tab');
      await expect(page.getByTestId('sidebar-toggle')).toBeFocused();
      await expect(openIcon(page)).toBeVisible();
      await expect(page.getByTestId('brand-mark')).toBeHidden();
      await expect(page.getByRole('tooltip')).toHaveText('Expand sidebar');
    });

    test('moving away restores the mark  [red if: the cue sticks]', async ({ page }) => {
      await page.getByTestId('sidebar-toggle').hover();
      await expect(openIcon(page)).toBeVisible();
      await page.mouse.move(700, 500);
      await expect(page.getByTestId('brand-mark')).toBeVisible();
      await expect(openIcon(page)).toBeHidden();
    });
  });
}

test.describe('V7 current Theme choice is visible', () => {
  const cases: [string | undefined, string][] = [[undefined, 'Light'], ['dark', 'Dark'], ['auto', 'Auto']];
  for (const [cookie, label] of cases) {
    test(`cookie ${cookie ?? 'unset'}: only ${label} is checked and shows a check  [red if: no indicator, indicator on every item, or aria-checked wrong]`, async ({ page, context }) => {
      if (cookie) await context.addCookies([{ name: 'poly-theme', value: cookie, url: base }]);
      await page.goto(`${base}/dashboard`);
      await page.waitForLoadState('networkidle');
      await page.getByTestId('sidebar').getByRole('button', { name: 'Account' }).click();
      const items = page.getByRole('menuitemradio');
      await expect(items).toHaveText(['Light', 'Dark', 'Auto']);
      const rows = await items.evaluateAll((els) =>
        els.map((e) => {
          const svg = e.querySelector('svg');
          const r = svg?.getBoundingClientRect();
          const cs = svg ? getComputedStyle(svg) : null;
          return { text: e.textContent?.trim(), checked: e.getAttribute('aria-checked'), shown: !!r && r.width * r.height > 0 && cs!.visibility !== 'hidden' && cs!.display !== 'none' };
        }),
      );
      expect(rows.filter((r) => r.checked === 'true').map((r) => r.text)).toEqual([label]);
      expect(rows.filter((r) => r.shown).map((r) => r.text), 'indicator only on the checked item').toEqual([label]);
    });
  }
});
