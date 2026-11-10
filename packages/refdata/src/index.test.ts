import { expect, test } from 'vitest';
import { name } from './index.ts';

test('refdata stub loads', () => {
  expect(name).toBe('@poly/refdata');
});
