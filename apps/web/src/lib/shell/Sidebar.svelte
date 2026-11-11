<script lang="ts">
  import { page } from '$app/state';
  import AvatarMenu from './AvatarMenu.svelte';
  import Icon from './Icon.svelte';
  import { NAV } from './nav';
  import type { ShellSession } from './session';

  // `rail:` variants (app.css) key on <html data-sidebar="collapsed">, set by hooks.server.ts from the
  // `sidebar:state` cookie, so the first paint is right with no script.
  let {
    session,
    collapsed,
    open,
    ontoggle,
  }: { session: ShellSession | null; collapsed: boolean; open: boolean; ontoggle: () => void } =
    $props();
</script>

<aside
  data-testid="sidebar"
  aria-label="Sidebar"
  class="bg-sidebar text-sidebar-foreground border-sidebar-border fixed top-4 bottom-4 left-4 z-20 w-60 flex-col rounded-xl border
    md:sticky md:z-auto md:m-4 md:mr-0 md:flex md:h-[calc(100svh-2rem)] md:shrink-0 rail:w-16
    {open ? 'flex' : 'hidden md:flex'}"
>
  <div class="flex p-2">
    <button
      type="button"
      onclick={ontoggle}
      aria-expanded={!collapsed}
      data-testid="sidebar-toggle"
      class="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring group relative flex w-full items-center gap-2 rounded-md p-2 text-left focus-visible:ring-2 focus-visible:outline-none"
    >
      <span
        data-testid="brand-mark"
        class="text-sidebar-brand shrink-0 rail:group-hover:hidden rail:group-focus-visible:hidden"
      >
        <Icon name="mark" class="size-6" stroke={1.5} />
      </span>
      <!-- Rail only, on hover or keyboard focus: the expand cue replaces the mark (DESIGN sidebar-flow). -->
      <span
        aria-hidden="true"
        data-testid="rail-expand-icon"
        class="bg-sidebar-accent hidden shrink-0 rounded-md rail:group-focus-visible:inline-flex rail:group-hover:inline-flex"
      >
        <Icon name="panelOpen" class="size-6" />
      </span>
      <span
        role="tooltip"
        data-testid="rail-expand-tooltip"
        class="bg-foreground text-background absolute top-1/2 left-full z-30 ml-3 hidden -translate-y-1/2 rounded-md px-2 py-1 text-xs whitespace-nowrap rail:group-focus-visible:block rail:group-hover:block"
        >Expand sidebar</span
      >
      <span class="sr-only">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
      <span aria-hidden="true" class="font-heading flex-1 truncate text-lg font-semibold rail:hidden">polycarpic</span>
      <Icon name="panelClose" class="size-5 shrink-0 rail:hidden" />
    </button>
  </div>
  <nav aria-label="Main" class="flex-1 overflow-y-auto p-2">
    <ul class="flex flex-col gap-1">
      {#each NAV as item (item.href)}
        {@const current = page.url.pathname === item.href}
        <li>
          <a
            href={item.href}
            aria-label={item.label}
            aria-current={current ? 'page' : undefined}
            class="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex items-center gap-3 rounded-md p-2 text-sm focus-visible:ring-2 focus-visible:outline-none
              {current ? 'bg-sidebar-accent font-semibold' : ''}"
          >
            <Icon name={item.icon} class="size-5 shrink-0" />
            <span class="truncate rail:hidden">{item.label}</span>
          </a>
        </li>
      {/each}
    </ul>
  </nav>
  <div class="border-sidebar-border border-t p-2">
    <AvatarMenu {session} />
  </div>
</aside>
