// POLY-97 R1, R2, R3: infra/hetzner/create.sh against the stateful fake hcloud, and infra/hetzner/cloud-init.yaml.
// Every run is in the dry-run box (tests/infra/provision): no network, no token, no real hcloud context.
// Contract pins (test-plan.md): cloud-init.yaml carries the literal placeholder __SSH_PUBLIC_KEY__ that create.sh replaces and
// passes with --user-data-from-file; polyops is in `users:`, the sshd and sudoers drop-ins are in `write_files:`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import { ROOT, build, run } from './provision-box.ts';

beforeAll(() => build());

const KEY = 'ssh-keygen -q -t ed25519 -N "" -f /root/k >/dev/null; mkdir -p /tmp/w; cd /tmp/w;';
const CREATE = 'bash /repo/infra/hetzner/create.sh --name pc --location nbg1 --ssh-key /root/k.pub --type cpx31';
const calls = 'cat /var/fake-state/calls.log';
const MUTATING = /^hcloud \S+ (create|replace-rules|attach|delete|apply-to-resource|update|add-label|set-rules)\b/m;
const state = (q: string) => `jq -c '${q}' /var/fake-state/hcloud.json`;

describe('create.sh (R1)', () => {
  it('exits 2 without --type and lists the 4 vCPU / 8 GB shared x86 types only', () => {
    const r = run(`${KEY} bash /repo/infra/hetzner/create.sh --name pc --location nbg1 --ssh-key /root/k.pub 2>&1; echo "rc=$?"; ${calls}`);
    expect(r.out).toMatch(/rc=2/);
    expect(r.out).toMatch(/cpx31/);
    expect(r.out).toMatch(/cx32/);
    expect(r.out).not.toMatch(/cax21|ccx13/); // arm and dedicated types are not offered
    expect(r.out).toMatch(/--type/);
    expect(r.out).not.toMatch(/^hcloud (server|firewall|volume|ssh-key) create/m); // nothing was made
  });

  it('refuses HCLOUD_TOKEN in the environment (exit 2, names the variable, never echoes the value)', () => {
    const r = run(`${KEY} HCLOUD_TOKEN=tok-dddddddddddddddd ${CREATE} 2>&1; echo "rc=$?"; ${calls}`);
    expect(r.out).toMatch(/rc=2/);
    expect(r.all).toMatch(/HCLOUD_TOKEN/);
    expect(r.all).not.toMatch(/tok-dddddddddddddddd/);
    expect(r.out).not.toMatch(MUTATING);
  });

  it('refuses without a token too: a plain run exits 0 (positive case for the guard)', () => {
    const r = run(`${KEY} ${CREATE}; echo "rc=$?"`);
    expect(r.out).toMatch(/rc=0\s*$/);
  });

  it('run 1 creates server, firewall and volume, prints a change line per mutation, the addresses and the created line', () => {
    const r = run(`${KEY} ${CREATE}; echo "rc=$?"`);
    expect(r.out).toMatch(/rc=0/);
    expect(r.out.match(/^change: /gm)!.length).toBeGreaterThanOrEqual(4); // key, firewall, volume, server (+ attach)
    expect(r.out).toMatch(/203\.0\.113\.7/);
    expect(r.out).toMatch(/2001:db8:1::/);
    expect(r.out).toMatch(/^created: server, firewall \(22,80,443 in\), volume 20 GB$/m);
    const created = r.out.indexOf('created: server');
    expect(r.out.indexOf('203.0.113.7')).toBeLessThan(created); // addresses come before the created line
  });

  it('prints both token-removal steps in the last lines of every run, first and second', () => {
    const r = run(`${KEY} ${CREATE} > /tmp/r1; ${CREATE} > /tmp/r2; tail -n 8 /tmp/r1; echo ====; tail -n 8 /tmp/r2`);
    const [a, b] = r.out.split('====');
    for (const t of [a!, b!]) {
      expect(t).toMatch(/hcloud context delete \S+/);
      expect(t).toMatch(/console/i);
    }
  });

  it('run 2 on the same state changes nothing: only exists lines, "no changes", exit 0, no mutating verb in its call log', () => {
    const r = run(`${KEY} ${CREATE} >/dev/null; : > /var/fake-state/calls.log; ${CREATE}; echo "rc=$?"; ${calls}`);
    expect(r.out).toMatch(/rc=0/);
    expect(r.out).toMatch(/^no changes$/m);
    expect(r.out).not.toMatch(/^change: /m);
    expect(r.out).not.toMatch(MUTATING);
    expect(r.out).toMatch(/exists/);
  });

  it('attaches the firewall AT server creation and never leaves the server unfirewalled', () => {
    const r = run(`${KEY} ${CREATE} >/dev/null; ${calls}`);
    const sc = r.out.split('\n').find((l) => /^hcloud server create /.test(l))!;
    expect(sc, 'hcloud server create was called').toBeDefined();
    expect(sc).toMatch(/--firewall pc\b/);
    expect(sc).toMatch(/--image ubuntu-24\.04/);
    expect(sc).toMatch(/--type cpx31/);
    const order = r.out.split('\n').map((l) => l.split(' ').slice(0, 3).join(' '));
    expect(order.indexOf('hcloud firewall create')).toBeLessThan(order.indexOf('hcloud server create'));
  });

  it('the firewall is exactly three inbound tcp rules (22, 80, 443), each from 0.0.0.0/0 and ::/0, no ICMP and no outbound rules', () => {
    const r = run(`${KEY} ${CREATE} >/dev/null; ${state('.firewalls[0].rules | map({d: .direction, p: .protocol, port: .port, s: (.source_ips|sort)}) | sort_by(.port)')}`);
    const rules = JSON.parse(r.out.trim().split('\n').pop()!);
    expect(rules).toEqual(['22', '443', '80'].map((port) => ({ d: 'in', p: 'tcp', port, s: ['0.0.0.0/0', '::/0'] })));
  });

  it('no port other than 22, 80, 443 appears in any hcloud argument', () => {
    const r = run(`${KEY} ${CREATE} >/dev/null; ${calls}`);
    expect(r.out, 'server create was called').toMatch(/^hcloud server create /m);
    const args = r.out.split('\n').filter((l) => /^hcloud /.test(l)).join(' ');
    expect(args).not.toMatch(/\b(5432|8080|3000|2375|9000|\d{4,5})\b(?!-)/); // ids and sizes are 2-3 digits here; any 4-5 digit token is a port
  });

  it('volume <name>-data is 20 GB, attached, and not formatted or automounted', () => {
    const r = run(`${KEY} ${CREATE} >/dev/null; ${calls}; ${state('.volumes | map({n: .name, s: .size, srv: (.server != null)})')}`);
    expect(r.out).toMatch(/\[\{"n":"pc-data","s":20,"srv":true\}\]/);
    const vc = r.out.split('\n').filter((l) => /^hcloud volume (create|attach)/.test(l)).join(' ');
    expect(vc).not.toMatch(/--format|--automount/);
  });

  it('every resource carries the label polycarpic=managed', () => {
    const r = run(`${KEY} ${CREATE} >/dev/null; ${state('[.ssh_keys[], .firewalls[], .servers[], .volumes[]] | map(.labels.polycarpic)')}`);
    expect(JSON.parse(r.out.trim().split('\n').pop()!)).toEqual(['managed', 'managed', 'managed', 'managed']);
  });

  it('an SSH key already uploaded under another name is matched by fingerprint, not duplicated', () => {
    const r = run(`${KEY} hcloud ssh-key create --name someone-elses --public-key-from-file /root/k.pub >/dev/null; ${CREATE} >/dev/null; ${state('[(.ssh_keys | length), (.servers | length)]')}`);
    expect(r.out.trim().split('\n').pop()).toBe('[1,1]'); // one key, and the server was created with it
  });

  it('passes the public key to the server through user-data (placeholder replaced) from a file', () => {
    const r = run(`${KEY} ${CREATE} >/dev/null; ${calls}; echo ====; cat /var/fake-state/user-data.yaml; echo ====; cat /root/k.pub`);
    const [c, ud, pub] = r.out.split('====');
    expect(c).toMatch(/--user-data-from-file/);
    expect(ud).not.toMatch(/__SSH_PUBLIC_KEY__/);
    expect(ud).toContain(pub!.trim().split(' ').slice(0, 2).join(' '));
  });

  it('drift: a planted 5432 rule is reset to the three rules and reported', () => {
    const plant = `jq '.firewalls[0].rules += [{direction:"in",protocol:"tcp",port:"5432",source_ips:["0.0.0.0/0","::/0"],destination_ips:[]}]' /var/fake-state/hcloud.json > /tmp/h && cp /tmp/h /var/fake-state/hcloud.json`;
    const r = run(`${KEY} ${CREATE} >/dev/null; ${plant}; ${CREATE}; echo "rc=$?"; ${state('.firewalls[0].rules | map(.port) | sort')}`);
    expect(r.out).toMatch(/rc=0/);
    expect(r.out).toMatch(/^change: firewall rules reset \(was: [^)]*5432[^)]*\)$/m);
    expect(r.out.trim().split('\n').pop()).toBe('["22","443","80"]');
  });

  it('drift: an added ICMP rule and an added outbound rule are each reset', () => {
    const plant = (rule: string) => `jq '.firewalls[0].rules += [${rule}]' /var/fake-state/hcloud.json > /tmp/h && cp /tmp/h /var/fake-state/hcloud.json`;
    for (const rule of ['{direction:"in",protocol:"icmp",source_ips:["0.0.0.0/0"],destination_ips:[]}', '{direction:"out",protocol:"tcp",port:"443",source_ips:[],destination_ips:["0.0.0.0/0"]}']) {
      const r = run(`${KEY} ${CREATE} >/dev/null; ${plant(rule)}; ${CREATE}; ${state('.firewalls[0].rules | length')}`);
      expect(r.out).toMatch(/^change: firewall rules reset/m);
      expect(r.out.trim().split('\n').pop()).toBe('3');
    }
  });

  it('drift: a rule with a narrowed source (22 from one address) is reset too', () => {
    const plant = `jq '.firewalls[0].rules[0].source_ips = ["198.51.100.1/32"]' /var/fake-state/hcloud.json > /tmp/h && cp /tmp/h /var/fake-state/hcloud.json`;
    const r = run(`${KEY} ${CREATE} >/dev/null; ${plant}; ${CREATE}; ${state('[.firewalls[0].rules[] | .source_ips | sort] | unique')}`);
    expect(r.out).toMatch(/^change: firewall rules reset/m);
    expect(r.out.trim().split('\n').pop()).toBe('[["0.0.0.0/0","::/0"]]');
  });

  // Hetzner applies the UNION of every firewall on a server, so one attached in the console opens ports without touching ours (D-7).
  // Pinned behaviour: create.sh prints `change: firewall detached (<name>)` and detaches it (exit 0); the server ends with only ours.
  const SECOND = `hcloud firewall create --name console-fw >/dev/null; hcloud firewall apply-to-resource console-fw --type server --server pc >/dev/null;`;
  it('drift: a second firewall applied to the server in the console is detached and reported; the server ends with exactly our one', () => {
    const r = run(`${KEY} ${CREATE} >/dev/null; ${SECOND} ${CREATE}; echo "rc=$?"; ${state('[.servers[0].public_net.firewalls | length, (.firewalls[] | select(.name=="console-fw") | .applied_to | length), (.firewalls[] | select(.name=="pc") | .applied_to | length)]')}; ${calls}`);
    expect(r.out).toMatch(/rc=0/);
    expect(r.out).toMatch(/^change: firewall detached \(console-fw\)$/m);
    expect(r.out).toContain('[1,0,1]');
    expect(r.out).toMatch(/^hcloud firewall remove-from-resource console-fw /m);
    expect(r.out).not.toMatch(/^hcloud firewall delete/m); // detached, never deleted: it is not ours
  });
  it('drift: the same run with only our firewall prints no detach line and makes no remove call', () => {
    const r = run(`${KEY} ${CREATE} >/dev/null; : > /var/fake-state/calls.log; ${CREATE}; ${calls}`);
    expect(r.out).not.toMatch(/firewall detached/);
    expect(r.out).not.toMatch(/remove-from-resource/);
    expect(r.out).toMatch(/^no changes$/m);
  });

  it('reads no token and calls only hcloud: no curl, no HCLOUD_TOKEN, no context switch in its call log', () => {
    const r = run(`${KEY} ${CREATE} >/dev/null; ${calls}`);
    expect(r.out).toMatch(/^hcloud server create /m);
    expect(r.out).not.toMatch(/^curl /m);
    expect(r.out).not.toMatch(/hcloud context (create|use)/);
  });
});

