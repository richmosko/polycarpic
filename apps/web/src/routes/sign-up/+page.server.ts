import type { PageServerLoad } from './$types';

// The invitation token sits in this page's query string (POLY-87 S9): no referrer leaves the page, and nothing caches it.
export const load: PageServerLoad = ({ setHeaders }) => {
  setHeaders({ 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' });
};
