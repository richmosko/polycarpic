// The routing pool (ARCH §3.1c, SECURITY A-31; POLY-86 ruling R2, seceng S3-S5). BetterAuth is handed this pg-Pool-shaped
// object. Inside a transaction of ours (withTenant or withContextFreeTx) its statements run on that request's client, with
// BEGIN / COMMIT / ROLLBACK turned into savepoints; outside one, they go to the plain poly_app pool, which holds no GUC.
import { authPool, currentClient, type AuthClient } from '@poly/db/auth';

export class RoutingPoolContention extends Error {
  constructor() {
    super('RoutingPoolContention: waited over 5 s for the request client');
    this.name = 'RoutingPoolContention';
  }
}
export class AuthUnderSystemJob extends Error {
  constructor() {
    super('AuthUnderSystemJob: BetterAuth never runs as a job principal');
    this.name = 'AuthUnderSystemJob';
  }
}
export class UnsupportedTransactionControl extends Error {
  constructor(sql: string) {
    super(`routing pool: transaction control is a closed grammar, refused: ${sql.slice(0, 40)}`);
    this.name = 'UnsupportedTransactionControl';
  }
}

const WAIT_MS = 5000;
const PASS = /^(SAVEPOINT|RELEASE|ROLLBACK\s+TO)\b/i;
const CONTROL = /^(BEGIN|START|COMMIT|END|ROLLBACK|ABORT|PREPARE\s+TRANSACTION|SET\s+TRANSACTION|SET\s+SESSION\s+CHARACTERISTICS)\b/i;

interface Waiter {
  grant: () => void;
  cancelled: boolean;
}
/** Per request: the savepoint depth and the one-lease-at-a-time queue. */
class RequestState {
  depth = 0;
  held = false;
  waiters: Waiter[] = [];

  acquire(): Promise<void> {
    if (!this.held) {
      this.held = true;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const w: Waiter = { cancelled: false, grant: () => { clearTimeout(timer); resolve(); } };
      const timer = setTimeout(() => {
        w.cancelled = true;
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new RoutingPoolContention());
      }, WAIT_MS);
      this.waiters.push(w);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next.grant();
    else this.held = false;
  }

  /** One statement in, the statements to send out. Throws on anything outside the closed grammar. */
  rewrite(sql: string): string[] {
    const bare = sql.trim().replace(/;\s*$/, '').trim();
    const word = bare.replace(/\s+/g, ' ').toUpperCase();
    if (PASS.test(bare)) return [sql];
    if (!CONTROL.test(bare)) return [sql];
    if (word === 'BEGIN' || word === 'START TRANSACTION') return [`SAVEPOINT ba_${++this.depth}`];
    if (word === 'COMMIT' || word === 'END') {
      if (this.depth === 0) throw new UnsupportedTransactionControl(sql);
      return [`RELEASE SAVEPOINT ba_${this.depth--}`];
    }
    if (word === 'ROLLBACK') {
      if (this.depth === 0) throw new UnsupportedTransactionControl(sql);
      const n = this.depth--;
      return [`ROLLBACK TO SAVEPOINT ba_${n}`, `RELEASE SAVEPOINT ba_${n}`];
    }
    throw new UnsupportedTransactionControl(sql);
  }
}

const states = new WeakMap<AuthClient, RequestState>();
const stateOf = (c: AuthClient): RequestState => {
  let s = states.get(c);
  if (!s) states.set(c, (s = new RequestState()));
  return s;
};

const textOf = (q: unknown): string => (typeof q === 'string' ? q : String((q as { text?: string })?.text ?? ''));

class Lease {
  #open = true;
  readonly client: AuthClient;
  readonly state: RequestState;
  constructor(client: AuthClient, state: RequestState) {
    this.client = client;
    this.state = state;
  }

  async query(q: unknown, values?: unknown): Promise<unknown> {
    if (!this.#open) throw new Error('TransactionClosed: the lease was released');
    const run = this.client.query as (...a: unknown[]) => Promise<unknown>;
    const out = this.state.rewrite(textOf(q));
    if (typeof q !== 'string' || out[0] === q) return run(q, values);
    let last: unknown;
    for (const stmt of out) last = await run(stmt);
    return last;
  }

  release(): void {
    if (!this.#open) return;
    this.#open = false;
    this.state.release();
  }

  on(): this {
    return this;
  }
}

export interface RoutingPool {
  connect(): Promise<unknown>;
  query(q: unknown, values?: unknown): Promise<unknown>;
  end(): Promise<void>;
  on(): RoutingPool;
}

export function createRoutingPool(): RoutingPool {
  const pool: RoutingPool = {
    async connect() {
      const cur = currentClient();
      if (!cur) return authPool().connect();
      if (cur.kind === 'withSystem') throw new AuthUnderSystemJob();
      const state = stateOf(cur.client);
      await state.acquire();
      return new Lease(cur.client, state);
    },
    async query(q, values) {
      const cur = currentClient();
      if (!cur) return (authPool().query as (...a: unknown[]) => Promise<unknown>)(q, values);
      const lease = (await pool.connect()) as Lease;
      try {
        return await lease.query(q, values);
      } finally {
        lease.release();
      }
    },
    async end() {},
    on() {
      return pool;
    },
  };
  return pool;
}
