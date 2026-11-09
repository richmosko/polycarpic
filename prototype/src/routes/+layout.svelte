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

  function setAvatar(open) {
    aside()?.classList.toggle('menu-open', open);
    aside()?.querySelector('.sidebar-avatar-trigger')?.setAttribute('aria-expanded', String(open));
  }
  function setMore(wrap, open) {
    wrap.classList.toggle('open', open);
    wrap.querySelector('.icon-btn')?.setAttribute('aria-expanded', String(open));
  }
  function closeMore() {
    document.querySelectorAll('.more-menu-wrap.open').forEach((w) => setMore(w, false));
  }
  function onKey(e) {
    if (e.key !== 'Escape') return;
    setAvatar(false);
    closeMore();
  }

  function onShellClick(e) {
    const t = e.target;
    if (t.closest('.sidebar-avatar-trigger')) { setAvatar(!aside().classList.contains('menu-open')); return; }
    const item = t.closest('.avatar-popover .popover-item');
    if (item && /Theme/.test(item.textContent)) { toggleTheme(); return; }
    if (item) { setAvatar(false); return; }
    const more = t.closest('.more-menu-wrap > .icon-btn');
    if (more) {
      const wrap = more.parentElement;
      // Screens without page actions still open an (empty) menu, per the spec.
      if (!wrap.querySelector('.more-menu')) wrap.insertAdjacentHTML('beforeend', '<div class="more-menu"></div>');
      setMore(wrap, !wrap.classList.contains('open'));
      return;
    }
    if (!t.closest('.more-menu')) closeMore();
    if (!t.closest('.sidebar-bottom')) setAvatar(false);
  }
</script>

<svelte:window onclick={onShellClick} onkeydown={onKey} />

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
