import { expect, test } from 'vitest';
import { name } from './index.ts';

test('secrets stub loads', () => {
  expect(name).toBe('@poly/secrets');
});
