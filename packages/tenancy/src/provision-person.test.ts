// POLY-153 R7.2 (seceng §2.1): provisionPerson(tx, name) names the Person from the argument web got out of enter_session's row. Web's SQL
// then names no BetterAuth table: this function no longer reads public."user". A fake transaction records the rendered SQL and parameters.
import { describe, expect, it } from 'vitest';
import { provisionPerson } from './index.ts';

/** Renders a drizzle sql`` object without a dialect: string chunks joined, every other chunk a parameter. */
function render(q: any): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const walk = (c: any): string => {
    if (c && Array.isArray(c.queryChunks)) return c.queryChunks.map(walk).join('');
    if (c && Array.isArray(c.value) && c.value.every((x: unknown) => typeof x === 'string')) return c.value.join('');
    params.push(c);
    return '$';
  };
  return { sql: walk(q), params };
}
function fakeTx(existing: boolean) {
  const seen: { text: string; params: unknown[] }[] = [];
  let finds = 0;
  const tx = {
    execute: async (q: any) => {
      const r = render(q);
      seen.push({ text: r.sql, params: r.params as unknown[] });
      if (/SELECT id FROM public\.entity/.test(r.sql)) { finds++; return { rows: existing || finds > 1 ? [{ id: 'person-1' }] : [] }; }
      return { rows: [] };
    },
  };
  return { tx: tx as any, seen };
}

describe('provisionPerson(tx, name)', () => {
  it('inserts the Person under the given name and reads no BetterAuth table [red if: it still selects public."user" or ignores the name]', async () => {
    const { tx, seen } = fakeTx(false);
    const r = await (provisionPerson as any)(tx, 'Ada Lovelace');
    expect(r).toEqual({ personId: 'person-1', created: true });
    const insert = seen.find((s) => /INSERT INTO public\.entity/.test(s.text))!;
    expect(insert, 'an INSERT must run').toBeDefined();
    expect(insert.params).toContain('Ada Lovelace');
    for (const s of seen) expect(s.text, s.text).not.toMatch(/public\."user"|public\.session|public\.account/);
  });
  it('a NULL, empty or missing name provisions a Person named Person [red if: the fallback is lost]', async () => {
    for (const name of [null, '', undefined, '   ']) {
      const { tx, seen } = fakeTx(false);
      await (provisionPerson as any)(tx, name);
      const insert = seen.find((s) => /INSERT INTO public\.entity/.test(s.text))!;
      expect(insert.params, String(name)).toContain('Person');
    }
  });
  it('an existing Person is returned untouched and nothing is inserted (idempotent) [red if: it inserts twice]', async () => {
    const { tx, seen } = fakeTx(true);
    expect(await (provisionPerson as any)(tx, 'Ada')).toEqual({ personId: 'person-1', created: false });
    expect(seen.some((s) => /INSERT/.test(s.text))).toBe(false);
  });
});
