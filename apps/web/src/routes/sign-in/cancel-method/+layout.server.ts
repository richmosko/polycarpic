import type { LayoutServerLoad } from './$types';

// POLY-137 R2.5/R3.7: the page's URL may carry a token fragment, so it never leaks in a Referer and is never stored.
export const load: LayoutServerLoad = ({ setHeaders }) => {
  setHeaders({ 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' });
  return {};
};
