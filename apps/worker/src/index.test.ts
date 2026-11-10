import { expect, test } from 'vitest';
import { name } from './index.ts';

test('worker stub loads', () => {
  expect(name).toBe('@poly/worker');
});
