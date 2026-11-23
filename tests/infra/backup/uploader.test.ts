// POLY-99 R4 and T3-T8, T14 (the uploader). The rendered `uploader` service against fake-b2 (R11). Each security-bearing behaviour has a
// mutant copy of upload.sh, or a variant mount, that the same check flags (the RED ON THE FAULT tests).
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_KEY, BUCKET, INSTANCE, KEY_ID, PROJECT, TOOLS, attach, mutate, sh, type Stack } from './stack.ts';
import { type Fake, UP, attachFake, plantSpool, runUploader, setName, sha256Of, uploaderDuring, verifiedLines, walName, writeConf } from './uploader.ts';

let s: Stack;
let fake: Fake;
let setupError: string | null = null;
beforeAll(() => {
  try { s = attach(); fake = attachFake(); } catch (e) { setupError = String((e as Error).message); }
});
beforeEach(() => {
  if (setupError) throw new Error(setupError);
  fake.reset(); s.clearSpool();
  writeConf(s, 'ops.conf', `B2_BUCKET=${BUCKET}\nB2_S3_ENDPOINT=https://s3.eu-fake-001.backblazeb2.com\n`);
  writeConf(s, 'host.env', `POLY_INSTANCE=${INSTANCE}\n`);
});
const TS = '20261122T021500Z';
const script = () => readFileSync(`${process.cwd()}/infra/backup/upload.sh`, 'utf8');
const puts = () => fake.log().filter((l) => l.startsWith('PUT '));
const key = (l: string) => l.split(' ')[2]!.replace(`/${BUCKET}/`, '');
const lastLine = (t: string) => t.trim().split('\n').pop() ?? '';

describe('R4 the run: order, verified lines, objects, siblings; the spool is untouched', () => {
  it('uploads wal/, then dump/, then premigration/, each sorted by name; one `verified <dir> <name> <sha256>` line per file and nothing else on stdout', () => {
    plantSpool(s, 'wal', walName(s, '000000010000000000000043'));
    plantSpool(s, 'wal', walName(s, '000000010000000000000042'));
    for (const k of ['globals', 'base', 'dump'] as const) plantSpool(s, 'dump', setName(s, k, TS));
    plantSpool(s, 'premigration', setName(s, 'globals', TS));
    plantSpool(s, 'premigration', setName(s, 'dump', TS));
    const before = [s.ls('wal'), s.ls('dump'), s.ls('premigration')];
    const r = runUploader(s);
    expect({ code: r.code, err: r.err.slice(-300) }).toEqual({ code: 0, err: expect.any(String) });
    const want = [
      ['wal', walName(s, '000000010000000000000042')], ['wal', walName(s, '000000010000000000000043')],
      ['dump', setName(s, 'base', TS)], ['dump', setName(s, 'dump', TS)], ['dump', setName(s, 'globals', TS)],
      ['premigration', setName(s, 'dump', TS)], ['premigration', setName(s, 'globals', TS)],
    ];
    const got = verifiedLines(r.out);
    expect(got.map((l) => [l[0], l[1], l[2]])).toEqual(want.map(([d, n]) => ['verified', d, n]));
    for (const l of got) expect(l[3], `${l[1]}/${l[2]}`).toBe(sha256Of(s, `/s/${l[1]}/${l[2]}`));
    expect(got.every((l) => l.length === 4 && /^[0-9a-f]{64}$/.test(l[3]!))).toBe(true);
    // the bucket: <instance>/<M>/<dir>/<name> plus the .sha256 sibling "<sha>  <name>\n"
    const st = fake.store();
    for (const l of got) {
      const obj = `${INSTANCE}/${s.major}/${l[1]}/${l[2]}`;
      expect(Object.keys(st), obj).toContain(obj);
      const sib = st[`${obj}.sha256`];
      expect(sib, `${obj}.sha256`).toHaveLength(1);
      expect(fake.object(sib![0]!.fileId).toString()).toBe(`${l[3]}  ${l[2]}\n`);
      expect(st[obj]![0]!.sha256).toBe(l[3]);
    }
    expect(Object.keys(st)).toHaveLength(want.length * 2);
    // it reads the spool and nothing more (R4: deletes nothing, writes no state)
    expect([s.ls('wal'), s.ls('dump'), s.ls('premigration')]).toEqual(before);
    // T6: only PUTs, all by the box key, all single-part, siblings after their object
    const log = fake.log();
    expect(log.every((l) => l.startsWith(`PUT ${KEY_ID} /${BUCKET}/`))).toBe(true);
    expect(log).toHaveLength(want.length * 2);
    const names = log.map(key);
    for (const [d, n] of want) expect(names.indexOf(`${INSTANCE}/${s.major}/${d}/${n}`)).toBe(names.indexOf(`${INSTANCE}/${s.major}/${d}/${n}.sha256`) - 1);
  });

  it('nothing to do -> exit 0, empty stdout, no request at all', () => {
    const r = runUploader(s);
    expect({ code: r.code, out: r.out }).toEqual({ code: 0, out: '' });
    expect(fake.log()).toEqual([]);
  });

  it('a premigration file that already has a .sha256 sibling is skipped (no PUT, no verified line); one without it is uploaded; the sibling itself is not a stray', () => {
    plantSpool(s, 'premigration', setName(s, 'dump', TS));
    plantSpool(s, 'premigration', setName(s, 'globals', TS));
    s.tools(`printf 'x  y\\n' > /s/premigration/${setName(s, 'dump', TS)}.sha256`);
    const r = runUploader(s);
    expect(r.code).toBe(0);
    expect(verifiedLines(r.out).map((l) => l[2])).toEqual([setName(s, 'globals', TS)]);
    expect(puts().map(key).every((k) => !k.includes(`dump-${s.major}`))).toBe(true);
  });

  it('a .sha256 file in dump/ is a stray (the sibling form is admitted in premigration/ only)', () => {
    s.tools(`printf 'x  y\\n' > /s/dump/${setName(s, 'dump', TS)}.sha256`);
    const r = runUploader(s);
    expect({ code: r.code, last: lastLine(r.err) }).toEqual({ code: 2, last: expect.stringContaining('stray') });
    expect(puts()).toEqual([]);
  });
});

