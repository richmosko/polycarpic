// POLY-128 visual-leg defects V1-V4 (temp/2026-11-11-lead-poly-128-visual-leg.md; DESIGN sidebar-flow.md, DESIGN index.html l.182).
// Contract ids on top of shell.spec.ts: data-testid="brand-mark" (the seedling mark, an svg or img, visible in both widths).
// Collapsed: the brand-row control (data-testid="sidebar-toggle") collapses; clicking it again expands.
import { expect, test, type Page } from '@playwright/test';

const base = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
const NAMES = ['Dashboard', 'Transactions', 'General Ledger', 'Custodial Accounts', 'Allocation', 'Tax', 'Reports', 'Entities'];
const box = async (page: Page, sel: string) => {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  return b;
};
const sidebar = (page: Page) => page.getByTestId('sidebar');

test.use({ viewport: { width: 1409, height: 840 } });
test.beforeEach(async ({ page }) => {
  await page.goto(`${base}/dashboard`);
  await page.waitForLoadState('networkidle'); // handlers attach after hydration
});

async function collapse(page: Page) {
  await page.getByTestId('sidebar-toggle').click();
  await expect.poll(async () => (await box(page, '[data-testid="sidebar"]')).width).toBeLessThan(90);
  await page.mouse.move(700, 400); // park the pointer: rail asserts are at rest (the V6 hover cue hides the mark)
}

test.describe('V1 collapsed icon rail', () => {
  test('rail is about 64px wide  [red if: collapse does not narrow the sidebar to ~64px]', async ({ page }) => {
    await collapse(page);
    const w = (await box(page, '[data-testid="sidebar"]')).width;
    expect(w).toBeGreaterThanOrEqual(56);
    expect(w).toBeLessThanOrEqual(72);
  });

  test('all eight destinations are visible icons with names, clickable  [red if: a link measures 0x0, has no svg, or no accessible name]', async ({ page }) => {
    await collapse(page);
    for (const name of NAMES) {
      const link = sidebar(page).getByRole('link', { name, exact: true });
      await expect(link, name).toBeVisible();
      const b = (await link.boundingBox())!;
      expect(b.width, `${name} width`).toBeGreaterThanOrEqual(24);
      expect(b.height, `${name} height`).toBeGreaterThanOrEqual(24);
      await expect(link.locator('svg'), `${name} icon`).toHaveCount(1);
    }
    await sidebar(page).getByRole('link', { name: 'Transactions', exact: true }).click();
    await expect(page).toHaveURL(/\/transactions$/);
  });

  test('rail is keyboard reachable: toggle, eight links, then the avatar  [red if: links skipped or not focusable when collapsed]', async ({ page }) => {
    await collapse(page);
    await page.getByTestId('sidebar-toggle').focus();
    const seen: string[] = [];
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Tab');
      seen.push(await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? ''));
    }
    expect(seen.slice(0, 8)).toEqual(NAMES);
    expect(seen[8]).toMatch(/Account/);
  });

  test('foot shows the avatar alone, not clipped text  [red if: the Account trigger shows overflowing text in the rail]', async ({ page }) => {
    await collapse(page);
    const trigger = sidebar(page).getByRole('button', { name: 'Account' });
    await expect(trigger).toBeVisible();
    const m = await trigger.evaluate((e) => {
      const s = (e as HTMLElement).getBoundingClientRect();
      const sb = document.querySelector('[data-testid="sidebar"]')!.getBoundingClientRect();
      const visibleText = [...e.querySelectorAll('*')].some((c) => {
        const r = c.getBoundingClientRect();
        return c.childNodes.length === 1 && c.firstChild?.nodeType === 3 && (c.textContent ?? '').trim().length > 2 && r.width > 0 && getComputedStyle(c).display !== 'none' && getComputedStyle(c).visibility !== 'hidden' && !c.closest('.sr-only');
      });
      return { inside: s.left >= sb.left - 1 && s.right <= sb.right + 1, scrollClip: (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1, visibleText };
    });
    expect(m.inside, 'trigger inside the rail').toBe(true);
    expect(m.scrollClip, 'no clipped overflow').toBe(false);
    expect(m.visibleText, 'no visible label text in the rail').toBe(false);
  });

  test('the mark expands the rail again  [red if: no way back to the expanded sidebar]', async ({ page }) => {
    await collapse(page);
    await page.getByTestId('sidebar-toggle').click();
    await expect.poll(async () => (await box(page, '[data-testid="sidebar"]')).width).toBeGreaterThan(200);
    await expect(sidebar(page).getByRole('link', { name: 'Dashboard' })).toContainText('Dashboard');
  });
});

