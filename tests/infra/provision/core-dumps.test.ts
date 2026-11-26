// POLY-104 core dumps (seceng's ruling, security-review.md @ 5f22ba32): the box's core_pattern was apport's pipe, which a core limit of 0 does not
// bind, so a crashing container's memory went to a root process on the host. The host stage purges apport and pins two kernel values; provision-check
// H27 reads them live. The fake kernel and package state are in fakes/_fake (sysctl, apt-get, dpkg-query).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COMPLETE, HOST, HOST_ARGS, b2Fixture, build, check, failLine, find, makeComplete, makeHost, run } from './box.ts';

const FILE = '/etc/sysctl.d/50-polycarpic-core.conf';
const PATTERN = '|/bin/false';
const TODAY = '|/usr/share/apport/apport -p%p -s%s -c%c -d%d -P%P -u%u -g%g -F%F -- %E'; // the box's shape: apport's pipe
const HOSTRUN = `bash /repo/infra/provision.sh ${HOST_ARGS}`;
const rc = '; echo "rc=$?"';
const LIVE = 'sysctl -n kernel.core_pattern; sysctl -n fs.suid_dumpable';
/** the box before this control: apport installed, the kernel on apport's values, no file of ours */
const BEFORE = `rm -f ${FILE} /var/fake-state/apport-purged /var/fake-state/apport-status; rm -rf /var/fake-state/sysctl; : > /var/fake-state/calls.log;`;
const set = (key: string, value: string) => `mkdir -p /var/fake-state/sysctl; printf '%s\\n' '${value}' > /var/fake-state/sysctl/${key};`;
const PURGES = `grep -cE '^apt-get .*(purge|remove).* apport( |$)' /var/fake-state/calls.log || true`;
const APPLIES = `grep -cE '^sysctl .*(-p|-w|--system|--load)' /var/fake-state/calls.log || true`;

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

