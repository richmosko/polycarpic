<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import { readSidebar, writeSidebar } from '../lib/shell/sidebar-state';
  import Sidebar from '../lib/shell/Sidebar.svelte';
  import TopBar from '../lib/shell/TopBar.svelte';

  let { children, data } = $props();

  // The look follows <html data-sidebar> (set by the server from the cookie); this state only drives labels.
  let collapsed = $state(false);
  let open = $state(false);

  onMount(() => {
    collapsed = readSidebar();
  });

  function toggleCollapsed() {
    collapsed = !collapsed;
    writeSidebar(collapsed);
  }
</script>

<div class="bg-background text-foreground flex min-h-screen">
  <Sidebar session={data.session} {collapsed} {open} ontoggle={toggleCollapsed} />
  <main id="main" class="flex min-w-0 flex-1 flex-col">
    <TopBar ontoggle={() => (open = !open)} />
    <div class="flex-1 p-6">
      {@render children()}
    </div>
  </main>
</div>
