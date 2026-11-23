// POLY-100 T-sauth, box half (ruling c52458c8): the staging basic-auth file's owner and group are read from a REAL root:10010 file and directory, which a unit test cannot own.
// Accepted: root:10010 0440 in a root:10010 0750 directory. Refused: the file in another group, the directory in another group, another owner. Red on an `owner_of` returning constants.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HOST, build, makeHost, run } from './box.ts';

const CHECK = `cd /repo/infra/ops && python3 -I -c '
import sys
sys.path.insert(0, ".")
from lib import sauth
from lib.ctx import Ctx
print("RESULT", sauth.check(Ctx(root="/", trusted_uid=0)))
'`;
const GOOD = `install -d -m 0750 -o root -g 10010 /etc/polycarpic/secrets/caddy; printf 'staging $2y$10$%s\\n' "$(printf 'a1B./%.0s' 1 2 3 4 5 6 7 8 9 10)xyz" > /etc/polycarpic/secrets/caddy/staging_basic_auth; chown root:10010 /etc/polycarpic/secrets/caddy/staging_basic_auth; chmod 0440 /etc/polycarpic/secrets/caddy/staging_basic_auth`;

let setupError: string | null = null;
beforeAll(() => {
  try {
    build();
    const h = makeHost();
    if (h.code !== 0) throw new Error(`the host stage did not complete on the fake box (rc ${h.code}): ${h.all.slice(-900)}`);
  } catch (e) { setupError = String((e as Error).message); }
}, 600_000);
beforeEach(() => { if (setupError) throw new Error(setupError); });

describe('T-sauth on a real root', () => {
  it('a real root:10010 0440 file in a root:10010 0750 directory is accepted', () => {
    const r = run(`${GOOD}\n${CHECK}`, { image: HOST });
    expect(r.out + r.err).toMatch(/RESULT None/);
  });
  it.each([
    ['the file in another group', 'chgrp 10005 /etc/polycarpic/secrets/caddy/staging_basic_auth'],
    ['the directory in another group', 'chgrp 10005 /etc/polycarpic/secrets/caddy'],
    ['the file owned by another user', 'chown 1000:10010 /etc/polycarpic/secrets/caddy/staging_basic_auth'],
    ['the directory owned by another user', 'chown 1000:10010 /etc/polycarpic/secrets/caddy'],
    ['the file group-writable', 'chmod 0460 /etc/polycarpic/secrets/caddy/staging_basic_auth'],
  ])('refused: %s', (_n, fault) => {
    const r = run(`${GOOD}\n${fault}\n${CHECK}`, { image: HOST });
    expect(r.out + r.err).toMatch(/RESULT (?!None)\S/);
    expect(r.out + r.err).not.toMatch(/RESULT None/);
  });
});
