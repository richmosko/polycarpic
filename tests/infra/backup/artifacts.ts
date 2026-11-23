// POLY-99 fixtures for the restore/drill tests: REAL artifacts (a nightly set, a premigration set, WAL) produced by the real backup.sh and
// archive-wal.sh in the scratch stack, copied out of the spool volumes, and planted into fake-b2 with the object names and upload times a test needs.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSTANCE, PROJECT, TOOLS, sh, type Dir, type Stack } from './stack.ts';
import type { Fake } from './uploader.ts';

export type Files = Record<string, Buffer>;
export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
export const tsToMs = (ts: string) => Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(9, 11), +ts.slice(11, 13), +ts.slice(13, 15));
export const msToTs = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** every regular file of a spool volume directory, as bytes (the volume is read through a throwaway container and docker cp) */
export function collect(s: Stack, d: Dir): Files {
  const name = `${PROJECT}-collect`;
  sh('docker', ['rm', '-f', name]);
  const c = sh('docker', ['create', '--name', name, '-v', `${s.vol(d)}:/s`, TOOLS, 'true']);
  if (c.code !== 0) throw new Error(`collect create: ${c.err}`);
  const dst = mkdtempSync(join(tmpdir(), 'poly99-collect-'));
  try {
    const r = sh('docker', ['cp', `${name}:/s/.`, dst]);
    if (r.code !== 0) throw new Error(`collect cp: ${r.err}`);
    const out: Files = {};
    for (const f of readdirSync(dst)) { if (f.startsWith('.')) continue; try { out[f] = readFileSync(join(dst, f)); } catch { /* a directory (.inflight) */ } }
    return out;
  } finally { sh('docker', ['rm', '-f', name]); rmSync(dst, { recursive: true, force: true }); }
}

/** plant one object version (optionally with a hide action) into fake-b2 */
export function plantVersion(fake: Fake, objectName: string, data: Buffer, uploadedMs?: number, action: 'upload' | 'hide' = 'upload') {
  const tmp = mkdtempSync(join(tmpdir(), 'poly99-plant-'));
  const f = join(tmp, 'blob');
  writeFileSync(f, data);
  sh('docker', ['cp', f, `${fake.name}:/tmp/blob`]);
  rmSync(tmp, { recursive: true, force: true });
  const q = `plant?name=${encodeURIComponent(objectName)}${uploadedMs !== undefined ? `&uploaded=${uploadedMs}` : ''}${action === 'hide' ? '&action=hide' : ''}`;
  const out = fake.ctl(q, { post: true, file: '/tmp/blob' });
  return JSON.parse(out) as { fileId: string; uploadTimestamp: number };
}

/** an object and its .sha256 sibling, the way the uploader leaves them */
export function plantObject(fake: Fake, major: string, dir: Dir, name: string, data: Buffer, uploadedMs?: number, o: { sibling?: boolean | 'wrong'; instance?: string } = {}) {
  const key = `${o.instance ?? INSTANCE}/${major}/${dir}/${name}`;
  const v = plantVersion(fake, key, data, uploadedMs);
  if (o.sibling !== false) {
    const hex = o.sibling === 'wrong' ? '0'.repeat(64) : sha256(data);
    plantVersion(fake, `${key}.sha256`, Buffer.from(`${hex}  ${name}\n`), uploadedMs);
  }
  return v;
}

/** The real sets the globalSetup took (A nightly, B later poisoned nightly, P premigration, WAL) and the poison string. Read-only fixture files. */
export function fixtures(): { A: Files; B: Files; P: Files; WAL: Files; poison: string } {
  const root = process.env.POLY99_FIXTURES!;
  const load = (d: string): Files => Object.fromEntries(readdirSync(join(root, d)).map((n) => [n, readFileSync(join(root, d, n))]));
  return { A: load('A'), B: load('B'), P: load('P'), WAL: load('WAL'), poison: readFileSync(join(root, 'poison'), 'utf8') };
}
