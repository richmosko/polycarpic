<script>
  import { onMount, onDestroy } from 'svelte';
  import { screens } from './screens';

  let { name } = $props();
  const screen = screens[name];

  // The styled screens carry small inline scripts (hash states, tabs, copy,
  // expand). Run them on mount and undo their document/window listeners on leave.
  onMount(() => {
    // Client-side navigation to /x#id does not update :target; redo it as a fragment navigation.
    const h = location.hash;
    if (h.length > 1) {
      const t = setTimeout(() => { location.replace('#'); location.replace(h); }, 0);
      onDestroy(() => clearTimeout(t));
    }
    const added = [];
    const wrap = (t) => {
      const orig = t.addEventListener;
      t.addEventListener = function (type, fn, opts) { added.push([t, type, fn, opts]); return orig.call(this, type, fn, opts); };
      return () => { t.addEventListener = orig; };
    };
    const un = [wrap(document), wrap(window)];
    try { new Function(screen.script)(); } finally { un.forEach((u) => u()); }
    return () => {
      added.forEach(([t, type, fn, opts]) => t.removeEventListener(type, fn, opts));
      delete document.documentElement.dataset.state;
    };
  });
</script>

<svelte:head><title>{name} — Polycarpic prototype</title></svelte:head>
{@html screen.html}
