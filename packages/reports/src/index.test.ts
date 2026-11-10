import { expect, test } from 'vitest';
import { name } from './index.ts';

test('reports stub loads', () => {
  expect(name).toBe('@poly/reports');
});
