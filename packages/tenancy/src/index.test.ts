import { expect, test } from 'vitest';
import { name } from './index.ts';

test('tenancy stub loads', () => {
  expect(name).toBe('@poly/tenancy');
});
