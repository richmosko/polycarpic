// POLY-86 ruling addendum 2: superuser SQL without a `docker exec psql` spawn per call. One pg.Client per database lives in a
// worker thread; the caller stays synchronous (Atomics.wait on a shared flag), so tests keep their `must(sql, db)` shape and
// their assertions. Rows come back as text (null -> ''), as `psql -At` prints them. Superuser only; psql itself stays in
// helpers/pg.ts for the tests that need its error format or a role login.
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';
import { DB_PKG, server } from './pg.ts';
import { join } from 'node:path';

type Reply = { id: number; ok: boolean; rows?: string[][]; err?: string };
const signal = new Int32Array(new SharedArrayBuffer(4));
const { port1, port2 } = new MessageChannel();
let worker: Worker | undefined;
let seq = 0;

function start(): Worker {
  return (worker ??= (() => {
    const w = new Worker(new URL('./sql-worker.mjs', import.meta.url), {
      workerData: { dbPackageJson: join(DB_PKG, 'package.json'), signal, port: port2 },
      transferList: [port2],
    });
    w.unref();
    return w;
  })());
}

const urlFor = (db: string) => server().superUrl.replace(/\/[^/]*$/, `/${db}`);

export function must(sql: string, db = 'postgres'): { ok: true; rows: string[][] } {
  const id = ++seq;
  start().postMessage({ id, url: urlFor(db), sql });
  const deadline = Date.now() + 60_000;
  while (Atomics.load(signal, 0) !== id) {
    if (Date.now() > deadline) throw new Error('sql worker: no reply in 60 s');
    Atomics.wait(signal, 0, Atomics.load(signal, 0), 1000);
  }
  const msg = receiveMessageOnPort(port1)?.message as Reply | undefined;
  if (!msg || msg.id !== id) throw new Error('sql worker: no reply');
  if (!msg.ok) throw new Error(`psql failed: ${msg.err}\n--sql--\n${sql.slice(0, 400)}`);
  return { ok: true, rows: msg.rows ?? [] };
}

/** Ends the worker's connections (called from teardown; idempotent). */
export async function closeSql(): Promise<void> {
  await worker?.terminate();
  worker = undefined;
}
