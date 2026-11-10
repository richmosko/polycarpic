// Called from the SvelteKit `init` hook (hooks.server.ts, POLY-88) and from main.ts: refuse to serve when the schema
// is behind the image.
import { createLogger } from '@poly/config/log';
import { assertSchemaNotBehind } from '@poly/db/startup';

export async function init(): Promise<void> {
  try {
    await assertSchemaNotBehind('app');
  } catch (e) {
    createLogger({ service: 'web' }).fatal('schema.refused', { outcome: 'refused', err: e });
    process.exit(1);
  }
}
