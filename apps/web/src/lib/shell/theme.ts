export type Theme = 'light' | 'dark' | 'auto';

const MAX_AGE = 31536000;

export function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const cls = document.documentElement.classList;
  if (cls.contains('auto')) return 'auto';
  return cls.contains('dark') ? 'dark' : 'light';
}

/** Sets the <html> class and the poly-theme cookie, matching hooks.server.ts and static/theme.js. */
export function applyTheme(theme: Theme): void {
  const cls = document.documentElement.classList;
  cls.remove('dark', 'auto');
  if (theme === 'dark') cls.add('dark');
  if (theme === 'auto') {
    cls.add('auto');
    cls.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  document.cookie = `poly-theme=${theme}; Path=/; SameSite=Lax; Max-Age=${MAX_AGE}`;
}
