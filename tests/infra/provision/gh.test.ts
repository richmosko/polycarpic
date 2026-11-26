// POLY-104 F15 (seceng's ruling): `gh` decides whether an image is ours and holds the GitHub token, so the host stage installs exactly the bytes two
// pins name (infra/deploy/gh-sha256: the release tarball, then its bin/gh), and provision-check H26 holds the box to them.
// The box's release is a stand-in (box.ts ghRelease) whose own pins are mounted over the repository's; no network. A case that needs other pins runs
// from a copy of infra/ with its pin files changed.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAPS, BUCKET, CHECK, COMPLETE, GH_VERSION, HOST, HOST_ARGS, b2Fixture, build, check, failLine, find, ghRelease, makeComplete, makeHost, run } from './box.ts';

const BIN = '/usr/local/bin/gh';
const TARBALL = `gh_${GH_VERSION}_linux_amd64.tar.gz`;
const URL = `https://github.com/cli/cli/releases/download/v${GH_VERSION}/${TARBALL}`;
const HOSTRUN = `bash /repo/infra/provision.sh ${HOST_ARGS}`;
const rc = '; echo "rc=$?"';
const CANARY = '/root/gh-was-run';
/** a copy of infra/ whose pins a case may change */
const COPY = 'rm -rf /tmp/i2; cp -a /repo/infra /tmp/i2; cp /ghfix/gh-sha256 /tmp/i2/deploy/gh-sha256 2>/dev/null || true;';
const HOSTRUN2 = `bash /tmp/i2/provision.sh ${HOST_ARGS}`;
const CHECK2 = `POLY_NTP_WAIT=2 bash /tmp/i2/provision-check.sh --b2-capabilities ${CAPS} --b2-bucket ${BUCKET}`;
/** the box without gh: what the first real box was */
const NO_GH = `rm -f ${BIN}; : > /var/fake-state/calls.log;`;
const STATE = `if [ -e ${BIN} ]; then sha256sum < ${BIN}; else echo ABSENT; fi; [ -e ${CANARY} ] && echo RAN || echo NOTRUN`;
const downloads = `grep -c '^curl .*cli/cli/releases' /var/fake-state/calls.log || true`;

let setupError: string | null = null;
beforeAll(() => {
  try {
    build();
    const h = makeHost();
    if (h.code !== 0) throw new Error(`host stage failed on the fake box (rc ${h.code}): ${h.all.slice(-900)}`);
    const c = makeComplete();
    if (c.code !== 0) throw new Error(`complete box failed: ${c.all.slice(-600)}`);
  } catch (e) { setupError = String((e as Error).message); }
}, 600_000);
beforeEach(() => { if (setupError) throw new Error(setupError); });

