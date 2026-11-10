import { expect, test } from 'vitest';
import { name } from './index.ts';

test('auth stub loads', () => {
  expect(name).toBe('@poly/auth');
});
