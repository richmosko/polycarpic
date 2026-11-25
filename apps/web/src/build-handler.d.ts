// What typecheck sees of the built app's handler (POLY-161 verdict D1); main.ts imports it as '#web-build', which Node resolves to
// build/handler.js by package.json `imports`. Typecheck needs no build, and does not read the build's files.
import type { WebHandler } from './ops/server.ts';

export const handler: WebHandler;