test.describe('V2 floating card', () => {
  for (const state of ['expanded', 'collapsed'] as const) {
    test(`${state}: 16px gutter on every side, all four corners rounded  [red if: sidebar flush to the viewport or radius 0]`, async ({ page }) => {
      if (state === 'collapsed') await collapse(page);
      const r = await page.getByTestId('sidebar').evaluate((e) => {
        const b = e.getBoundingClientRect();
        const c = getComputedStyle(e);
        return { x: b.left, y: b.top, right: innerWidth - b.right, bottom: innerHeight - b.bottom, radii: [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomRightRadius, c.borderBottomLeftRadius].map(parseFloat) };
      });
      for (const [k, v] of Object.entries({ x: r.x, y: r.y, bottom: r.bottom })) expect(v, `gutter ${k}`).toBeGreaterThanOrEqual(15);
      for (const [k, v] of Object.entries({ x: r.x, y: r.y, bottom: r.bottom })) expect(v, `gutter ${k}`).toBeLessThanOrEqual(17);
      for (const rad of r.radii) expect(rad, 'corner radius').toBeGreaterThan(0);
    });
  }
});

test.describe('V3 brand mark and nav icons', () => {
  test('expanded: mark beside the wordmark, every labelled item has an icon  [red if: mark missing or an item is text only]', async ({ page }) => {
    const mark = page.getByTestId('brand-mark');
    await expect(mark).toBeVisible();
    expect(await mark.evaluate((e) => (e.tagName === 'svg' || e.tagName === 'IMG' ? 1 : e.querySelectorAll('svg,img').length))).toBeGreaterThan(0);
    for (const name of NAMES) {
      const link = sidebar(page).getByRole('link', { name });
      await expect(link, name).toContainText(name);
      await expect(link.locator('svg'), `${name} icon`).toHaveCount(1);
    }
  });
  test('collapsed: the mark is still shown  [red if: mark hidden in the rail]', async ({ page }) => {
    await collapse(page);
    await expect(page.getByTestId('brand-mark')).toBeVisible();
  });
});

test.describe('V4 avatar popover opens to the right', () => {
  for (const state of ['expanded', 'collapsed'] as const) {
    test(`${state}: the menu starts at or beyond the trigger's right edge  [red if: the menu opens above or below inside the sidebar column]`, async ({ page }) => {
      if (state === 'collapsed') await collapse(page);
      const trigger = sidebar(page).getByRole('button', { name: 'Account' });
      await trigger.click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      const t = (await trigger.boundingBox())!;
      const m = (await menu.boundingBox())!;
      expect(m.x, 'menu left edge vs trigger right edge').toBeGreaterThanOrEqual(t.x + t.width - 1);
      // vertically alongside the trigger, not stacked above it
      expect(m.y + m.height, 'menu bottom reaches the trigger row').toBeGreaterThan(t.y);
      expect(m.y, 'menu top is not below the trigger bottom').toBeLessThan(t.y + t.height);
    });
  }
});

test.describe('V5 remembered sidebar state (R3, sidebar-flow.md l.26)', () => {
  const width = async (page: Page) => (await box(page, '[data-testid="sidebar"]')).width;
  test('collapsed survives a reload and a screen change  [red if: state held only in component memory]', async ({ page }) => {
    await collapse(page);
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(await width(page), 'after reload').toBeLessThan(90);
    await sidebar(page).getByRole('link', { name: 'Reports', exact: true }).click();
    await expect(page).toHaveURL(/\/reports$/);
    expect(await width(page), 'after navigation').toBeLessThan(90);
  });
  test('expanded survives a reload after collapse then expand  [red if: the cookie is written only on collapse]', async ({ page }) => {
    await collapse(page);
    await page.getByTestId('sidebar-toggle').click();
    await expect.poll(() => width(page)).toBeGreaterThan(200);
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(await width(page)).toBeGreaterThan(200);
  });
  test('first paint already matches: the server renders the remembered width  [red if: applied only after hydration]', async ({ page, context }) => {
    await collapse(page);
    const p2 = await context.newPage();
    await p2.route('**/*.js', (r) => r.abort()); // no client script: only server HTML can carry the state
    await p2.goto(`${base}/dashboard`);
    expect(await width(p2)).toBeLessThan(90);
  });
});
