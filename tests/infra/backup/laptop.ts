// POLY-99 R7/R8 harness: runs infra/restore.sh and infra/drill.sh on the host (the "laptop") with shims first on PATH. The scripts are the unit
// under test; only their OUTSIDE (ssh, the box, fdesetup, uname) is faked. `docker` and `age` are logging wrappers around the real ones, so
// the scratch Postgres is a real container and the decryption is real.
//
// CONTRACT pinned here (qa pins 25-33 in test-plan.md):
//  - `infra/restore.sh` and `infra/drill.sh`, with `infra/backup/restore-lib.sh` and `infra/backup/b2read.py`; the scratch image comes from
//    the FROM line of `infra/postgres/Dockerfile` found relative to the script, so mutants run from a copy of `infra/`.
//  - stdout, on success, ends with `scratch container: <name>` and `connect: docker exec -it <name> psql -U postgres`.
//  - stderr: `restore.sh: <reason>`; the last stderr line is the refusal. `WARN ...` lines carry the ruled WARN text.
//  - the read credential file is two lines (key id, application key); `POLY_B2_AUTH_URL` is the one endpoint override.
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, sh, type Res, type Stack } from './stack.ts';
import type { Fake } from './uploader.ts';

export const READ_KEY_ID = '0049fixturereadkeyid00000001';
export const READ_KEY = 'K004FIXTUREREADAPPKEY0000000000000';
const w = (p: string, t: string, mode = 0o755) => { writeFileSync(p, t); chmodSync(p, mode); };

export type Laptop = {
  dir: string; infra: string; log: string; dockerLog: string; ageLog: string; boxDir: string; identity: string; credential: string;
  sshLog: () => string; ageCalls: () => string[]; dockerCalls: () => string[];
  setFdesetup: (code: number) => void;
  setBox: (o: { files?: Record<string, Buffer>; record?: Array<[string, string]>; list?: string | null }) => void;
  run: (script: 'restore.sh' | 'drill.sh', args: string[], o?: { env?: Record<string, string>; infra?: string; identityMode?: number; cwd?: string }) => Res & { stdoutLines: string[] };
  mutantInfra: (file: string, from: string | RegExp, to: string) => string;
  /** a second change on top of a mutant copy made by mutantInfra */
  mutantInfraFrom: (dir: string, file: string, from: string | RegExp, to: string) => string;
  scratches: () => string[];
  cleanup: () => void;
};

