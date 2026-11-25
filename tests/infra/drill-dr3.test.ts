// POLY-104: drill.sh DR3 ("the globals file carries no password") must never PASS on a file it did not read to the end.
// Before the fix it ran `plain_stream | grep -q` under pipefail: a match makes grep leave early, the stream dies of SIGPIPE, the `if` is false
// and DR3 says PASS; a stream that cannot be read gives the same PASS. No container: the DR3 block is cut out of drill.sh and run with the real
// restore-lib.sh (plain_stream). The block is whatever stands between the DR11 result line and the "two scratch restores" comment.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';

const INFRA = join(dirname(new URL(import.meta.url).pathname), '..', '..', 'infra');
const dir = mkdtempSync(join(tmpdir(), 'poly104-dr3-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function dr3Block(): string {
  const lines = readFileSync(join(INFRA, 'drill.sh'), 'utf8').split('\n');
  const from = lines.findIndex((l) => l.includes('res PASS DR11'));
  const to = lines.findIndex((l) => l.includes('# ---- two scratch restores'));
  const block = lines.slice(from + 1, to).join('\n');
  if (from < 0 || to <= from || !block.includes('DR3')) throw new Error('cannot find the DR3 block in drill.sh between the DR11 line and the scratch restores');
  return block;
}

let n = 0;
/** -> the DR3 result lines, and whether the script got past the block */
function dr3(content: Buffer | string | null): { results: string[]; done: boolean; err: string } {
  const file = join(dir, `globals-${n++}`);
  if (content !== null) writeFileSync(file, content);
  const script = `set -euo pipefail\nPROG=drill.sh HERE=$1 WORK=$2 GLOBALS_PLAIN=$3\n. "$HERE/backup/restore-lib.sh"\nres() { echo "RES $1 $2 $3"; }\n${dr3Block()}\necho DONE\n`;
  const r = spawnSync('bash', ['-c', script, 'dr3', INFRA, dir, file], { encoding: 'utf8', timeout: 20_000 });
  const out = (r.stdout ?? '').split('\n');
  return { results: out.filter((l) => /^RES \w+ DR3 /.test(l)).map((l) => l.split(' ').slice(1, 3).join(' ')), done: out.includes('DONE'), err: r.stderr ?? '' };
}
const verdict = (content: Buffer | string | null) => { const r = dr3(content); return { results: r.results, done: r.done }; };

const ROLE = 'CREATE ROLE poly_app;\n';
const SECRET = "ALTER ROLE poly_app PASSWORD 'SCRAM-SHA-256$4096:c2FsdA==$a2V5:a2V5';\n";
const BULK = ROLE.repeat(100_000); // about 2 MB: far more than a pipe holds
const FAIL = { results: ['FAIL DR3'], done: true };
const PASS = { results: ['PASS DR3'], done: true };

describe('drill.sh DR3', () => {
  it('a small clean globals file passes, plain and gzipped', () => {
    expect(verdict(ROLE)).toEqual(PASS);
    expect(verdict(gzipSync(ROLE))).toEqual(PASS);
  });
  it('a large clean globals file passes', () => { expect(verdict(gzipSync(BULK))).toEqual(PASS); });
  it('a password in a small globals file fails', () => { expect(verdict(gzipSync(ROLE + SECRET))).toEqual(FAIL); });
  it('a password early in a large gzipped globals file fails (grep leaving early must not become a PASS)', () => { expect(verdict(gzipSync(SECRET + BULK))).toEqual(FAIL); });
  it('a password early in a large plain globals file fails', () => { expect(verdict(SECRET + BULK)).toEqual(FAIL); });
  it('a password on the last line of a large globals file fails', () => { expect(verdict(gzipSync(BULK + SECRET))).toEqual(FAIL); });
  it('a globals file that is not there fails', () => { expect(verdict(null)).toEqual(FAIL); });
  it('a corrupt gzip stream fails', () => { expect(verdict(Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from('not a gzip stream at all')]))).toEqual(FAIL); });
  it('a truncated gzip of a clean file fails: the unread part could hold a password', () => {
    const whole = gzipSync(BULK);
    expect(verdict(whole.subarray(0, Math.floor(whole.length / 2)))).toEqual(FAIL);
  });
});
