// @virtual-path: packages/db/src/context.ts
// @expect: poly/reserved-literal
export const n = "select current_setting('app.user_id', true)";