export function laptop(s: Stack, fake?: Fake): Laptop {
  const dir = mkdtempSync(join(tmpdir(), 'poly99-laptop-'));
  const bin = join(dir, 'bin'), boxbin = join(dir, 'boxbin'), boxDir = join(dir, 'box');
  for (const d of [bin, boxbin, boxDir, join(boxDir, 'premigration'), join(dir, 'tmp')]) mkdirSync(d, { recursive: true });
  const log = join(dir, 'ssh.log'), dockerLog = join(dir, 'docker.log'), ageLog = join(dir, 'age.log');
  for (const f of [log, dockerLog, ageLog]) writeFileSync(f, '');
  copyFileSync(join(ROOT, 'tests', 'infra', 'backup', 'shims', 'ssh'), join(bin, 'ssh')); chmodSync(join(bin, 'ssh'), 0o755);
  const realDocker = sh('bash', ['-c', 'command -v docker']).out.trim();
  const realAge = sh('bash', ['-c', 'command -v age']).out.trim();
  // age is a logging wrapper; the scratch containers get a --label so a test can find and remove its own
  // POLY99_SCRATCH_FAIL=1 makes `docker run` (the scratch start) fail at once after it is logged: a case that only needs to see whether the script GOT to the
  // scratch (a refusal exits before it; a mutant without the check reaches it) never pays for a real restore (ruling Guards @ 2bf5a6ba).
  w(join(bin, 'docker'), `#!/bin/bash\nprintf '%s\\n' "$*" >> '${dockerLog}'\nif [ "$1" = run ] && [ -n "\${POLY99_SCRATCH_FAIL:-}" ]; then echo "docker: scratch start refused by the test shim" >&2; exit 125; fi\nexec '${realDocker}' "$@"\n`);
  w(join(bin, 'age'), `#!/bin/bash\nprintf '%s\\n' "$*" >> '${ageLog}'\nexec '${realAge}' "$@"\n`);
  w(join(bin, 'fdesetup'), `#!/bin/bash\nexit "$(cat '${join(dir, 'fde')}')"\n`);
  w(join(bin, 'uname'), `#!/bin/bash\nif [ "$1" = "-s" ] || [ $# = 0 ]; then echo Darwin; else exec /usr/bin/uname "$@"; fi\n`);
  writeFileSync(join(dir, 'fde'), '0');
  w(join(boxbin, 'sudo'), '#!/bin/bash\nexec "$@"\n');
  w(join(boxbin, 'polycarpic-ops'), `#!/bin/bash\nexec python3 '${join(ROOT, 'tests', 'infra', 'backup', 'fake_box.py')}' "$@"\n`);
  const identity = join(dir, 'identity.txt');
  writeFileSync(identity, s.identity); chmodSync(identity, 0o600);
  const credential = join(dir, 'read-credential');
  writeFileSync(credential, `${READ_KEY_ID}\n${READ_KEY}\n`); chmodSync(credential, 0o600);
  const infra = join(dir, 'infra');
  cpSync(join(ROOT, 'infra'), infra, { recursive: true, filter: (src) => !/node_modules|\/\.git/.test(src) });
  // drill.sh reads roles.sql as `$here/../packages/db/sql/roles.sql` (DR5, DR6)
  mkdirSync(join(dir, 'packages', 'db', 'sql'), { recursive: true });
  copyFileSync(join(ROOT, 'packages', 'db', 'sql', 'roles.sql'), join(dir, 'packages', 'db', 'sql', 'roles.sql'));

  const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
  return {
    dir, infra, log, dockerLog, ageLog, boxDir, identity, credential,
    sshLog: () => read(log), ageCalls: () => read(ageLog).split('\n').filter(Boolean), dockerCalls: () => read(dockerLog).split('\n').filter(Boolean),
    setFdesetup: (code) => writeFileSync(join(dir, 'fde'), String(code)),
    setBox: (o) => {
      rmSync(join(boxDir, 'premigration'), { recursive: true, force: true }); mkdirSync(join(boxDir, 'premigration'), { recursive: true });
      for (const [n, b] of Object.entries(o.files ?? {})) writeFileSync(join(boxDir, 'premigration', n), b);
      writeFileSync(join(boxDir, 'spool.sha256'), (o.record ?? []).map(([h, p]) => `${h} ${p}\n`).join(''));
      writeFileSync(join(dir, 'box.env'), o.list === undefined || o.list === null ? '' : o.list);
      writeFileSync(join(dir, 'box.listmode'), o.list === undefined || o.list === null ? 'real' : 'override');
    },
    run: (script, args, o = {}) => {
      if (o.identityMode !== undefined) chmodSync(identity, o.identityMode);
      const useList = read(join(dir, 'box.listmode')) === 'override';
      const env: Record<string, string> = {
        PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME ?? '/tmp', TMPDIR: join(dir, 'tmp'),
        SHIM_LOG: log, BOX_BIN: boxbin, BOX_DIR: boxDir, ...(useList ? { BOX_LIST: read(join(dir, 'box.env')) } : {}),
        ...(fake ? { POLY_B2_AUTH_URL: fake.nativeUrl } : {}), ...(o.env ?? {}),
      };
      const r = sh('bash', [join(o.infra ?? infra, script), ...args], { env, timeout: 600_000 });
      if (o.identityMode !== undefined) chmodSync(identity, 0o600);
      return { ...r, stdoutLines: r.out.split('\n').filter(Boolean) };
    },
    mutantInfra: (file, from, to) => {
      const m = join(dir, `infra-mutant-${Math.random().toString(36).slice(2, 8)}`);
      cpSync(infra, m, { recursive: true });
      const f = join(m, file);
      const t = readFileSync(f, 'utf8');
      const out = t.replace(from as any, to);
      if (out === t) throw new Error(`mutant did not change ${file}: ${String(from)}`);
      writeFileSync(f, out);
      return m;
    },
    mutantInfraFrom: (m, file, from, to) => {
      const f = join(m, file);
      const t = readFileSync(f, 'utf8');
      const out = t.replace(from as any, to);
      if (out === t) throw new Error(`mutant did not change ${file}: ${String(from)}`);
      writeFileSync(f, out);
      return m;
    },
    scratches: () => sh('docker', ['ps', '-a', '--format', '{{.Names}}', '--filter', 'label=polycarpic.restore=scratch']).out.split('\n').filter(Boolean),
    cleanup: () => {
      const ids = sh('docker', ['ps', '-aq', '--filter', 'label=polycarpic.restore=scratch']).out.split('\n').filter(Boolean);
      if (ids.length) sh('docker', ['rm', '-f', '-v', ...ids]);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
