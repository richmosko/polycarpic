import { expect, test } from 'vitest';
import { name } from './index.ts';

test('ledger stub loads', () => {
  expect(name).toBe('@poly/ledger');
});