describe('provision host stage: no core dump leaves a crashing process', () => {
  it('control: the fake box starts as the real one did: apport installed, its pipe live, suid_dumpable 2', () => {
    const r = run(`${BEFORE} dpkg-query -W -f='\${Status}' apport; echo; ${LIVE}`, { image: HOST });
    expect(r.out.trim().split('\n'), r.err).toEqual(['install ok installed', TODAY, '2']);
  });

  it('purges apport, writes the sysctl file root 0644 with exactly the two settings, and the live values are the pinned ones', () => {
    const r = run(`${BEFORE} ${HOSTRUN} > /tmp/o 2>&1${rc}; ${LIVE}; ${PURGES}; stat -c '%a %u:%g' ${FILE}; grep -vE '^[[:space:]]*(#|;|$)' ${FILE} | tr -d ' ' | LC_ALL=C sort; grep -cE '^change: .*(apport|core|sysctl)' /tmp/o`, { image: HOST });
    const out = r.out.trim().split('\n');
    expect(out.slice(0, 7), r.out + r.err).toEqual(['rc=0', PATTERN, '0', '1', '644 0:0', 'fs.suid_dumpable=0', `kernel.core_pattern=${PATTERN}`]);
    expect(Number(out[7]), 'the changes are reported').toBeGreaterThan(0);
  });

  it('purges first, then applies: apport\'s stop rewrites core_pattern', () => {
    const r = run(`${BEFORE} ${HOSTRUN} > /dev/null 2>&1; grep -nE '^(apt-get .*(purge|remove).* apport|sysctl .*(-p|-w|--system|--load))' /var/fake-state/calls.log | awk -F: '{ split($2, a, " "); print a[1] }'`, { image: HOST });
    expect(r.out.trim().split('\n'), r.err).toEqual(['apt-get', 'sysctl']);
  });

  it('a rerun purges nothing, applies nothing and changes nothing', () => {
    const r = run(`${BEFORE} ${HOSTRUN} > /dev/null 2>&1; : > /var/fake-state/calls.log; before=$(stat -c '%i %Y' ${FILE}); ${HOSTRUN} > /tmp/o 2>&1${rc}; ${PURGES}; ${APPLIES}; [ -n "$before" ] && [ "$(stat -c '%i %Y' ${FILE})" = "$before" ] && echo SAME; grep -c '^change: ' /tmp/o || true; ${LIVE}`, { image: HOST });
    expect(r.out.trim().split('\n'), r.out + r.err).toEqual(['rc=0', '0', '0', 'SAME', '0', PATTERN, '0']);
  });

  for (const [label, plant] of [['core_pattern', set('kernel.core_pattern', TODAY)], ['suid_dumpable', set('fs.suid_dumpable', '2')]] as const) {
    it(`a live ${label} that drifted, with the file right, is applied again and reported`, () => {
      const r = run(`${plant} ${HOSTRUN} > /tmp/o 2>&1${rc}; ${LIVE}; grep -c '^change: ' /tmp/o || true`, { image: HOST });
      const out = r.out.trim().split('\n');
      expect(out.slice(0, 3), r.out + r.err).toEqual(['rc=0', PATTERN, '0']);
      expect(Number(out[3])).toBeGreaterThan(0);
    });
  }

  it('a drifted sysctl file is rewritten even when the live values are right', () => {
    const r = run(`printf 'kernel.core_pattern=core\\n' > ${FILE}; ${HOSTRUN} > /tmp/o 2>&1${rc}; grep -c '^kernel.core_pattern *= *|/bin/false$' ${FILE}; grep -c '^fs.suid_dumpable *= *0$' ${FILE}; ${LIVE}`, { image: HOST });
    expect(r.out.trim().split('\n'), r.out + r.err).toEqual(['rc=0', '1', '1', PATTERN, '0']);
  });

  it('apport removed but not purged (config-files left) is purged; a "not-installed" status is left alone', () => {
    const left = run(`${BEFORE} echo 'deinstall ok config-files' > /var/fake-state/apport-status; ${HOSTRUN} > /dev/null 2>&1${rc}; ${PURGES}`, { image: HOST });
    expect(left.out.trim().split('\n'), left.err).toEqual(['rc=0', '1']);
    const gone = run(`${BEFORE} echo 'unknown ok not-installed' > /var/fake-state/apport-status; ${HOSTRUN} > /dev/null 2>&1${rc}; ${PURGES}; ${LIVE}`, { image: HOST });
    expect(gone.out.trim().split('\n'), gone.err).toEqual(['rc=0', '0', PATTERN, '0']);
  });

  it('stops, naming the setting, when applying the file does not change the live value', () => {
    const r = run(`${BEFORE} : > /var/fake-state/sysctl-stuck; ${HOSTRUN} > /tmp/o 2>&1${rc}; tail -n 3 /tmp/o`, { image: HOST });
    expect(r.out.split('\n')[0], r.out + r.err).toBe('rc=1');
    expect(r.out).toMatch(/core_pattern|suid_dumpable/);
  });
});

describe('provision-check H27: core dumps', () => {
  it('passes on the complete box', () => {
    const r = check();
    expect(find(r.out, 'FAIL', 'H27')?.text).toBeUndefined();
    expect(find(r.out, 'PASS', 'H27'), r.out.slice(-900) + r.err.slice(-300)).toBeDefined();
  });

  for (const [label, plant, found] of [
    ['apport\'s pipe, as the box had it', set('kernel.core_pattern', TODAY), ['core_pattern', 'apport']],
    ['a plain core file pattern', set('kernel.core_pattern', 'core'), ['core_pattern']],
    ['a pattern that only begins like the pinned one', set('kernel.core_pattern', '|/bin/false %P'), ['core_pattern']],
    ['suid_dumpable 2', set('fs.suid_dumpable', '2'), ['suid_dumpable']],
    ['suid_dumpable 1', set('fs.suid_dumpable', '1'), ['suid_dumpable']],
    ['apport installed again', 'rm -f /var/fake-state/apport-purged;', ['apport']],
    ['apport half removed (config-files)', 'echo \'deinstall ok config-files\' > /var/fake-state/apport-status;', ['apport']],
  ] as const) {
    it(`FAILs: ${label}`, () => { failLine(check(plant), 'H27', [...found]); });
  }

  it('reads the live value, not the file: the right file with apport\'s pipe live still FAILs', () => {
    const r = run(`${b2Fixture({})}\n${set('kernel.core_pattern', TODAY)} grep -c '|/bin/false' ${FILE}; bash /repo/infra/provision-check.sh --b2-capabilities /repo/tests/infra/provision/fixtures/b2-capabilities.json --b2-bucket polycarpic-hetzner-backups | grep -c '^FAIL H27 '`, { image: COMPLETE });
    expect(r.out.trim().split('\n'), r.err).toEqual(['1', '1']);
  });
});
