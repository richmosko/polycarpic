import { mySecondStep } from '@poly/auth/web';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// POLY-150 R1.1: Entities needs one fact, whether the user has a second step yet (the message with its button). It names no entity.
export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.handle) error(401);
  const { secondStep } = await mySecondStep(locals.handle);
  return { secondStepOff: secondStep.secondStepAt === null, resume: secondStep.step };
};
