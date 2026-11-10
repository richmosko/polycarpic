// Must COMPILE: control for db-index.ts. The session subpath exports at least one value, so an empty index is a real finding.
import type * as session from '@poly/db/session';

type Expect<T extends true> = T;
export type SessionSubpathExportsSomething = Expect<[keyof typeof session] extends [never] ? false : true>;