describe('provision host stage: gh from the pinned release tarball', () => {
  it('installs bin/gh alone to /usr/local/bin/gh, root:root 0755, with the pinned hash and version, and leaves nothing else behind', () => {
    const r = run(`${NO_GH} ${HOSTRUN} > /tmp/o 2>&1${rc}
stat -c '%a %u:%g %F' ${BIN}; sha256sum < ${BIN} | cut -d' ' -f1; sed -n 2p /ghfix/gh-sha256 | cut -d' ' -f1; ${BIN} --version | head -n 1
grep -c '^change: .*gh' /tmp/o; find / -xdev \\( -name 'gh_*' -o -name 'gh.1' -o -name '${TARBALL}' \\) -not -path '/ghfix/*' -not -path '/proc/*' 2>/dev/null | wc -l; ls /usr/local/bin | grep -c gh`, { image: HOST });
    const [code, mode, got, want, version, changes, left, ghs] = r.out.trim().split('\n');
    expect([code, mode], r.out + r.err).toEqual(['rc=0', '755 0:0 regular file']);
    expect(got).toBe(want);
    expect(version).toMatch(new RegExp(`^gh version ${GH_VERSION.replace(/\./g, '\\.')} `));
    expect(Number(changes), 'the install is reported').toBeGreaterThan(0);
    expect([left, ghs], 'no tarball, unpacked tree, man page or part file is left').toEqual(['0', '1']);
  });

  it('downloads the pinned release URL with https only, redirects included', () => {
    const r = run(`${NO_GH} ${HOSTRUN} > /dev/null 2>&1; grep '^curl .*cli/cli/releases' /var/fake-state/calls.log`, { image: HOST });
    const calls = r.out.trim().split('\n').filter(Boolean);
    expect(calls.length, r.out + r.err).toBe(1);
    expect(calls[0]).toContain(URL);
    expect(calls[0]).toMatch(/--proto[ =]\\?=https/);
    expect(calls[0]).toMatch(/--proto-redir[ =]\\?=https/);
  });

  it('a rerun downloads nothing, changes nothing and leaves the file as it was', () => {
    const r = run(`[ -x ${BIN} ] || echo MISSING; : > /var/fake-state/calls.log; before=$(stat -c '%i %Y' ${BIN}); ${HOSTRUN} > /tmp/o 2>&1${rc}; ${downloads}; [ "$(stat -c '%i %Y' ${BIN})" = "$before" ] && echo SAME; grep -c '^change: ' /tmp/o || true`, { image: HOST });
    expect(r.out.trim().split('\n'), r.out + r.err).toEqual(['rc=0', '0', 'SAME', '0']);
  });

  it('a gh whose bytes are not the pinned ones is replaced, even when it reports the right version', () => {
    const r = run(`[ -x ${BIN} ] || echo MISSING; echo '# altered' >> ${BIN}; ${HOSTRUN} > /tmp/o 2>&1${rc}; sha256sum < ${BIN} | cut -d' ' -f1; sed -n 2p /ghfix/gh-sha256 | cut -d' ' -f1; grep -c '^change: .*gh' /tmp/o`, { image: HOST });
    const out = r.out.trim().split('\n');
    expect(out[0], r.out + r.err).toBe('rc=0');
    expect(out[1]).toBe(out[2]);
    expect(Number(out[3])).toBeGreaterThan(0);
  });

  // another tarball under the pinned name: its bin/gh records that it ran
  const EVIL = `${ghRelease('/tmp/evil', GH_VERSION, `touch ${CANARY}`)}; cp /tmp/evil/${TARBALL} /var/fake-state/gh-asset;`;

  it('refuses a tarball whose sha256 is not the pinned one: exit non-zero naming sha256, nothing installed, nothing from it run', () => {
    const r = run(`${EVIL} ${NO_GH} ${HOSTRUN} > /tmp/o 2>&1${rc}; ${STATE}; ${downloads}; echo ==; tail -n 3 /tmp/o`, { image: HOST });
    const [head, tail] = r.out.split('==\n') as [string, string];
    expect(head.trim().split('\n').slice(-4), r.out + r.err).toEqual(['rc=1', 'ABSENT', 'NOTRUN', '1']);
    expect(tail).toMatch(/gh.*sha256|sha256.*gh/i);
  });

  it('with a good gh already there, a refused download leaves it as it was', () => {
    const r = run(`[ -x ${BIN} ] || echo MISSING; ${EVIL} ${COPY} sed -i "2s/^[0-9a-f]*/$(printf '0%.0s' $(seq 64))/" /tmp/i2/deploy/gh-sha256; before=$(sha256sum < ${BIN}); ${HOSTRUN2} > /dev/null 2>&1${rc}; [ "$(sha256sum < ${BIN})" = "$before" ] && echo KEPT; [ -e ${CANARY} ] && echo RAN || echo NOTRUN`, { image: HOST });
    expect(r.out.trim().split('\n'), r.out + r.err).toEqual(['rc=1', 'KEPT', 'NOTRUN']);
  });

  it('the right tarball but a bin/gh that is not the second pinned hash: refused before it is installed or run', () => {
    const r = run(`${ghRelease('/tmp/other', GH_VERSION, `touch ${CANARY}`)}; cp /tmp/other/${TARBALL} /var/fake-state/gh-asset
${COPY} { sed -n 1p /tmp/other/gh-sha256; sed -n 2p /ghfix/gh-sha256; } > /tmp/i2/deploy/gh-sha256
${NO_GH} ${HOSTRUN2} > /tmp/o 2>&1${rc}; ${STATE}; ${downloads}; echo ==; tail -n 3 /tmp/o`, { image: HOST });
    const [head, tail] = r.out.split('==\n') as [string, string];
    expect(head.trim().split('\n').slice(-4), r.out + r.err).toEqual(['rc=1', 'ABSENT', 'NOTRUN', '1']);
    expect(tail).toMatch(/sha256/i);
  });

  it('control: the same copy with matching pins installs (so the two refusals above come from the pins)', () => {
    const r = run(`${COPY} ${NO_GH} ${HOSTRUN2} > /tmp/o 2>&1${rc}; ${BIN} --version | head -n 1`, { image: HOST });
    expect(r.out.trim().split('\n')[0], r.out + r.err).toBe('rc=0');
    expect(r.out).toContain(`gh version ${GH_VERSION}`);
  });

  it('an architecture other than amd64 stops the stage, naming it, with nothing installed', () => {
    const r = run(`echo arm64 > /var/fake-state/arch; ${NO_GH} ${HOSTRUN} > /tmp/o 2>&1${rc}; [ -e ${BIN} ] && echo PRESENT || echo ABSENT; ${downloads}; echo ==; tail -n 3 /tmp/o`, { image: HOST });
    const [head, tail] = r.out.split('==\n') as [string, string];
    expect(head.trim().split('\n'), r.out + r.err).toEqual(['rc=1', 'ABSENT', '0']);
    expect(tail).toContain('arm64');
  });
});

