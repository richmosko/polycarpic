// POLY-150 R3.3 [S4]: the QR code is drawn in the browser from the otpauth URI by qrcode-generator (exactly pinned, no dependencies, no network calls).
// The result is one SVG path string; the page renders it as markup, never as HTML.
import qrcode from 'qrcode-generator';

/** A viewBox size and a path made of one square per dark module. */
export function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return { size: n, d };
}

/** The base32 key in an otpauth URI, in groups of four for typing by hand. */
export function keyFromUri(uri: string): string {
  try {
    return (new URL(uri).searchParams.get('secret') ?? '').replace(/(.{4})/g, '$1 ').trim();
  } catch {
    return '';
  }
}