describe('R2 grammar through the uploader: good names are shipped, bad names are strays (T8) -- ONE run for the whole table', () => {
  const seg = '000000010000000000000042';
  const goodWal = [`${seg}`, `${seg}.00000028.backup`, `${seg}.partial`, '00000002.history'];
  const bad: Array<[string, 'wal' | 'dump' | 'premigration', string]> = [
    ['a wal- name in dump/', 'dump', `wal-17-123-${seg}.age`],
    ['a dump- name in wal/', 'wal', `dump-17-123-${TS}.age`],
    ['a base- name in premigration/ (dump and globals only)', 'premigration', `base-17-123-${TS}.age`],
    ['an 8-digit major', 'dump', `dump-12345678-123-${TS}.age`],
    ['a 21-digit system id', 'dump', `dump-17-123456789012345678901-${TS}.age`],
    ['a lowercase hex segment', 'wal', `wal-17-123-00000001000000000000004a.age`],
    ['a short segment', 'wal', `wal-17-123-0000000100000000004.age`],
    ['a trailing .bak', 'dump', `dump-17-123-${TS}.age.bak`],
    ['a timestamp without Z', 'dump', `dump-17-123-20261122T021500.age`],
    ['a name with a space', 'dump', `dump-17-123-${TS} .age`],
  ];
  it('every WAL form Postgres hands archive_command (segment, .backup, .partial, .history) is shipped and reported; every bad name gets its own `upload.sh: stray file <dir>/<name>` line, no PUT; exit 2', () => {
    for (const f of goodWal) plantSpool(s, 'wal', walName(s, f));
    for (const [, dir, name] of bad) plantSpool(s, dir, name);
    const r = runUploader(s);
    expect(r.code).toBe(2);
    expect(verifiedLines(r.out).map((l) => l[2]).sort()).toEqual(goodWal.map((f) => walName(s, f)).sort());
    for (const [label, dir, name] of bad) expect(r.err, label).toContain(`upload.sh: stray file ${dir}/${name}`);
    const keys = puts().map(key);
    for (const [label, , name] of bad) expect(keys.some((k) => k.endsWith(name) || k.endsWith(`${name}.sha256`)), label).toBe(false);
    expect(keys).toHaveLength(goodWal.length * 2);
  });
});

