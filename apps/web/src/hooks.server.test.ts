// POLY-128 R6: `handle` stamps <html class> from the poly-theme cookie; only `dark` or `light` ever reach the page.
import { describe, expect, it } from 'vitest';
import { handle } from './hooks.server.ts';

async function themed(cookie: string | undefined): Promise<string> {
  const url = new URL('https://app.qa.test/sign-in');
  const event = { url, request: new Request(url), locals: {}, cookies: { get: (n: string) => (n === 'poly-theme' ? cookie : undefined) } };
  const resolve = async (_e: unknown, opts?: { transformPageChunk?: (a: { html: string; done: boolean }) => string }) =>
    new Response(opts?.transformPageChunk?.({ html: '<html class="%poly.theme%">', done: true }) ?? '');
  const res = await (handle as (a: unknown) => Promise<Response>)({ event, resolve });
  return res.text();
}

describe('hooks.server handle: theme', () => {
  it('cookie dark -> class dark  [red if: cookie ignored]', async () => {
    expect(await themed('dark')).toBe('<html class="dark">');
  });
  it('cookie auto -> class auto  [red if: auto not passed through]', async () => {
    expect(await themed('auto')).toBe('<html class="auto">');
  });
  it('light, none, or anything else -> no class, value never echoed  [red if: reflected: attribute injection, or placeholder left in]', async () => {
    for (const c of ['light', undefined, 'Dark', '', 'dark" onload="x', 'auto dark']) expect(await themed(c), String(c)).toBe('<html class="">');
  });
});
