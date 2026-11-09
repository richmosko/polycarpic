// ARCH 3.1c: a pg-Pool-shaped router. Inside withContextFreeTx, connect() hands back the transaction's client
// with BEGIN/COMMIT/ROLLBACK rewritten to SAVEPOINT/RELEASE/ROLLBACK TO and release() a no-op.
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();
export const currentClient = () => als.getStore()?.client ?? null;

function wrap(client) {
  let depth = 0;
  const sp = () => `sp_${depth}`;
  const rewrite = (text) => {
    if (typeof text !== 'string') return text;
    const t = text.trim().toUpperCase().replace(/;$/, '');
    if (t === 'BEGIN' || t.startsWith('BEGIN ')) { depth++; return `SAVEPOINT ${sp()}`; }
    if (t === 'COMMIT') { const s = sp(); depth--; return `RELEASE SAVEPOINT ${s}`; }
    if (t === 'ROLLBACK') { const s = sp(); depth--; return `ROLLBACK TO SAVEPOINT ${s}`; }
    return text;
  };
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'release') return () => {};
      if (prop === 'query') return (text, ...rest) => target.query(typeof text === 'string' ? rewrite(text) : text, ...rest);
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

export function createRoutingPool(plainPool) {
  const route = () => als.getStore()?.wrapped ?? null;
  return new Proxy(plainPool, {
    get(target, prop) {
      if (prop === 'connect') return (cb) => {
        const w = route();
        if (!w) return target.connect(cb);
        if (cb) { cb(null, w, () => {}); return undefined; }
        return Promise.resolve(w);
      };
      if (prop === 'query') return (...args) => {
        const w = route();
        return w ? w.query(...args) : target.query(...args);
      };
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

export async function withContextFreeTx(plainPool, fn) {
  const client = await plainPool.connect();
  const store = { client, wrapped: wrap(client) };
  try {
    await client.query('BEGIN');
    const r = await als.run(store, () => fn(client));
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}
