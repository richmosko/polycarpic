// @virtual-path: packages/auth/src/x.ts
// @expect: poly/reserved-literal
declare const sql: (s: TemplateStringsArray, ...v: unknown[]) => unknown;
export const q = sql`SELECT app.enter_new_user(${1})`;
