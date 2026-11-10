import { expect, test } from 'vitest';
import { name } from './index.ts';

test('posting stub loads', () => {
  expect(name).toBe('@poly/posting');
});
