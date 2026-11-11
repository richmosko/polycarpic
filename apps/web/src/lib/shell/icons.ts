// Lucide-style 24x24 outline shapes, as data so Icon.svelte can render them without {@html} (SECURITY C-41).
export type Shape = { t: 'path' | 'rect' | 'circle' | 'line' | 'polygon'; a: Record<string, string> };

const p = (d: string): Shape => ({ t: 'path', a: { d } });
const rect = (x: string, y: string, width: string, height: string, rx = '1'): Shape => ({ t: 'rect', a: { x, y, width, height, rx } });
const line = (x1: string, y1: string, x2: string, y2: string): Shape => ({ t: 'line', a: { x1, y1, x2, y2 } });

export const ICONS = {
  dashboard: [rect('3', '3', '7', '9'), rect('14', '3', '7', '5'), rect('14', '12', '7', '9'), rect('3', '16', '7', '5')],
  transactions: [p('m16 3 4 4-4 4'), p('M20 7H4'), p('m8 21-4-4 4-4'), p('M4 17h16')],
  ledger: [p('M4 19.5A2.5 2.5 0 0 1 6.5 17H20'), p('M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'), p('M8 7h6'), p('M8 11h8')],
  custodial: [line('3', '22', '21', '22'), line('6', '18', '6', '11'), line('10', '18', '10', '11'), line('14', '18', '14', '11'), line('18', '18', '18', '11'), { t: 'polygon', a: { points: '12 2 20 7 4 7' } }],
  allocation: [p('M21.21 15.89A10 10 0 1 1 8 2.83'), p('M22 12A10 10 0 0 0 12 2v10z')],
  tax: [p('M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z'), p('M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8'), p('M12 17.5v-11')],
  reports: [p('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'), p('M14 2v4a2 2 0 0 0 2 2h4'), p('M10 9H8'), p('M16 13H8'), p('M16 17H8')],
  entities: [p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), { t: 'circle', a: { cx: '9', cy: '7', r: '4' } }, p('M22 21v-2a4 4 0 0 0-3-3.87'), p('M16 3.13a4 4 0 0 1 0 7.75')],
  panelClose: [rect('3', '3', '18', '18', '2'), p('M9 3v18'), p('m16 15-3-3 3-3')],
  panelOpen: [rect('3', '3', '18', '18', '2'), p('M9 3v18'), p('m14 9 3 3-3 3')],
  check: [p('M20 6 9 17l-5-5')],
  mark: [
    p('M12.61 12.23 C11.88 9.39 12.74 6.15 15.45 4.12 C17.07 2.91 18.69 2.23 20.04 1.55 C19.55 5.12 18.20 9.53 13.42 12.23'),
    p('M10.50 13.66 C10.74 11.07 8.47 8.36 3.88 6.96 C5.12 10.26 7.07 13.18 10.50 13.66 Z'),
    p('M10.50 13.66 C11.39 14.74 11.66 15.88 11.58 17.09 L11.61 21.23'),
    p('M12.61 12.23 C12.07 13.99 11.61 15.61 11.58 17.09'),
    p('M8.74 22.36 C10.04 21.28 13.28 21.01 14.77 22.42'),
  ],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;
