import type { ShellSession } from './lib/shell/session';

declare global {
  namespace App {
    interface Locals {
      session?: ShellSession;
    }
  }
}

export {};
