// Called first thing in the worker's main, before any job is scheduled: refuse to run when the schema is behind the image.
import { assertSchemaNotBehind } from '@poly/db/startup';

export async function startupGuard(): Promise<void> {
  try {
    await assertSchemaNotBehind('worker');
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
