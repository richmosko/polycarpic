import { listMySessions, revokeMySession } from '@poly/auth/web';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// Placeholder page (POLY-86): the design is a follow-up for ux-designer. The list never carries a token.
export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.handle) error(401);
  return {
    sessions: (await listMySessions(locals.handle)).map((s) => ({
      id: s.id,
      device: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastSeen: s.updatedAt.toISOString(),
      current: s.current,
    })),
  };
};

export const actions: Actions = {
  revoke: async ({ locals, request, cookies }) => {
    if (!locals.handle) error(401);
    const id = String((await request.formData()).get('id') ?? '');
    let current = false;
    try {
      ({ current } = await revokeMySession(locals.handle, id));
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 403 || status === 404) return fail(status, { error: (e as Error).message });
      throw e;
    }
    if (current) {
      // The current session is signed out: its handle went with it, so the cookie goes too.
      cookies.delete('__Host-poly_handle', { path: '/', secure: true, httpOnly: true, sameSite: 'lax' });
      redirect(303, '/sign-in');
    }
    return { revoked: true };
  },
};
