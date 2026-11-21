// @poly/mail (POLY-137 R1): the Mailer seam, the Resend adapter, and the per-recipient cap. No runtime dependency: Resend is one HTTPS POST.
export interface Mail { to: string; subject: string; text: string; idempotencyKey?: string }
/** Resolves once the provider accepts the mail; throws MailError otherwise. */
export interface Mailer { send(m: Mail): Promise<void> }

/** `status` is the HTTP status, or null for a timeout or network fault. Never the response body, the key or an address. */
export class MailError extends Error {
  readonly status: number | null;
  constructor(status: number | null) {
    super(status === null ? 'mail failed: no answer from the provider' : `mail failed: provider answered ${status}`);
    this.name = 'MailError';
    this.status = status;
  }
}

export function resendMailer(o: { apiKey: string; from: string; fetch?: typeof fetch; timeoutMs?: number }): Mailer {
  const doFetch = o.fetch ?? fetch;
  const timeoutMs = o.timeoutMs ?? 5000;
  return {
    async send(m) {
      const headers: Record<string, string> = { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json' };
      if (m.idempotencyKey) headers['idempotency-key'] = m.idempotencyKey;
      let res: Response;
      try {
        res = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers,
          body: JSON.stringify({ from: o.from, to: [m.to], subject: m.subject, text: m.text }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new MailError(null);
      }
      if (res.status < 200 || res.status >= 300) throw new MailError(res.status);
    },
  };
}

/** R1.8: 10 token mails per rolling 60 minutes per address, in memory. A refused take records nothing. */
export class RecipientCap {
  static readonly MAX = 10;
  static readonly WINDOW_MS = 60 * 60_000;
  private readonly log = new Map<string, number[]>();
  take(address: string, now: number = Date.now()): boolean {
    const key = address.trim().toLowerCase();
    const fresh = (this.log.get(key) ?? []).filter((t) => t > now - RecipientCap.WINDOW_MS);
    const ok = fresh.length < RecipientCap.MAX;
    if (ok) fresh.push(now);
    if (fresh.length === 0) this.log.delete(key);
    else this.log.set(key, fresh);
    return ok;
  }
}

export * from './templates.ts';
