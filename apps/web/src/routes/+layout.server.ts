import type { LayoutServerLoad } from './$types';

/** The projection carries no token (ARCH §3.1c): only these fields ever reach the page. */
export const load: LayoutServerLoad = ({ locals }) => {
  const s = locals.session;
  return {
    session: s
      ? {
          user: { id: s.user.id, name: s.user.name, image: s.user.image },
          expiresAt: s.expiresAt,
        }
      : null,
  };
};
