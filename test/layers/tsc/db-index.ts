// Must COMPILE: no export of the @poly/db index (value or type) is a session-user-id constructor or brand.
import type * as db from '@poly/db';

type Expect<T extends true> = T;
type Keys = keyof typeof db;
export type NoSessionConstructor = Expect<Extract<Keys, `${string}ession${string}`> extends never ? true : false>;
