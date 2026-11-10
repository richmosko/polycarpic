import { expect, test } from 'vitest';
import { name } from './index.ts';

test('db stub loads', () => {
  expect(name).toBe('@poly/db');
});
