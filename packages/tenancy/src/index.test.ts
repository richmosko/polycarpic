import { expect, test } from 'vitest';
import * as tenancy from './index.ts';

test('tenancy stub loads', () => {
  expect(tenancy.name).toBe('@poly/tenancy');
});

// POLY-62 ruling R1: the value list ARCH §3.1 names, exported next to the TaxClassification type. Mutation: drop or
// rename one value, and the DB check and this list disagree.
test('TAX_CLASSIFICATIONS lists the seven classifications of ARCH 3.1', () => {
  expect([...tenancy.TAX_CLASSIFICATIONS].sort()).toEqual([
    'business_c_corp', 'business_pass_through', 'individual', 'parent_joint_filers', 'parent_pass_through', 'trust_grantor', 'trust_non_grantor',
  ]);
});

// Mutation: delete the export, or make it take a user id (ruling: it acts for the transaction's current user).
test('provisionPerson is exported and takes only the transaction', () => {
  expect(typeof tenancy.provisionPerson).toBe('function');
  expect(tenancy.provisionPerson.length).toBe(1);
});
