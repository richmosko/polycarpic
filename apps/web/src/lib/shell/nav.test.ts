// POLY-128 criterion 2 (R3): the one NAV list, eight items, in ARCH §2.4 / PRD order.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NAV } from './nav.ts';

const routes = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'routes');

describe('NAV', () => {
  it('lists the eight items in order with their hrefs  [red if: item added, dropped, renamed or reordered]', () => {
    expect(NAV.map((n) => [n.label, n.href])).toEqual([
      ['Dashboard', '/dashboard'],
      ['Transactions', '/transactions'],
      ['General Ledger', '/general-ledger'],
      ['Custodial Accounts', '/custodial-accounts'],
      ['Allocation', '/allocation'],
      ['Tax', '/tax'],
      ['Reports', '/reports'],
      ['Entities', '/entities'],
    ]);
  });
  it('every item has a stub page  [red if: an href has no +page.svelte]', () => {
    for (const n of NAV) expect(existsSync(join(routes, n.href, '+page.svelte')), n.href).toBe(true);
  });
});
