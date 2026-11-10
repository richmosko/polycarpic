import { expect, test } from 'vitest';
import { name } from './index.ts';

test('config stub loads', () => {
  expect(name).toBe('@poly/config');
});
