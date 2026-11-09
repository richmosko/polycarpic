// Static fake data shaped like ARCH §2.4 DTO names. The shell reads these;
// screen bodies are DESIGN's verbatim markup (see README, "What is faked").
export type EntityListItem = { id: string; name: string; kind: 'Person' | 'Trust' | 'Business' | 'Household'; role: 'owner' | 'manager' | 'viewer' };

export const EntityList: EntityListItem[] = [
  { id: 'e1', name: 'Mosko', kind: 'Person', role: 'owner' },
  { id: 'e2', name: 'Mosko Family Trust', kind: 'Trust', role: 'owner' },
  { id: 'e3', name: 'Mosko Holdings LLC', kind: 'Business', role: 'manager' },
  { id: 'e4', name: 'Household', kind: 'Household', role: 'owner' }
];

// Which sidebar item lights up for each route (account-register is a General Ledger sub-page).
export const activeNav: Record<string, string> = {
  'account-register': 'general-ledger'
};

export const shellRoutes = [
  'dashboard', 'transactions', 'general-ledger', 'account-register', 'custodial-accounts',
  'allocation', 'tax', 'reports', 'entities', 'settings'
];
