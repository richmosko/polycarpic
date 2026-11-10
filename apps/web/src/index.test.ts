import { expect, test } from 'vitest';
import { name } from './index.ts';

test('web stub loads', () => {
  expect(name).toBe('@poly/web');
});