describe('T8: the uploader never ships a non-age or stray file, and still ships the good ones', () => {
  it('a plaintext file with a valid name is refused as stray (exit 2), no PUT for it; the good file beside it is shipped and reported', () => {
    plantSpool(s, 'dump', setName(s, 'dump', TS), { raw: 'this is plaintext, not age\n' });
    plantSpool(s, 'dump', setName(s, 'globals', TS));
    const r = runUploader(s);
    expect(r.code).toBe(2);
    expect(r.err).toContain(`upload.sh: stray file dump/${setName(s, 'dump', TS)}`);
    expect(verifiedLines(r.out).map((l) => l[2])).toEqual([setName(s, 'globals', TS)]);
    expect(puts().map(key).some((k) => k.includes(`/dump-${s.major}`))).toBe(false);
    expect(puts().length).toBe(2);
  });
  it('a file inside .inflight/ and a symlink are never uploaded', () => {
    plantSpool(s, 'dump', setName(s, 'dump', TS));
    s.tools(`cp /s/dump/${setName(s, 'dump', TS)} /s/dump/.inflight/${setName(s, 'globals', TS)}.1234; ln -s ${setName(s, 'dump', TS)} /s/dump/${setName(s, 'base', TS)}`);
    runUploader(s);
    const names = puts().map(key);
    expect(names.some((k) => k.includes('.inflight') || k.includes('/globals-') || k.includes('/base-'))).toBe(false);
    expect(names.some((k) => k.endsWith(setName(s, 'dump', TS)))).toBe(true);
  });
  it('a file over 5 GiB is refused with exit 1 before any upload (sparse file, header only)', () => {
    const n = setName(s, 'dump', TS);
    s.tools(`printf 'age-encryption.org/v1\\n' > /s/dump/${n} && truncate -s 6G /s/dump/${n} && chown 10004:10004 /s/dump/${n}`);
    const r = runUploader(s);
    expect({ code: r.code, last: lastLine(r.err) }).toEqual({ code: 1, last: `upload.sh: dump/${n} exceeds 5 GiB` });
    expect(fake.log()).toEqual([]);
  });
});

describe('T7, T5: a refused or mismatched upload fails loudly and keeps the file', () => {
  it('fake-b2 refuses the PUT (403) -> exit 1, `upload.sh: upload of dump/<name> failed`, no verified line, exactly one attempt, spool intact', () => {
    for (const k of ['base', 'dump', 'globals'] as const) plantSpool(s, 'dump', setName(s, k, TS));
    const before = s.ls('dump');
    fake.mode('refuse');
    const r = runUploader(s);
    expect({ code: r.code, last: lastLine(r.err), out: r.out }).toEqual({ code: 1, last: `upload.sh: upload of dump/${setName(s, 'base', TS)} failed`, out: '' });
    expect(puts()).toHaveLength(1); // the first failure stops the run; --retries 1 --low-level-retries 1 means one attempt
    expect(s.ls('dump')).toEqual(before);
  });
  it('a 5xx answer -> exit 1, no verified line (the positive twin of the happy run is the first describe)', () => {
    plantSpool(s, 'dump', setName(s, 'dump', TS));
    fake.mode('5xx');
    const r = runUploader(s);
    expect({ code: r.code, out: r.out }).toEqual({ code: 1, out: '' });
  });
  it('T5: the response ETag does not match the sent MD5 -> exit 1, no verified line for it, the file stays, at most one (refused) DELETE and no HEAD or list', () => {
    plantSpool(s, 'dump', setName(s, 'dump', TS));
    fake.mode('etag');
    const r = runUploader(s);
    expect({ code: r.code, out: r.out, last: lastLine(r.err) }).toEqual({ code: 1, out: '', last: `upload.sh: upload of dump/${setName(s, 'dump', TS)} failed` });
    const log = fake.log();
    expect(log.filter((l) => !/^(PUT|DELETE) /.test(l))).toEqual([]);
    expect(log.filter((l) => l.startsWith('DELETE ')).length).toBeLessThanOrEqual(1);
    expect(s.ls('dump')).toEqual([setName(s, 'dump', TS)]);
  });
  it('RED ON THE FAULT: a mutant with --ignore-checksum accepts the mismatched ETag and reports verified', () => {
    plantSpool(s, 'dump', setName(s, 'dump', TS));
    fake.mode('etag');
    const m = mutate(script(), '--no-check-dest', '--no-check-dest --ignore-checksum');
    const r = runUploader(s, { mutant: m });
    expect(r.code).toBe(0);
    expect(verifiedLines(r.out)).toHaveLength(1);
  });
});

