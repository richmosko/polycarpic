import { mySecondStep } from '@poly/auth/web';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// POLY-150 R1.1: the one read of this page, through app.my_second_step() and app.recent_auth_ok(); it names no entity (R1.3). There are no form actions:
// every write is the dialog's own browser fetch to the sign-in service.
export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.handle) error(401);
  const { secondStep, recentAuthOk } = await mySecondStep(locals.handle);
  return { secondStep, recentAuthOk, held: locals.secondStepRequired === true };
};
