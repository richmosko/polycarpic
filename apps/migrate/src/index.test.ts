import { expect, test } from 'vitest';
import { name } from './index.ts';

test('migrate stub loads', () => {
  expect(name).toBe('@poly/migrate');
});
