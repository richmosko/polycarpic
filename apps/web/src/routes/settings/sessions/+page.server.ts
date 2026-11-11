import { listMySessions, revokeMySession } from '@poly/auth';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// Placeholder page (POLY-86): the design is a follow-up for ux-designer. The list never carries a token.
export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.identity) error(401);
  return {
    sessions: (await listMySessions(locals.identity)).map((s) => ({
      id: s.id,
      device: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastSeen: s.updatedAt.toISOString(),
      current: s.current,
    })),
  };
};

export const actions: Actions = {
  revoke: async ({ locals, request }) => {
    if (!locals.identity) error(401);
    const id = String((await request.formData()).get('id') ?? '');
    try {
      await revokeMySession(locals.identity, id);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 403 || status === 404) return fail(status, { error: (e as Error).message });
      throw e;
    }
    return { revoked: true };
  },
};
