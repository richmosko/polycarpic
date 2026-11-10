import { expect, test } from 'vitest';
import { name } from './index.ts';

test('tax stub loads', () => {
  expect(name).toBe('@poly/tax');
});
