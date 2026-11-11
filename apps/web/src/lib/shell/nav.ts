import type { IconName } from './icons';

export const NAV: readonly { label: string; href: string; icon: IconName }[] = [
  { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
  { label: 'Transactions', href: '/transactions', icon: 'transactions' },
  { label: 'General Ledger', href: '/general-ledger', icon: 'ledger' },
  { label: 'Custodial Accounts', href: '/custodial-accounts', icon: 'custodial' },
  { label: 'Allocation', href: '/allocation', icon: 'allocation' },
  { label: 'Tax', href: '/tax', icon: 'tax' },
  { label: 'Reports', href: '/reports', icon: 'reports' },
  { label: 'Entities', href: '/entities', icon: 'entities' },
];
