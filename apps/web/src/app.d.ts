import type { ShellSession } from './lib/shell/session';

declare global {
  namespace App {
    interface Locals {
      session?: ShellSession;
      /** Server-only: who the request is and which session carries it. Never serialised to a page. */
      identity?: { userId: string; sessionId: string };
    }
  }
}

export {};
