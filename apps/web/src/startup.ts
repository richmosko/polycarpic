// Called from the SvelteKit `init` hook (hooks.server.ts, POLY-88): refuse to serve when the schema is behind the image.
import { assertSchemaNotBehind } from '@poly/db/startup';

export async function init(): Promise<void> {
  try {
    await assertSchemaNotBehind('app');
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
