// POLY-138 (ruling d5ead294), the static tests: R6 (Postgres hold and pin), R7 (no Go checksum bypass), R8 (renovate.json),
// R9 (.dockerignore test names). No Docker, no network. Each test names the mutation that turns it red.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const lines = (rel: string) => read(rel).split('\n');

describe('R6: the Postgres image runs the minor its tag names', () => {
  const FROM_17_12 = 'FROM postgres:17.12@sha256:b60e90042aa6b8dbecd58e224b3e36114dbf8ad754465264c2476ad58a86e45c';
  const hold = /apt-mark hold "?postgresql-\$PG_MAJOR"? "?postgresql-client-\$PG_MAJOR"?/;
  it('infra/postgres/Dockerfile FROM is 17.12 at the ruled index digest', () => {
    expect(lines('infra/postgres/Dockerfile').find((l) => l.startsWith('FROM '))).toBe(FROM_17_12); // red: still 17.10 or another digest
  });
  it('infra/postgres/Dockerfile: the hold comes before apt-get upgrade, in the same RUN', () => {
    const run = read('infra/postgres/Dockerfile').split(/\n(?=[A-Z]+ )/).find((i) => /apt-get upgrade/.test(i)) ?? '';
    expect(run.startsWith('RUN '), 'the upgrade is in a RUN').toBe(true);
    const h = run.search(hold), u = run.indexOf('apt-get upgrade');
    expect(h, 'a hold on postgresql-$PG_MAJOR and postgresql-client-$PG_MAJOR').toBeGreaterThanOrEqual(0); // red: no hold
    expect(h).toBeLessThan(u); // red: the hold sits after the upgrade
  });
  it('infra/postgres/Dockerfile still upgrades (OS fixes land on the weekly rebuild), and installs age pinned', () => {
    expect(read('infra/postgres/Dockerfile')).toMatch(/apt-get upgrade -y/); // red: the upgrade dropped
    expect(read('infra/postgres/Dockerfile')).toMatch(/age=1\.2\.1-1\+b5/);
  });
  it('tests/db/docker/Dockerfile: the same hold comes before the pgtap install', () => {
    const run = read('tests/db/docker/Dockerfile').split(/\n(?=[A-Z]+ )/).find((i) => /postgresql-17-pgtap/.test(i)) ?? '';
    const h = run.search(hold), i = run.indexOf('apt-get install');
    expect(h, 'a hold in the pgtap RUN').toBeGreaterThanOrEqual(0); // red: no hold (pgtap would move the server to the newest minor)
    expect(h).toBeLessThan(i);
  });
  it('the pgtap image is built from the same FROM line (one owner of the pin)', () => {
    expect(read('tests/db/docker/Dockerfile')).toMatch(/^ARG PG_BASE\nFROM \$\{PG_BASE\}$/m);
  });
});

describe('R7: nothing in the Caddy build disables Go checksum verification', () => {
  it.each(['GOSUMDB', 'GONOSUMDB', 'GONOSUMCHECK', 'GONOVERIFY', 'GOPRIVATE', 'GOINSECURE', 'GOFLAGS', '-insecure'])(
    'infra/caddy/Dockerfile does not contain %s', (tok) => {
      const code = lines('infra/caddy/Dockerfile').filter((l) => !l.trim().startsWith('#')).join('\n');
      expect(code.includes(tok), tok).toBe(false); // red: any of these added to the Dockerfile (mutation run: GOFLAGS=-mod=mod)
    });
  it('the build still stages xcaddy with the x/net replacement (the mechanism the property test lets us remove later)', () => {
    expect(read('infra/caddy/Dockerfile')).toMatch(/xcaddy build v2\.11\.9 --replace golang\.org\/x\/net=golang\.org\/x\/net@v0\.62\.0/);
  });
});

describe('R8: renovate.json', () => {
  const WANT = {
    $schema: 'https://docs.renovatebot.com/renovate-schema.json',
    enabledManagers: ['dockerfile', 'custom.regex'],
    includePaths: ['infra/postgres/Dockerfile', 'infra/caddy/Dockerfile'],
    minimumReleaseAge: '3 days',
    automerge: false,
    customManagers: [
      {
        customType: 'regex',
        managerFilePatterns: ['/^infra/postgres/Dockerfile$/'],
        matchStrings: ['\\bage=(?<currentValue>\\S+)'],
        depNameTemplate: 'age',
        datasourceTemplate: 'deb',
        versioningTemplate: 'deb',
        registryUrlTemplate: 'https://deb.debian.org/debian?suite=trixie&components=main&binaryArch=amd64',
      },
      {
        customType: 'regex',
        managerFilePatterns: ['/^infra/caddy/Dockerfile$/'],
        matchStrings: ['xcaddy build v(?<currentValue>\\d+\\.\\d+\\.\\d+)'],
        depNameTemplate: 'caddy',
        datasourceTemplate: 'docker',
      },
    ],
    packageRules: [
      { matchDatasources: ['docker'], matchDepNames: ['postgres'], allowedVersions: '<18', minimumReleaseAgeBehaviour: 'timestamp-optional' },
      { matchDepNames: ['caddy'], groupName: 'caddy' },
    ],
  };
  it('exists at the repo root and equals the ruled keys exactly', () => {
    expect(existsSync(join(ROOT, 'renovate.json'))).toBe(true); // red: no file
    expect(JSON.parse(read('renovate.json'))).toEqual(WANT); // red: any key drifts (a wider includePaths, automerge true, a shorter age)
  });
  it('there is one config, not two (.github/renovate.json would shadow it)', () => {
    expect(existsSync(join(ROOT, '.github', 'renovate.json'))).toBe(false);
  });
  it("the Postgres allowedVersions major is one below infra/postgres-major's", () => {
    const major = Number(read('infra/postgres-major').trim());
    const rule = JSON.parse(read('renovate.json')).packageRules.find((r: any) => r.matchDepNames?.includes('postgres'));
    expect(rule.allowedVersions).toBe(`<${major + 1}`); // red: the major moves in one file and not the other
  });
});

describe('R9: .dockerignore excludes every test name the lint counts', () => {
  const ign = () => lines('.dockerignore').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  it.each(['**/*.test.*', '**/*.spec.*', 'packages/secrets/**/*.test.*', 'packages/secrets/**/*.spec.*'])('has %s', (want) => {
    expect(ign()).toContain(want); // red: the line is missing
  });
  it.each(['**/*.test.ts', 'packages/secrets/**/*.test.ts'])('the narrower %s is replaced, not kept beside', (old) => {
    expect(ign()).not.toContain(old);
  });
  it('both packages/secrets/** lines come after the !packages/secrets negation', () => {
    const l = ign(), neg = l.indexOf('!packages/secrets');
    expect(neg, 'the negation exists').toBeGreaterThanOrEqual(0);
    for (const want of ['packages/secrets/**/*.test.*', 'packages/secrets/**/*.spec.*']) {
      expect(l.indexOf(want), want).toBeGreaterThan(neg); // red: before the negation (the later rule wins), or missing (-1)
    }
  });
});
