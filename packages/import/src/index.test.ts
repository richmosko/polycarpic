import { expect, test } from 'vitest';
import { name } from './index.ts';

test('import stub loads', () => {
  expect(name).toBe('@poly/import');
});
