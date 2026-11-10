import { expect, test } from 'vitest';
import { name } from './index.ts';

test('ui stub loads', () => {
  expect(name).toBe('@poly/ui');
});
