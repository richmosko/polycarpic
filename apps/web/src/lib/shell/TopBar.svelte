<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import EntitySelector from './EntitySelector.svelte';
  import { NAV } from './nav';

  let {
    ontoggle,
    more,
  }: { ontoggle: () => void; more?: Snippet } = $props();

  const title = $derived(NAV.find((n) => n.href === page.url.pathname)?.label ?? 'polycarpic');
</script>

<header
  class="bg-background text-foreground border-border flex h-14 items-center gap-3 border-b px-4"
>
  <button
    type="button"
    onclick={ontoggle}
    aria-label="Toggle sidebar"
    class="focus-visible:ring-ring rounded-md p-2 focus-visible:ring-2 focus-visible:outline-none md:hidden"
  >
    <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5 fill-none stroke-current stroke-2">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  </button>
  <nav aria-label="Breadcrumb" class="min-w-0 flex-1">
    <ol class="flex items-center gap-2 text-sm">
      <li class="text-muted-foreground"><a href="/dashboard" class="hover:underline">Home</a></li>
      <li aria-hidden="true" class="text-muted-foreground">/</li>
      <li><h1 aria-current="page" class="font-heading truncate text-base font-semibold">{title}</h1></li>
    </ol>
  </nav>
  <EntitySelector entities={[]} current={null} />
  {#if more}{@render more()}{/if}
</header>
