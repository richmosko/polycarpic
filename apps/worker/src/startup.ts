// Called first thing in the worker's main, before any job is scheduled: refuse to run when the schema is behind the image.
import { createLogger } from '@poly/config/log';
import { assertSchemaNotBehind } from '@poly/db/startup';

export async function startupGuard(): Promise<void> {
  try {
    await assertSchemaNotBehind('worker');
  } catch (e) {
    createLogger({ service: 'worker' }).fatal('schema.refused', { outcome: 'refused', err: e });
    process.exit(1);
  }
}
