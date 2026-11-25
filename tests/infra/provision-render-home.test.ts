// POLY-160 R6 and R7 (ruling @ 7613d4e9), the text half: where the scripts find themselves, and the render home every compose call names.
// The behavioural half (relative invocations with CDPATH set, and R7's four homes) runs in the dry-run box, tests/infra/provision/host.test.ts.
// Mutants: `here=` below `cd /`; `unset CDPATH` removed; a second BASH_SOURCE; a compose call naming the literal render-home path or lacking `--env-file /dev/null`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../ci/helpers.ts';

const read = (f: string) => readFileSync(join(ROOT, 'infra', f), 'utf8').split('\n');
const provision = read('provision.sh');
const check = read('provision-check.sh');
const idx = (lines: string[], re: RegExp) => lines.findIndex((l) => re.test(l));

describe('R6: provision.sh resolves its own directory once, before it leaves it', () => {
  it('BASH_SOURCE appears once, in a top-level `here=` that is checked, below `unset CDPATH` and above `cd /`', () => {
    const uses = provision.map((l, i) => [l, i] as const).filter(([l]) => l.includes('BASH_SOURCE'));
    expect(uses).toHaveLength(1);
    const at = uses[0]![1];
    const cdroot = idx(provision, /^cd \/( |$)/);
    const unset = idx(provision, /^unset CDPATH\s*$/);
    expect(unset, 'unset CDPATH at top level').toBeGreaterThan(-1);
    expect(unset).toBeLessThan(at);
    expect(at).toBeLessThan(cdroot);
    expect(provision[at]).toMatch(/^here=\$\(cd -- "\$\(dirname -- "\$\{BASH_SOURCE\[0\]\}"\)" && pwd -P\) \|\| die /);
  });
  it('the three later resolutions use $here', () => {
    expect(provision.filter((l) => /cd "\$\(dirname/.test(l))).toEqual([]);
    expect(provision.join('\n')).toContain('$here/deploy/compose-version');
    expect(provision.join('\n')).toMatch(/src=\$here\/backup\/systemd/);
    expect(provision.join('\n')).toMatch(/roles_sql=\$here\/roles\.sql/);
  });
});

describe('R7: every compose call names the render home variable and no env file', () => {
  for (const [name, lines] of [['provision.sh', provision], ['provision-check.sh', check]] as const) {
    it(`${name}: each \`docker compose\` call has --env-file /dev/null and --project-directory "$rh"`, () => {
      const calls = lines.filter((l) => /docker compose /.test(l) && !/^\s*#/.test(l) && /--project-directory/.test(l));
      expect(calls.length, 'at least one compose call is found').toBeGreaterThan(0);
      for (const l of calls) {
        expect(l, l).toContain('--env-file /dev/null');
        expect(l, l).toMatch(/--project-directory "?\$\{?rh\}?"?/);
        expect(l, l).not.toContain('render-home');
      }
    });
  }
  it('both scripts choose `rh` from the render home only when it is a real, empty, root-owned 0755 directory, else `/` or a stop', () => {
    expect(provision.join('\n')).toMatch(/rh=\//);
    expect(check.join('\n')).toMatch(/rh=\//);
    expect(provision.join('\n')).toContain('render-path');
    expect(check.join('\n')).toContain('H24');
  });
});