describe('T6: no HEAD, no list (M-U1..M-U3)', () => {
  it('RED ON THE FAULT: a mutant without --no-check-dest sends a HEAD first', () => {
    plantSpool(s, 'dump', setName(s, 'dump', TS));
    runUploader(s, { mutant: mutate(script(), '--no-check-dest', '') });
    expect(fake.log().some((l) => l.startsWith('HEAD '))).toBe(true);
  });
  it('RED ON THE FAULT: a mutant without --s3-no-head sends a HEAD after the PUT', () => {
    plantSpool(s, 'dump', setName(s, 'dump', TS));
    runUploader(s, { mutant: mutate(script(), '--s3-no-head', '') });
    expect(fake.log().some((l) => l.startsWith('HEAD '))).toBe(true);
  });
  it('the real script, same spool: PUTs only (checked in the happy run too)', () => {
    plantSpool(s, 'dump', setName(s, 'dump', TS));
    expect(runUploader(s).code).toBe(0);
    expect(fake.log().every((l) => l.startsWith('PUT '))).toBe(true);
  });
});

describe('R4 configuration: exit 3, nothing sent', () => {
  const cases: Array<[string, () => void, string]> = [
    ['an empty credential', () => {}, 'upload.sh: backup_store_credential missing'],
    ['B2_BUCKET absent', () => writeConf(s, 'ops.conf', 'B2_S3_ENDPOINT=https://s3.eu-fake-001.backblazeb2.com\n'), 'upload.sh: B2_BUCKET missing or malformed'],
    ['B2_S3_ENDPOINT absent', () => writeConf(s, 'ops.conf', `B2_BUCKET=${BUCKET}\n`), 'upload.sh: B2_S3_ENDPOINT missing or malformed'],
    ['B2_S3_ENDPOINT on another host', () => writeConf(s, 'ops.conf', `B2_BUCKET=${BUCKET}\nB2_S3_ENDPOINT=https://s3.eu-fake-001.backblazeb2.com.evil.example\n`), 'upload.sh: B2_S3_ENDPOINT missing or malformed'],
    ['B2_S3_ENDPOINT over http', () => writeConf(s, 'ops.conf', `B2_BUCKET=${BUCKET}\nB2_S3_ENDPOINT=http://s3.eu-fake-001.backblazeb2.com\n`), 'upload.sh: B2_S3_ENDPOINT missing or malformed'],
    ['B2_S3_ENDPOINT with a path', () => writeConf(s, 'ops.conf', `B2_BUCKET=${BUCKET}\nB2_S3_ENDPOINT=https://s3.eu-fake-001.backblazeb2.com/x\n`), 'upload.sh: B2_S3_ENDPOINT missing or malformed'],
    ['POLY_INSTANCE absent', () => writeConf(s, 'host.env', 'OTHER=1\n'), 'upload.sh: POLY_INSTANCE missing or malformed'],
    ['POLY_INSTANCE with a slash', () => writeConf(s, 'host.env', 'POLY_INSTANCE=../x\n'), 'upload.sh: POLY_INSTANCE missing or malformed'],
  ];
  for (const [label, plant, msg] of cases) {
    it(`${label} -> exit 3 \`${msg}\``, () => {
      plantSpool(s, 'dump', setName(s, 'dump', TS));
      plant();
      const extra = label === 'an empty credential' ? ['-v', '/dev/null:/run/secrets/backup_store_credential:ro'] : [];
      const r = runUploader(s, { extra });
      expect({ code: r.code, last: lastLine(r.err), out: r.out }).toEqual({ code: 3, last: msg, out: '' });
      expect(fake.log()).toEqual([]);
    });
  }
  it('conf is parsed by exact pattern, never sourced: a command substitution in ops.conf is not run', () => {
    writeConf(s, 'ops.conf', `B2_BUCKET=${BUCKET}\nB2_S3_ENDPOINT=https://s3.eu-fake-001.backblazeb2.com\nEVIL=$(touch /tmp/pwned)\n`);
    plantSpool(s, 'dump', setName(s, 'dump', TS));
    const chk = s.compose('run', '--rm', '--no-deps', '-T', '--entrypoint', 'bash', 'uploader', '-c', `${UP} >/dev/null 2>&1; test ! -e /tmp/pwned && echo clean`);
    expect(chk.out.trim()).toBe('clean');
  });
});

