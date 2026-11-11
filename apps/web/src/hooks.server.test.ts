// POLY-128 R6: `handle` stamps <html class> from the poly-theme cookie; only `dark` or `light` ever reach the page.
import { describe, expect, it } from 'vitest';
import { handle } from './hooks.server.ts';

async function themed(cookie: string | undefined): Promise<string> {
  const event = { cookies: { get: (n: string) => (n === 'poly-theme' ? cookie : undefined) } };
  const resolve = async (_e: unknown, opts?: { transformPageChunk?: (a: { html: string; done: boolean }) => string }) =>
    new Response(opts?.transformPageChunk?.({ html: '<html class="%poly.theme%">', done: true }) ?? '');
  const res = await (handle as (a: unknown) => Promise<Response>)({ event, resolve });
  return res.text();
}

describe('hooks.server handle: theme', () => {
  it('cookie dark -> class dark  [red if: cookie ignored]', async () => {
    expect(await themed('dark')).toBe('<html class="dark">');
  });
  it('no cookie -> light  [red if: default flips or placeholder left in]', async () => {
    expect(await themed(undefined)).toBe('<html class="light">');
  });
  it('anything else -> light, never echoed  [red if: the cookie value is reflected: attribute injection]', async () => {
    expect(await themed('Dark')).toBe('<html class="light">');
    expect(await themed('dark" onload="x')).toBe('<html class="light">');
    expect(await themed('')).toBe('<html class="light">');
  });
});
