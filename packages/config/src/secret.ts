// A secret value that cannot be rendered by accident (POLY-85 R3, S-4). The value lives in a #private field, so it is
// not an own property: Object.keys, spread, JSON.stringify, structuredClone and util.inspect (showHidden included) never see it.
import { inspect } from 'node:util';

export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** The one way to read the value. Call it at the point of use and do not keep the result in a long-lived object. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return '[secret]';
  }

  toJSON(): string {
    return '[secret]';
  }

  [inspect.custom](): string {
    return '[secret]';
  }
}
