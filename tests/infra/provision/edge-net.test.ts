// POLY-100 T-net (ruling dac66f0a, b2d0642c, S24): provision.sh --stage host creates exactly the two edge networks (fixed name, subnet, driver), reruns with no change and stops
// on a different one (never replaces); provision-check (H21) fails on a missing network, another subnet, another driver, and on an edge subnet inside a pg_hba allow range or
// inside 10.200.0.0/16 (the last two with provision-check's own expected subnet changed to match, so only the overlap rule can refuse). Fake docker: tests/infra/provision/fakes/_fake.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COMPLETE, HOST, HOST_ARGS, build, check, failLine, find, makeComplete, makeHost, run } from './box.ts';

const PROD = 'polycarpic-edge-prod';
const STG = 'polycarpic-edge-staging';
const NETS = (list: { Name: string; Driver?: string; Subnet: string }[]) =>
  `echo '${JSON.stringify(list.map((n) => ({ Name: n.Name, Driver: n.Driver ?? 'bridge', IPAM: { Config: [{ Subnet: n.Subnet }] } })))}' > /var/fake-state/networks.json`;
const GOOD = [{ Name: PROD, Subnet: '10.201.30.0/28' }, { Name: STG, Subnet: '10.202.30.0/28' }];
const HOSTRUN = `bash /repo/infra/provision.sh ${HOST_ARGS}`;
const creates = 'grep -c "^docker network create" /var/fake-state/calls.log || true';

let setupError: string | null = null;
beforeAll(() => {
  try {
    build();
    const h = makeHost();
    if (h.code !== 0) throw new Error(`the host stage did not complete on the fake box (rc ${h.code}): ${h.all.slice(-900)}`);
    const c = makeComplete();
    if (c.code !== 0) throw new Error(`planting the complete box failed: ${c.all.slice(-600)}`);
  } catch (e) { setupError = String((e as Error).message); }
}, 600_000);
beforeEach(() => { if (setupError) throw new Error(setupError); });

describe('T-net: provision.sh creates the edge networks', () => {
  it('the host stage created exactly the two, with the fixed names, subnets and the bridge driver', () => {
    const r = run(`cat /var/fake-state/networks.json; echo ===; ${creates}`, { image: HOST });
    const [json, n] = r.out.split('===');
    const nets = JSON.parse(json!).map((x: any) => [x.Name, x.Driver, x.IPAM.Config[0].Subnet]).sort();
    expect(nets).toEqual([[PROD, 'bridge', '10.201.30.0/28'], [STG, 'bridge', '10.202.30.0/28']]);
    expect(Number(n!.trim())).toBe(2);
  });

  it('a rerun changes nothing: no create call, no created-network line', () => {
    const r = run(`${HOSTRUN} 2>&1; echo ===; ${creates}`, { image: HOST });
    expect(r.out).not.toMatch(/created network/);
    expect(Number(r.out.split('===')[1]!.trim())).toBe(2); // the two of the first run, none added
  });

  it.each([
    ['another subnet', `${NETS([{ Name: PROD, Subnet: '10.201.31.0/28' }, { Name: STG, Subnet: '10.202.30.0/28' }])}`, PROD],
    ['another driver', `${NETS([{ Name: PROD, Subnet: '10.201.30.0/28', Driver: 'overlay' }, { Name: STG, Subnet: '10.202.30.0/28' }])}`, PROD],
    ['another subnet on the staging network', `${NETS([{ Name: PROD, Subnet: '10.201.30.0/28' }, { Name: STG, Subnet: '10.202.99.0/28' }])}`, STG],
  ])('a different existing network (%s) stops the stage and is never replaced', (_n, plant, name) => {
    const r = run(`${plant}; : > /var/fake-state/calls.log; ${HOSTRUN} 2>&1; echo "rc=$?"; grep -cE "^docker network (rm|create|disconnect)" /var/fake-state/calls.log || true`, { image: HOST });
    expect(r.out).not.toMatch(/rc=0/);
    expect(r.out).toContain(name);
    expect(r.out).toMatch(/not replacing/);
    expect(Number(r.out.trim().split('\n').pop())).toBe(0);
  });
});

describe('T-net: provision-check H21', () => {
  it('passes with both networks as provisioned', () => {
    const r = check(NETS(GOOD));
    expect(find(r.out, 'PASS', 'H21'), r.out.slice(-800)).toBeTruthy();
  });

  it.each([
    ['a missing network', NETS([{ Name: STG, Subnet: '10.202.30.0/28' }]), PROD],
    ['another subnet', NETS([{ Name: PROD, Subnet: '10.201.31.0/28' }, { Name: STG, Subnet: '10.202.30.0/28' }]), PROD],
    ['another driver', NETS([{ Name: PROD, Subnet: '10.201.30.0/28' }, { Name: STG, Subnet: '10.202.30.0/28', Driver: 'macvlan' }]), STG],
  ])('fails on %s', (_n, plant, name) => {
    const r = check(plant);
    failLine(r, 'H21', [name]);
    expect(r.code).toBe(1);
  });

  // Only the overlap rule can refuse: the checker's expected subnet is edited to match the planted network, so name, subnet and driver all agree.
  const withExpected = (from: string, to: string, plant: string) => `mkdir -p /tmp/x/infra; cp /repo/infra/provision-check.sh /tmp/x/infra/; ln -sfn /repo/infra/postgres /tmp/x/infra/postgres; sed -i 's#${from}#${to}#g' /tmp/x/infra/provision-check.sh; ${plant}`;
  const checkCopy = (plant: string) => run(`bash -c 'true'; ${plant}\nPOLY_NTP_WAIT=2 bash /tmp/x/infra/provision-check.sh --b2-capabilities /repo/tests/infra/provision/fixtures/b2-capabilities.json --b2-bucket polycarpic-hetzner-backups`, { image: COMPLETE });

  it('fails on an edge subnet inside a pg_hba allow range, though the name, subnet and driver match the (edited) expectation', () => {
    const r = checkCopy(withExpected('10.201.30.0/28', '10.201.1.0/28', NETS([{ Name: PROD, Subnet: '10.201.1.0/28' }, { Name: STG, Subnet: '10.202.30.0/28' }])));
    failLine(r, 'H21', [/overlap/i, PROD]);
  });

  it('fails on an edge subnet inside 10.200.0.0/16, the Docker default pool', () => {
    const r = checkCopy(withExpected('10.202.30.0/28', '10.200.5.0/28', NETS([{ Name: PROD, Subnet: '10.201.30.0/28' }, { Name: STG, Subnet: '10.200.5.0/28' }])));
    failLine(r, 'H21', [/overlap/i, STG]);
  });

  it('the edited copy with the shipped subnets still passes (so the two cases above fail only on the overlap)', () => {
    const r = checkCopy(withExpected('10.203.0.0/28', '10.203.0.0/28', NETS(GOOD)));
    expect(find(r.out, 'PASS', 'H21'), r.out.slice(-800)).toBeTruthy();
  });
});
