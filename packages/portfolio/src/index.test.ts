import { expect, test } from 'vitest';
import { name } from './index.ts';

test('portfolio stub loads', () => {
  expect(name).toBe('@poly/portfolio');
});
