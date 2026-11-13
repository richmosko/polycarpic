// @virtual-path: packages/auth/src/handler.ts
// @expect: eslint-comments/no-restricted-disable,poly/confined-member
declare const tx: { enterNewUser(id: string): Promise<void> };
// eslint-disable-next-line poly/confined-member
export const go = (id: string) => tx.enterNewUser(id);
