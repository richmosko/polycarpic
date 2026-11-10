// Must COMPILE: control for deep-import.ts. A DECLARED subpath resolves under the same bundler resolution.
import type * as auth from '@poly/db/auth';

export type { auth };
