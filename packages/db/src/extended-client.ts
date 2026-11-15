// POLY-147 guard (i), ruling R4. pg@8.23.1 has no pool- or client-level query mode: `queryMode` is read per query (lib/query.js).
// This client sets it on every query, so a string holding two commands is a prepared statement and Postgres refuses it (42601).
// pool.ts passes this class as `Client` to every pool, so no client is ever built without it.
import pg from 'pg';

export class ExtendedModeRequired extends Error {
  constructor() {
    super('ExtendedModeRequired: a query must be sent in extended mode');
    this.name = 'ExtendedModeRequired';
  }
}

export class ExtendedClient extends pg.Client {
  // Overrides pg.Client's overloaded query(); the signature is widened on purpose and the call forwarded unchanged.
  query(config: any, values?: any, callback?: any): any {
    // A Submittable (pg-cursor, pg-query-stream) bypasses the Query config entirely.
    if (config !== null && typeof config === 'object' && typeof config.submit === 'function') throw new ExtendedModeRequired();
    const next = typeof config === 'string' ? { text: config } : { ...config };
    next.queryMode = 'extended';
    return super.query(next, values, callback);
  }
}
