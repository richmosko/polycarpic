<script>
  import '../../../docs/DESIGN/tokens.css';
  import '../../../docs/DESIGN/screen.css';
  import './prototype.css';
  import { page } from '$app/state';
  import { sidebar } from '../lib/screens/sidebar';
  import { activeNav } from '../lib/fixtures/shell';
  import { screens } from '../lib/screens';
  import { onMount } from 'svelte';

  let { children } = $props();
  const name = $derived(page.url.pathname.replace(/^\/|\/$/g, ''));
  const screen = $derived(screens[name]);
  const shell = $derived(screen?.shell ?? false);
  const activeHref = $derived('/' + (activeNav[name] ?? name));
  let dark = $state(false);
  let sidebarEl = $state();

  onMount(() => { dark = document.documentElement.classList.contains('dark'); });

  function toggleTheme() {
    dark = !dark;
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) {}
  }

  // Active nav item: the generated sidebar carries none; set it per route.
  $effect(() => {
    if (!shell || !sidebarEl) return;
    for (const a of sidebarEl.querySelectorAll('.nav-item')) {
      const on = a.getAttribute('href') === activeHref;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
  });

  // Body class (brand bar on shell-less pages).
  $effect(() => {
    const cls = (screen?.bodyClass ?? '').split(' ').filter(Boolean);
    document.body.classList.add(...cls);
    return () => document.body.classList.remove(...cls);
  });

  const aside = () => sidebarEl?.querySelector('.sidebar');

  function onShellClick(e) {
    const t = e.target;
    if (t.closest('.sidebar-avatar-trigger')) { aside().classList.toggle('menu-open'); return; }
    const item = t.closest('.avatar-popover .popover-item');
    if (item && /Theme/.test(item.textContent)) { toggleTheme(); return; }
    if (item) { aside().classList.remove('menu-open'); return; }
    const more = t.closest('.more-menu-wrap > .icon-btn');
    if (more) { more.parentElement.classList.toggle('open'); return; }
    if (!t.closest('.more-menu')) document.querySelectorAll('.more-menu-wrap.open').forEach((w) => w.classList.remove('open'));
    if (!t.closest('.sidebar-bottom')) aside()?.classList.remove('menu-open');
  }
</script>

<svelte:window onclick={onShellClick} />

{#if shell}
  <div class="shell">
    <div bind:this={sidebarEl} style="display: contents">{@html sidebar}</div>
    <div class="shell-main">{@render children()}</div>
  </div>
{:else}
  {@render children()}
{/if}

<button class="proto-theme" type="button" onclick={toggleTheme} aria-label="Toggle light and dark">
  {dark ? 'Light' : 'Dark'}
</button>
