// POLY-150 R1.2 (S22), POLY-161 R13: `next` is honoured only as a path on this origin. One module, shared by the gate and the
// sign-in pages (browser and server). An honoured value is returned unchanged; anything else is '/'.
const BASE = 'https://self.invalid';

/** Any code point U+0000 to U+001F or U+007F: the URL parser strips tabs and newlines, which is how `/\t/evil.example` becomes `//evil.example`. */
const hasControl = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
};

export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || hasControl(value)) return '/';
  try {
    const u = new URL(value, BASE);
    if (u.origin !== BASE || u.pathname.startsWith('//')) return '/';
  } catch {
    return '/';
  }
  return value;
}
