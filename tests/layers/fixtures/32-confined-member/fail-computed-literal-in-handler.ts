// @virtual-path: packages/auth/src/handler.ts
// @expect: poly/confined-member
declare const tx: Record<string, (id: string) => Promise<void>>;
export const go = (id: string) => tx['enterNewUser'](id);
