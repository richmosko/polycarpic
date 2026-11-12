// @virtual-path: packages/auth/src/user-hooks.ts
declare const tx: { enterNewUser(id: string): Promise<void> };
export const go = (id: string) => tx.enterNewUser(id);
