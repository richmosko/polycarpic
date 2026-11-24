# G15 ruled mutants, each run (qa-162, verdict C1)

`apps/web/src/ops/public-health.test.ts` at the commit that carries this file; the product file `public-health.ts` edited locally for each run and restored (`git status` clean for it). Baseline: 16/16.

C1's fix: the "reaches a log" case spied `process.stdout.write` only; vitest's `console.*` does not pass through it. The case now also spies `console.log/info/warn/error/debug`, and has a control: a planted line through each of console, stdout and stderr must be seen by the capture, or the case fails.

| Ruled mutant | Edit | Result | Red test |
|---|---|---|---|
| `startsWith` | `req.url?.startsWith(HEALTH_PATH)` | red (`5ba0105c`) | every other request is the fixed 404 |
| decoding the path | `decodeURIComponent(req.url ?? '') === HEALTH_PATH` | red | every other request is the fixed 404 |
| answering `HEAD` | method test accepts `HEAD` | red | every other request is the fixed 404 |
| echoing a header | `'x-echo': req.headers.host` in `writeHead` | red | 4 cases (health 200, 503, 404 set, nothing echoed) |
| logging the URL | `console.log(req.url)` at the top of `answer()` | **red** (was green: C1) | nothing the client sent reaches a log |
| `maxHeaderSize` dropped | option removed | red | 9 KiB of headers is refused |
| `requestTimeout` dropped | `server.requestTimeout = 0` | red | the limits are the ruled ones |
| `headersTimeout` dropped | `server.headersTimeout = 0` | red (`5ba0105c`) | the limits are the ruled ones |
| `keepAliveTimeout` dropped | option removed | red | the limits are the ruled ones |
| `connectionsCheckingInterval` dropped | option removed | red | the limits are the ruled ones |
| `maxRequestsPerSocket` dropped | line removed | red | the limits are the ruled ones |
| `maxConnections` 128 | `server.maxConnections = 128` | red (`5ba0105c`) | the 65th connection; the limits |
| exported handler argument | `export const handler = answer` | red (14 cases: the first export is no longer the start function) | the module exports exactly one function |
| destroying before the flush | `res.end(body); req.socket.destroy()` | **survives** (`5ba0105c`); accepted by the architect: a small loopback body flushes before the destroy, seceng measured both forms alike | none |

Reading: `requestTimeout`, `keepAliveTimeout`, `connectionsCheckingInterval` and `maxRequestsPerSocket` are held by the case that reads the server's own properties, not by behaviour (a 5 s timeout and a 1 s keep-alive are not driven end to end except `connectionsCheckingInterval` removed, which also failed the slow-request case on its timing).
