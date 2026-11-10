import { expect, test } from 'vitest';
import { name } from './index.ts';

test('securities stub loads', () => {
  expect(name).toBe('@poly/securities');
});