describe('U4/C11: the rclone config is a 0600 tmpfs file; no key in argv or environment; the exact argv', () => {
  it('while an upload is in flight: /tmp/rclone.conf is 0600 and holds the key; no process argv or environ holds either key; rclone runs the ruled argv', async () => {
    const n = setName(s, 'dump', TS);
    plantSpool(s, 'dump', n);
    fake.mode('slow', 6000);
    let probe = '';
    const r = await uploaderDuring(s, (exec) => {
      for (let i = 0; i < 20 && !/copyto/.test(probe); i++) {
        probe = exec('sh', '-c', 'for p in /proc/[0-9]*; do tr "\\0" " " < $p/cmdline 2>/dev/null; echo; done').out;
        if (!/copyto/.test(probe)) sh('sleep', ['0.5']);
      }
      const mode = exec('stat', '-c', '%a %u', '/tmp/rclone.conf').out.trim();
      const hasKey = exec('grep', '-c', APP_KEY, '/tmp/rclone.conf').out.trim();
      const leak = exec('bash', '-c', `A='${APP_KEY.slice(0, 8)}''${APP_KEY.slice(8)}'; K='${KEY_ID.slice(0, 8)}''${KEY_ID.slice(8)}'; n=0; while IFS= read -r l; do if [[ $l == *"$A"* || $l == *"$K"* ]]; then n=$((n+1)); fi; done < <(for p in /proc/[0-9]*; do tr "\\0" "\\n" < $p/cmdline 2>/dev/null; tr "\\0" "\\n" < $p/environ 2>/dev/null; done); echo $n`).out.trim();
      probe += `\nMODE=${mode}\nHASKEY=${hasKey}\nLEAK=${leak}\n`;
    });
    expect(r.code).toBe(0);
    expect(probe).toContain('MODE=600 10005');
    expect(probe).toContain('HASKEY=1');
    expect(probe).toContain('LEAK=0');
    const argv = probe.split('\n').find((l) => /rclone .*copyto/.test(l)) ?? '';
    expect(argv.trim()).toBe(`rclone --config /tmp/rclone.conf copyto /spool/dump/${n} b2:${BUCKET}/${INSTANCE}/${s.major}/dump/${n} --no-check-dest --s3-no-head --s3-upload-cutoff 5G --retries 1 --low-level-retries 1`);
    expect(argv).not.toMatch(/--ignore-checksum|--s3-disable-checksum/);
  }, 120_000);
});

