// POLY-150 R1.2 (S22): `next` is honoured only as a path on this origin. One module, shared by the gate and both sign-in pages (browser and server).
/** A path on this origin ('/x'), never '//x', '/\x', an absolute URL or a scheme; anything else gives '/'. */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string') return '/';
  return value.startsWith('/') && value[1] !== '/' && value[1] !== '\\' ? value : '/';
}
