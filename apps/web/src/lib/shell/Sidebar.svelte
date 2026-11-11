<script lang="ts">
  import { page } from '$app/state';
  import AvatarMenu from './AvatarMenu.svelte';
  import { NAV } from './nav';
  import type { ShellSession } from './session';

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
  class="bg-sidebar text-sidebar-foreground border-sidebar-border fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r md:static md:z-auto
    {open ? 'flex' : 'hidden md:flex'} {collapsed ? 'md:w-16' : ''}"
>
  <div class="flex items-center justify-between gap-2 p-3">
    <span class="text-sidebar-brand font-heading px-2 text-lg font-semibold" class:md:hidden={collapsed}
      >polycarpic</span
    >
    <button
      type="button"
      onclick={ontoggle}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-expanded={!collapsed}
      data-testid="sidebar-toggle"
      class="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring rounded-md p-2 focus-visible:ring-2 focus-visible:outline-none"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5 fill-none stroke-current stroke-2">
        <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" />
      </svg>
    </button>
  </div>
  <nav aria-label="Main" class="flex-1 p-2 {collapsed ? 'md:hidden' : ''}">
    <ul class="flex flex-col gap-1">
      {#each NAV as item (item.href)}
        {@const current = page.url.pathname === item.href}
        <li>
          <a
            href={item.href}
            aria-current={current ? 'page' : undefined}
            class="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring block rounded-md px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none
              {current ? 'bg-sidebar-accent font-semibold' : ''}"
          >
            {item.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
  <div class="border-sidebar-border mt-auto border-t p-2">
    <AvatarMenu {session} />
  </div>
</aside>
