// POLY-137 R8 row "e2e step-up stamp" (ruling @ a5e9ce4f): the stamp is written inside the Sessions spec, right before the revoke, never in
// serve.ts before `vite build`. Static: reads the three e2e files. Titles end [red if: <mutation>]. The one-off 6-minute wait
// is a local run reported in red-run.md / the green gate, not a CI test.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const E2E = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'web', 'tests', 'e2e');
const src = (f: string) => readFileSync(join(E2E, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the step-up stamp moves from serve.ts into the revoke spec', () => {
  it('serve.ts stamps no session as fresh (`recent_auth_at = now()`); its stale backdated stamps for other users stay (it ran before `vite build`, so a slow build outlived the 5-minute window)  [red if: the seed still stamps]', () => {
    expect(src('serve.ts')).not.toMatch(/recent_auth_at\s*=\s*now\(\)(?!\s*-)/);
  });
  it('support.ts exports stampStepUp(email), which writes recent_auth_at for the user\'s sessions  [red if: no helper]', () => {
    const s = src('support.ts');
    expect(s).toMatch(/export\s+(async\s+)?(function\s+stampStepUp|const\s+stampStepUp)/);
    expect(s).toMatch(/recent_auth_at\s*=\s*now\(\)/);
  });
  it('sign-in-flow.spec.ts calls stampStepUp inside the Sessions test, before the revoke click  [red if: the spec relies on a stamp written earlier]', () => {
    const s = src('sign-in-flow.spec.ts');
    const test = s.slice(s.indexOf('Settings links to Sessions'));
    const at = test.indexOf('stampStepUp(');
    expect(at, 'the Sessions spec calls the helper').toBeGreaterThan(-1);
    const click = test.indexOf("getByRole('button', { name: 'Revoke' })");
    expect(click, 'the Sessions spec still clicks Revoke').toBeGreaterThan(-1);
    expect(at, 'stamped before the revoke click').toBeLessThan(click);
    expect(s).toMatch(/import[^;]*stampStepUp[^;]*from\s+['"]\.\/support/);
  });
});
