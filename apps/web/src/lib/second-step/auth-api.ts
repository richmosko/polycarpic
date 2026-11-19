// POLY-150 R0/R3.0: every write of the second-step screens is a browser fetch to the sign-in service on this origin. Nothing here runs on the server.
export type ApiResult<T = Record<string, unknown>> = { ok: boolean; status: number; body: T & { code?: string; message?: string } };

/** One call to /api/auth/*. Never throws: a network failure is { ok: false, status: 0 }. */
export async function api<T = Record<string, unknown>>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/auth${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => ({}))) as ApiResult<T>['body'];
    return { ok: res.ok, status: res.status, body: parsed };
  } catch {
    return { ok: false, status: 0, body: {} as ApiResult<T>['body'] };
  }
}
