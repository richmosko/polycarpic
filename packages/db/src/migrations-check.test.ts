import { expect, test } from 'vitest';
import { checkSql } from './migrations-check.ts';

// Built from pieces so the repo's own session-SET lint does not read these fixtures as statements.
const S = 'SE' + 'T ';
const checks = (sql: string) => checkSql('f.sql', sql).map((p) => p.check);

test('accepts a definer file that ends on poly_owner', () => {
  expect(checks(`${S}ROLE poly_authz;\nCREATE TABLE t();\n${S}ROLE poly_owner;`)).toEqual([]);
});

test('single-quoted and SESSION targets are read, not skipped', () => {
  expect(checks(`${S}ROLE 'poly_purge';`)).toContain('last-role-not-owner');
  expect(checks(`${S}SESSION ROLE 'evil';`)).toContain('role-target');
  expect(checks(`${S}ROLE "evil";`)).toContain('role-target');
});

test('a target that does not parse is a problem', () => {
  expect(checks(`${S}ROLE (select 1);`)).toContain('role-target');
  expect(checks(`${S}ROLE NONE;`)).toContain('role-target');
});

test("'--' inside a string does not hide a later role switch", () => {
  expect(checks(`SELECT '--'; ${S}ROLE poly_authz;`)).toContain('last-role-not-owner');
});

test('comments are ignored, dollar-quoted bodies are not', () => {
  expect(checks(`-- ${S}ROLE evil\n/* RESET ROLE */ SELECT 1;`)).toEqual([]);
  expect(checks('DO $$ BEGIN RESET ROLE; END $$;')).toContain('reset');
});
