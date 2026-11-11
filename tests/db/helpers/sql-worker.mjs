// The worker half of helpers/sql.ts: holds one superuser pg.Client per database and answers synchronous callers.
import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

const require = createRequire(workerData.dbPackageJson);
const pg = require('pg');
const clients = new Map();
const text = { getTypeParser: () => (v) => v }; // every value comes back as the server's text, as psql -At prints it

parentPort.on('message', async ({ id, url, sql }) => {
  const sab = workerData.signal;
  let out;
  try {
    let c = clients.get(url);
    if (!c) {
      c = new pg.Client({ connectionString: url, types: text });
      await c.connect();
      clients.set(url, c);
    }
    const res = await c.query({ text: sql, rowMode: 'array' });
    const last = Array.isArray(res) ? res[res.length - 1] : res;
    out = { ok: true, rows: (last?.rows ?? []).map((r) => r.map((v) => (v === null ? '' : v))) };
  } catch (e) {
    out = { ok: false, err: `${e.code ?? ''} ${e.message}`.trim() };
  }
  workerData.port.postMessage({ id, ...out });
  Atomics.store(sab, 0, id);
  Atomics.notify(sab, 0);
});
