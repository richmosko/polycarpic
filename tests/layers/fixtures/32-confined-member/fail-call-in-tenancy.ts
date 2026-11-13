// @virtual-path: packages/tenancy/src/index.ts
// @expect: poly/confined-member
declare const tx: { enterNewUser(id: string): Promise<void> };
export const go = (id: string) => tx.enterNewUser(id);
