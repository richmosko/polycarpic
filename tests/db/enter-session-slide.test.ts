// POLY-149c, ruling R4 (N1, seceng build-review §4): app.enter_session's slide writes the session row only when the new expiry is later than
// the old one. At the 30-day cap the slide used to rewrite the row on every page load of the last 6 days. Titles end [red if: <mutation>].
import { beforeAll, describe, expect, it } from 'vitest';
import { cloneMigrated } from './helpers/api';
import { tx } from './helpers/auth-tx';
import { ENTER_SESSION, sessionWithHandle } from './helpers/handle';
import { fixture } from './helpers/second-step';
import { must } from './helpers/sql';

let db: string; let f: ReturnType<typeof fixture>;
beforeAll(() => { db = cloneMigrated(); f = fixture(db, 1495); });
const enter = (handle: string) => tx(db, 'poly_app', async (q) => { await q(ENTER_SESSION, [handle]); }, true);
const state = (id: string) => must(`SELECT xmin::text, updated_at::text, expires_at::text FROM public.session WHERE id = '${id}'`, db).rows[0]!;

describe('N1 the slide writes only when the expiry moves forward', () => {
  it('a session at its 30-day cap (expires_at = created_at + 30 days, 3 days left): two entries leave xmin, updated_at and expires_at unchanged [red if: the UPDATE runs unconditionally inside the 6-day window]', async () => {
    const u = await f.user();
    const s = sessionWithHandle(db, u.id, { createdDaysAgo: 27, expiresInDays: 3 });
    expect(must(`SELECT expires_at = created_at + interval '30 days' FROM public.session WHERE id = '${s.id}'`, db).rows[0]![0], 'fixture is exactly at the cap').toBe('t');
    const before = state(s.id);
    await enter(s.handle); await enter(s.handle);
    expect(state(s.id)).toEqual(before);
  });
  it('control: a session expiring in 5 days, created yesterday, still slides (a write, expires_at = now + 7 days) [red if: the guard blocks every slide]', async () => {
    const u = await f.user();
    const s = sessionWithHandle(db, u.id, { createdDaysAgo: 1, expiresInDays: 5 });
    const before = state(s.id);
    await enter(s.handle);
    const after = state(s.id);
    expect(after[0], 'the row was rewritten').not.toBe(before[0]);
    expect(Number(must(`SELECT extract(epoch FROM (expires_at - now())) / 86400 FROM public.session WHERE id = '${s.id}'`, db).rows[0]![0])).toBeGreaterThan(6.9);
  });
  it('control: 2 days short of the cap slides to the cap exactly once, then stops writing [red if: it writes past the cap or never settles]', async () => {
    const u = await f.user();
    const s = sessionWithHandle(db, u.id, { createdDaysAgo: 25, expiresInDays: 4 }); // cap is 5 days away; now+7d would pass it
    await enter(s.handle);
    expect(must(`SELECT expires_at = created_at + interval '30 days' FROM public.session WHERE id = '${s.id}'`, db).rows[0]![0]).toBe('t');
    const settled = state(s.id);
    await enter(s.handle);
    expect(state(s.id)).toEqual(settled);
  });
});
