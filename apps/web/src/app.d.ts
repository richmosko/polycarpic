import type { ShellSession } from './lib/shell/session';

declare global {
  namespace App {
    interface Locals {
      session?: ShellSession;
      /** Server-only: the __Host-poly_handle cookie's value, the only thing web enters a transaction with. Never serialised to a page. */
      handle?: string;
      /** True while the database says this user must set up a second step (the gate); the page then loads no entity data. */
      secondStepRequired?: boolean;
    }
  }
}

export {};
