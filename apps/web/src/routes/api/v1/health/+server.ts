// Public health (POLY-161 R6): through Kit on purpose, so health is red when the app cannot answer. GET only.
import { handleHealth } from '../../../../ops/health.ts';

export const GET = (): Promise<Response> => handleHealth();
