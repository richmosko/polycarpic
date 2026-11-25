// A fake resolver over real UDP (POLY-161c; ruling R10, verdict B8): the zone tests ask it with a real `dns.promises.Resolver`, so the query
// name, the answer codes and the silence are what the product meets on the wire. Not product code.
import { createSocket, type Socket } from 'node:dgram';

export type Behaviour = 'soa' | 'nxdomain' | 'nodata' | 'servfail' | 'refused' | 'silent';
export interface FakeDns {
  /** `127.0.0.1:<port>`, the form `Resolver.setServers` takes. */
  address: string;
  /** Query names seen, lower-cased, in arrival order. */
  names: string[];
  /** `${type}` of every query seen. */
  types: number[];
  behaviour: Behaviour;
  /** Delay every answer by this many ms (a late answer). */
  delayMs: number;
  close(): Promise<void>;
}

const RCODE: Record<Exclude<Behaviour, 'soa' | 'nodata' | 'silent'>, number> = { nxdomain: 3, servfail: 2, refused: 5 };

function encodeName(name: string): Buffer {
  const parts = name.split('.').filter(Boolean).map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)]));
  return Buffer.concat([...parts, Buffer.from([0])]);
}
function readName(msg: Buffer, at: number): { name: string; end: number } {
  const labels: string[] = [];
  let i = at;
  while (msg[i] !== 0) {
    labels.push(msg.subarray(i + 1, i + 1 + msg[i]!).toString('latin1'));
    i += 1 + msg[i]!;
  }
  return { name: labels.join('.').toLowerCase(), end: i + 1 };
}

function answer(query: Buffer, behaviour: Behaviour): Buffer {
  const { end } = readName(query, 12);
  const question = query.subarray(12, end + 4);
  const rcode = behaviour in RCODE ? RCODE[behaviour as keyof typeof RCODE] : 0;
  const withSoa = behaviour === 'soa';
  const head = Buffer.alloc(12);
  head.writeUInt16BE(query.readUInt16BE(0), 0);
  head.writeUInt16BE(0x8180 | rcode, 2);
  head.writeUInt16BE(1, 4);
  head.writeUInt16BE(withSoa ? 1 : 0, 6);
  if (!withSoa) return Buffer.concat([head, question]);
  const rdata = Buffer.concat([encodeName('ns.example.test'), encodeName('hostmaster.example.test'), Buffer.alloc(20)]);
  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(6, 0); // SOA
  fixed.writeUInt16BE(1, 2); // IN
  fixed.writeUInt32BE(60, 4);
  fixed.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([head, question, Buffer.from([0xc0, 0x0c]), fixed, rdata]);
}

export async function startFakeDns(behaviour: Behaviour, port = 0): Promise<FakeDns> {
  const sock: Socket = createSocket('udp4');
  const fake: FakeDns = { address: '', names: [], types: [], behaviour, delayMs: 0, close: () => new Promise((r) => sock.close(() => r())) };
  sock.on('message', (msg, rinfo) => {
    const { name, end } = readName(msg, 12);
    fake.names.push(name);
    fake.types.push(msg.readUInt16BE(end));
    if (fake.behaviour === 'silent') return;
    const out = answer(msg, fake.behaviour);
    const send = () => { try { sock.send(out, rinfo.port, rinfo.address); } catch { /* closed */ } };
    if (fake.delayMs > 0) setTimeout(send, fake.delayMs).unref();
    else send();
  });
  await new Promise<void>((r) => sock.bind(port, '127.0.0.1', () => r()));
  fake.address = `127.0.0.1:${sock.address().port}`;
  return fake;
}
