<script lang="ts">
  import '../app.css';
  import Sidebar from '../lib/shell/Sidebar.svelte';
  import TopBar from '../lib/shell/TopBar.svelte';

  let { children, data } = $props();

  let collapsed = $state(false);
  let open = $state(false);

  // One control per breakpoint: desktop collapses the rail, mobile opens the off-canvas sidebar.
  function toggle() {
    if (window.matchMedia('(min-width: 768px)').matches) collapsed = !collapsed;
    else open = !open;
  }
</script>

<div class="bg-background text-foreground flex min-h-screen">
  <Sidebar session={data.session} {collapsed} {open} ontoggle={toggle} />
  <main id="main" class="flex min-w-0 flex-1 flex-col">
    <TopBar ontoggle={toggle} />
    <div class="flex-1 p-6">
      {@render children()}
    </div>
  </main>
</div>