describe('provision-check H26: gh is the pinned one', () => {
  const copied = (plant: string, o = '') => run(`${b2Fixture({})}\n${COPY} ${plant}\n${CHECK2} ${o}`, { image: COMPLETE });
  /** put a gh reporting `version` at BIN and pin ITS hash, so only the version can be wrong */
  const pinned = (version: string) => `${ghRelease('/tmp/v', version)}; tar -xzf /tmp/v/gh_${version}_linux_amd64.tar.gz -C /tmp/v; install -m 0755 /tmp/v/gh_${version}_linux_amd64/bin/gh ${BIN}
{ sed -n 1p /ghfix/gh-sha256; echo "$(sha256sum < ${BIN} | cut -d' ' -f1)  gh_${GH_VERSION}_linux_amd64/bin/gh"; } > /tmp/i2/deploy/gh-sha256;`;

  it('passes on the complete box', () => {
    const r = check();
    expect(find(r.out, 'FAIL', 'H26')?.text).toBeUndefined();
    expect(find(r.out, 'PASS', 'H26'), r.out.slice(-900) + r.err.slice(-300)).toBeDefined();
  });

  it('control: passes from the copy of infra/ too', () => {
    expect(find(copied(':').out, 'PASS', 'H26')).toBeDefined();
  });

  for (const [label, plant, found] of [
    ['no gh', `rm -f ${BIN}`, 'gh'],
    ['other bytes at the same version', `echo '# altered' >> ${BIN}`, 'sha256'],
    ['a group-writable gh', `chmod 0775 ${BIN}`, 'gh'],
    ['a gh not owned by root', `chown 10020:10020 ${BIN}`, 'gh'],
    ['another gh earlier on the tool\'s PATH', `cp -p ${BIN} /usr/local/sbin/gh`, '/usr/local/sbin/gh'],
    ['the gh package installed as well', ': > /var/fake-state/gh-deb', /package|dpkg|deb/i],
  ] as const) {
    it(`FAILs: ${label}`, () => { failLine(check(plant), 'H26', [found]); });
  }

  it('FAILs a version other than the pinned one even when the bytes match their pin', () => {
    failLine(copied(pinned('2.105.0')), 'H26', ['2.105.0']);
  });

  it('FAILs a version under 2.102.0 even when both pins agree with it', () => {
    failLine(copied(`${pinned('2.101.0')} echo 2.101.0 > /tmp/i2/deploy/gh-version; sed -i 's/${GH_VERSION}/2.101.0/g' /tmp/i2/deploy/gh-sha256;`), 'H26', ['2.101.0']);
  });

  it('never runs a gh whose hash is wrong: the check runs as root', () => {
    const r = run(`${b2Fixture({})}\nprintf '#!/bin/sh\\ntouch ${CANARY}\\necho "gh version ${GH_VERSION}"\\n' > ${BIN}; chmod 0755 ${BIN}\n${CHECK} > /tmp/o 2>&1; [ -e ${CANARY} ] && echo RAN || echo NOTRUN; grep -c '^FAIL H26 ' /tmp/o`, { image: COMPLETE });
    expect(r.out.trim().split('\n'), r.out + r.err).toEqual(['NOTRUN', '1']);
  });
});
