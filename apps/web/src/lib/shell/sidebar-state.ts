const MAX_AGE = 31536000;

export function readSidebar(): boolean {
  return document.documentElement.dataset.sidebar === 'collapsed';
}

/** Mirrors hooks.server.ts: <html data-sidebar> for the styles, the `sidebar:state` cookie (open state) for reloads. */
export function writeSidebar(collapsed: boolean): void {
  document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
  document.cookie = `sidebar:state=${!collapsed}; Path=/; SameSite=Lax; Max-Age=${MAX_AGE}`;
}