// Ruling Addendum 2 @ 512d9c50 and Addendum 3 @ 1eafa6c5 (P2): create.sh substitutes only `ssh-ed25519 <base64>` and drops the comment.
describe('create.sh key file (Addendum 2/3)', () => {
  const B64 = `$(cut -d' ' -f2 /root/k.pub)`;
  const withKey = (file: string) => `${KEY} ${file}; bash /repo/infra/hetzner/create.sh --name pc --location nbg1 --ssh-key /root/bad.pub --type cpx31 2>&1; echo "rc=$?"; cat /var/fake-state/calls.log 2>/dev/null`;
  const refused = (name: string, file: string) =>
    it(`refuses ${name}: exit 2, nothing created`, () => {
      const r = run(withKey(file));
      expect(r.out).toMatch(/rc=2/);
      expect(r.out).not.toMatch(MUTATING);
    });
  refused('an RSA key', `ssh-keygen -q -t rsa -b 2048 -N "" -f /root/rsa; cp /root/rsa.pub /root/bad.pub`);
  refused('a key file with a second non-empty line', `{ cat /root/k.pub; echo 'ssh-ed25519 AAAAevil x'; } > /root/bad.pub`);
  refused('a line that is not base64', `echo 'ssh-ed25519 !!!notbase64!!! c' > /root/bad.pub`);
  refused('an empty file', `: > /root/bad.pub`);
  refused('a comment carrying a newline-injected YAML item', `printf 'ssh-ed25519 %s a\\n  - evil\\n' "${B64}" > /root/bad.pub`);

  for (const [label, comment] of [['double quote', 'a"b'], ['single quote', "a'b"], ['colon', 'a:b: c'], ['hash and brace', 'x # {y}']] as const) {
    it(`a comment holding a ${label} is dropped: the rendered user-data has no comment text, a single ed25519 key line, and passes the schema`, () => {
      const r = run(`${KEY} printf 'ssh-ed25519 %s %s\\n' "${B64}" '${comment.replace(/'/g, `'\\''`)}' > /root/bad.pub; bash /repo/infra/hetzner/create.sh --name pc --location nbg1 --ssh-key /root/bad.pub --type cpx31 >/dev/null 2>&1; echo "rc=$?"; cat /var/fake-state/user-data.yaml; echo ==; cp /var/fake-state/user-data.yaml /tmp/ud.yaml; cloud-init schema --config-file /tmp/ud.yaml; echo "schema=$?"`);
      expect(r.out).toMatch(/rc=0/);
      const ud = r.out.split('==')[0]!;
      expect(ud).not.toContain(comment);
      expect(ud).not.toMatch(/__SSH_PUBLIC_KEY__/);
      const keys = ud.split('\n').filter((l) => /ssh-ed25519/.test(l));
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/^\s*- ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/);
      expect(r.all).toMatch(/Valid schema/);
      expect(r.out).toMatch(/schema=0/);
    });
  }

  it('positive: a plain ed25519 key with a comment is accepted (exit 0) and its comment is dropped too', () => {
    const r = run(`${KEY} ssh-keygen -q -t ed25519 -N "" -C 'laptop@home' -f /root/c; bash /repo/infra/hetzner/create.sh --name pc --location nbg1 --ssh-key /root/c.pub --type cpx31 >/dev/null 2>&1; echo "rc=$?"; cat /var/fake-state/user-data.yaml`);
    expect(r.out).toMatch(/rc=0/);
    expect(r.out).not.toContain('laptop@home');
  });
});

describe('shellcheck (R1, R5, R6; R3: inside the test container so the version is pinned with it)', () => {
  for (const f of ['infra/hetzner/create.sh', 'infra/provision.sh', 'infra/provision-check.sh']) {
    it(`${f} is shellcheck clean`, () => {
      const r = run(`shellcheck -x /repo/${f}; echo "rc=$?"`);
      expect(r.out, 'shellcheck output').toMatch(/rc=0\s*$/); // red: file absent (rc=2) until the build
    });
  }
});

describe('cloud-init.yaml (R2)', () => {
  const path = join(ROOT, 'infra', 'hetzner', 'cloud-init.yaml');
  const text = () => readFileSync(path, 'utf8');
  const cfg = () => parse(text()) as any;

  it('starts with #cloud-config and passes `cloud-init schema` in the test container', () => {
    expect(text().startsWith('#cloud-config')).toBe(true);
    const r = run(`sed "s|__SSH_PUBLIC_KEY__|ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureFixtureFixtureFixtureFixtureFixture01 t|" /repo/infra/hetzner/cloud-init.yaml > /tmp/ci.yaml; cloud-init schema --config-file /tmp/ci.yaml; echo "rc=$?"`);
    expect(r.all).toMatch(/Valid schema/);
    expect(r.out).toMatch(/rc=0/);
  });

  it('defines user polyops: bash, in no group but its own, the one placeholder key, no sudo key (sudo is the drop-in)', () => {
    const u = cfg().users.filter((x: any) => typeof x === 'object');
    expect(u).toHaveLength(1);
    expect(u[0].name).toBe('polyops');
    expect(u[0].shell).toBe('/bin/bash');
    expect([].concat(u[0].groups ?? [])).toEqual([]);
    expect(u[0].no_user_group).not.toBe(true);
    expect(u[0].ssh_authorized_keys).toEqual(['__SSH_PUBLIC_KEY__']);
    expect(u[0].sudo ?? false).toBeFalsy();
    expect(cfg().users).not.toContain('default');
  });

  it('disables root and password SSH login; updates packages; installs nothing from outside the Ubuntu archive', () => {
    expect(cfg().disable_root).toBe(true);
    expect(cfg().ssh_pwauth).toBe(false);
    expect(cfg().package_update).toBe(true);
    expect(cfg().apt?.sources ?? {}).toEqual({});
    expect(text()).not.toMatch(/\b(curl|wget|pip3?|npm|snap|git clone)\b/);
  });

  it('the sshd drop-in is /etc/ssh/sshd_config.d/10-polycarpic.conf with the H1 values and AllowUsers polyops', () => {
    const f = cfg().write_files.find((x: any) => x.path === '/etc/ssh/sshd_config.d/10-polycarpic.conf');
    expect(f, 'write_files entry for the drop-in').toBeDefined();
    const have = new Map((f.content as string).split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => [l.trim().split(/\s+/)[0]!.toLowerCase(), l.trim().split(/\s+/).slice(1).join(' ').toLowerCase()]));
    const want: Record<string, string> = {
      passwordauthentication: 'no', kbdinteractiveauthentication: 'no', permitrootlogin: 'no', pubkeyauthentication: 'yes',
      allowtcpforwarding: 'no', allowagentforwarding: 'no', allowstreamlocalforwarding: 'no', x11forwarding: 'no', permittunnel: 'no', allowusers: 'polyops',
    };
    for (const [k, v] of Object.entries(want)) expect(have.get(k), k).toBe(v);
  });

  it('the sudoers drop-in is the only sudoers file, exactly `polyops ALL=(ALL) NOPASSWD:ALL`, mode 0440', () => {
    const s = cfg().write_files.filter((x: any) => x.path.startsWith('/etc/sudoers.d/'));
    expect(s).toHaveLength(1);
    expect(s[0].content).toBe('polyops ALL=(ALL) NOPASSWD:ALL\n');
    expect(String(s[0].permissions)).toMatch(/^0?440$/);
  });

  it('holds no secret: no key name matching the secret pattern (ssh_authorized_keys aside), no private-key block, no token shape', () => {
    const names: string[] = [];
    const walk = (o: any) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { names.push(k); walk(v); } };
    walk(cfg());
    const bad = names.filter((k) => /(PASSWORD|SECRET|TOKEN|_KEY|CREDENTIAL)/i.test(k) && k !== 'ssh_authorized_keys');
    expect(bad).toEqual([]);
    expect(text()).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20}|\bpasswd:|\bchpasswd\b/);
  });
});
