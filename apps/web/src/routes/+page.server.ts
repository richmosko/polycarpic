import { myLandingEntity } from '@poly/auth/web';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// "/" sends a signed-in user to their landing entity (POLY-87 R3). `entity` is the seam for the entity selector.
export const load: PageServerLoad = async ({ locals }) => {
  const entity = locals.handle ? await myLandingEntity(locals.handle) : null;
  redirect(307, entity ? `/dashboard?entity=${entity}` : '/dashboard');
};
