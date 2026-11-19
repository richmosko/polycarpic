// Must COMPILE: no export of the @poly/db index (value or type) is a session-user-id constructor or brand. (POLY-153 R7.1: withSession and
// NoLiveSession are exported there on purpose; only the brand names are refused.)
import type * as db from '@poly/db';

type Expect<T extends true> = T;
type Keys = keyof typeof db;
export type NoSessionConstructor = Expect<Extract<Keys, `${'session' | 'Session'}UserId`> extends never ? true : false>;
