// @virtual-path: packages/auth/src/handler.ts
// @expect: eslint-comments/no-unlimited-disable,poly/confined-member
/* eslint-disable */
declare const tx: { enterNewUser(id: string): Promise<void> };
export const go = (id: string) => tx.enterNewUser(id);