describe('T4, T3: no route where there must be none', () => {
  const up_ = () => s.cfg.services.uploader;
  it('T4: the rendered uploader mounts no db_password_* and is on upload-net only', () => {
    const mounted = (up_().secrets ?? []).map((x: any) => x.target ?? x.source);
    expect(mounted.some((x: string) => /db_password/.test(x))).toBe(false);
    expect(Object.keys(up_().networks ?? {})).toEqual(['upload-net']);
  });
  it('T4: a TCP connect from the uploader to postgres:5432 fails; RED ON THE FAULT: the same connect succeeds once the container is put on the postgres network', () => {
    const name = `${PROJECT}-up-net`;
    sh('docker', ['rm', '-f', name]);
    const st = s.compose('run', '-d', '--no-deps', '--name', name, '--entrypoint', 'sleep', 'uploader', '600');
    expect(st.code, st.err).toBe(0);
    try {
      const probe = () => sh('docker', ['exec', name, 'bash', '-c', 'timeout 5 bash -c ": </dev/tcp/postgres/5432"']).code;
      expect(probe()).not.toBe(0);
      expect(sh('docker', ['network', 'connect', 'polycarpic-prod_default', name]).code).toBe(0);
      expect(probe()).toBe(0);
    } finally { sh('docker', ['rm', '-f', name]); }
  });
  it('T3: the backup container (backup-net, internal) cannot connect to fake-b2; RED ON THE FAULT: it can once attached to a routable network', () => {
    const name = `${PROJECT}-bk-net`;
    const net = `${PROJECT}-routable`;
    sh('docker', ['rm', '-f', name]);
    const ip = sh('docker', ['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', fake.name]).out.trim();
    const st = s.compose('run', '-d', '--no-deps', '--name', name, '--entrypoint', 'sleep', 'backup', '600');
    expect(st.code, st.err).toBe(0);
    try {
      const probe = () => sh('docker', ['exec', name, 'bash', '-c', `timeout 5 bash -c ": </dev/tcp/${ip}/443"`]).code;
      expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      expect(probe()).not.toBe(0);
      sh('docker', ['network', 'create', net]);
      sh('docker', ['network', 'connect', net, fake.name]);
      sh('docker', ['network', 'connect', net, name]);
      const ip2 = sh('docker', ['inspect', '-f', `{{(index .NetworkSettings.Networks "${net}").IPAddress}}`, fake.name]).out.trim();
      expect(sh('docker', ['exec', name, 'bash', '-c', `timeout 5 bash -c ": </dev/tcp/${ip2}/443"`]).code).toBe(0);
    } finally { sh('docker', ['rm', '-f', name]); sh('docker', ['network', 'disconnect', '-f', net, fake.name]); sh('docker', ['network', 'rm', net]); }
    expect(TOOLS).toBeTruthy();
  });
  it('T3: the rendered backup service mounts no backup_store_credential and holds no B2 endpoint or bucket', () => {
    const b = s.cfg.services.backup;
    expect(JSON.stringify(b.secrets ?? [])).not.toMatch(/backup_store_credential|heartbeat_url/);
    expect(JSON.stringify(b)).not.toMatch(/backblaze|B2_/i);
  });
});

describe('C2: no core dumps', () => {
  it('`ulimit -c` is 0 inside the rendered uploader container', () => {
    const r = s.compose('run', '--rm', '--no-deps', '-T', '--entrypoint', 'bash', 'uploader', '-c', 'ulimit -c');
    expect(r.out.trim()).toBe('0');
  });
});

describe('T14: the uploader cannot change the spool', () => {
  const inUploader = (cmd: string) => s.compose('run', '--rm', '--no-deps', '-T', '--entrypoint', 'bash', 'uploader', '-c', cmd);
  it('from the rendered service: creating, replacing and deleting a spool file each fail (read-only mount)', () => {
    const n = setName(s, 'dump', TS);
    plantSpool(s, 'dump', n);
    for (const [label, cmd] of [['create', 'touch /spool/dump/new'], ['replace', `printf x > /spool/dump/${n}`], ['delete', `rm /spool/dump/${n}`], ['wal create', 'touch /spool/wal/new'], ['premigration create', 'touch /spool/premigration/new']] as const) {
      const r = inUploader(`{ ${cmd}; } 2>&1`);
      expect({ label, code: r.code !== 0, out: r.out }).toEqual({ label, code: true, out: expect.stringMatching(label === 'replace' ? /Read-only file system|Permission denied/ : /Read-only file system/) });
    }
    expect(s.ls('dump')).toEqual([n]);
  });
  it('the ACL alone also refuses (mount rw, 10005 r-x): `Permission denied`; RED ON THE FAULT: with a rwx ACL and a rw mount the write succeeds', () => {
    const n = setName(s, 'dump', TS);
    plantSpool(s, 'dump', n);
    const run = (volume: string, cmd: string) => sh('docker', ['run', '--rm', '--user', '10005:10005', '-v', `${volume}:/spool/dump`, '--entrypoint', 'bash', TOOLS, '-c', cmd]);
    const denied = run(s.vol('dump'), `rm /spool/dump/${n} 2>&1; touch /spool/dump/new 2>&1`);
    expect(denied.out).toMatch(/Permission denied/);
    expect(s.ls('dump')).toEqual([n]);
    const rwx = `${PROJECT}-rwxvol`;
    sh('docker', ['volume', 'create', rwx]);
    try {
      sh('docker', ['run', '--rm', '-v', `${rwx}:/v`, '--entrypoint', 'bash', TOOLS, '-c', 'setfacl -m u:10005:rwx /v']);
      expect(run(rwx, 'touch /spool/dump/new && echo created').out).toContain('created');
    } finally { sh('docker', ['volume', 'rm', '-f', rwx]); }
  });
});
