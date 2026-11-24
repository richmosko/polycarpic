// POLY-100 T-real, part 3: S38 on the kept log (ruling.md 3765f358). The log a public repository keeps as an artifact is the step's own output plus `deploy.log`, nothing from /etc/polycarpic, the state
// directory, a saved render or the environment (c); the fixture secrets are random per run and a sweep finds none of them, nor the token, in it (d); no token reaches the step (e). (a) is the classifier test
// (tests/ci/deploy-key.test.ts) and (b) the `always()` undo (infra/ci/deploy-real-undo.sh), which devops-100 owns and CI shows.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IN_CI, LOG, ROOT, log, missing, readRoot, run, secretEntries, stateFile } from './harness.ts';

const gap = missing();
if (gap.length && IN_CI) throw new Error(`deploy-real: ${gap.join(', ')} missing in CI: T-real must run, not skip`);
const suite = gap.length ? describe.skip : describe;

suite('T-real part 3: S38', () => {
  it('(c) the kept log is the step output and deploy.log alone: deploy.log is appended here, as the last thing', () => {
    const dl = stateFile('deploy.log');
    expect(dl, 'staging has a deploy.log').not.toBeNull();
    log('## deploy.log (staging)');
    log(dl!.trimEnd());
    const kept = readFileSync(LOG, 'utf8');
    expect(kept, 'a saved render (JSON of a compose file) is in the kept log').not.toMatch(/"services"\s*:/);
    expect(kept, 'an environment dump is in the kept log').not.toMatch(/^(PATH|HOME|GITHUB_[A-Z_]+|RUNNER_[A-Z_]+|ACTIONS_[A-Z_]+)=/m);
    expect(kept, 'the content of an env file is in the kept log').not.toMatch(/^(TLS_MODE|PUBLIC_ORIGIN|POLY_INSTANCE|MAIL_FROM)=/m);
  });

  it('(d) no fixture secret and not the token is in the kept log (the names are reported, never the values)', () => {
    const kept = readFileSync(LOG, 'utf8');
    const entries = secretEntries();
    expect(entries.length, 'the sweep has secrets to look for: the harness registered none').toBeGreaterThan(5);
    const found = entries.filter(([, v]) => v.length >= 16 && kept.includes(v)).map(([n]) => n);
    expect(found, 'secrets found in the kept log').toEqual([]);
  });

  it('(d) the sweep can see: a planted copy of one secret IS found (the check would not pass on an empty look)', () => {
    const [, v] = secretEntries()[0]!;
    expect(('x' + v + 'y').includes(v)).toBe(true);
    expect(readRoot('/run/poly-deploy-real/secrets.json')).toContain(v);
  });

  it('(e) no token reaches the step: no GH_TOKEN or GITHUB_TOKEN in its environment, no persisted credential in the checkout', () => {
    expect(process.env.GH_TOKEN, 'GH_TOKEN reaches the step').toBeUndefined();
    expect(process.env.GITHUB_TOKEN, 'GITHUB_TOKEN reaches the step').toBeUndefined();
    const cfg = run(['git', '-C', ROOT, 'config', '--local', '--get-regexp', '^(http\\..*extraheader|credential\\..*)$']);
    expect(cfg.out.trim(), 'a persisted credential or extraheader sits in the checkout').toBe('');
  });
});
