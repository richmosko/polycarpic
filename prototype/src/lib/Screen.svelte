<script>
  import { onMount } from 'svelte';
  import { screens } from './screens';

  let { name } = $props();
  const screen = screens[name];

  // The styled screens carry small inline scripts (hash states, tabs, copy,
  // expand). Run them on mount and undo their document/window listeners on leave.
  onMount(() => {
    const added = [];
    const wrap = (t) => {
      const orig = t.addEventListener;
      t.addEventListener = function (type, fn, opts) { added.push([t, type, fn, opts]); return orig.call(this, type, fn, opts); };
      return () => { t.addEventListener = orig; };
    };
    const un = [wrap(document), wrap(window)];
    try { new Function(screen.script)(); }
    catch (e) { console.warn('[prototype] DESIGN inline script threw (reported to ux-designer):', e.message); }
    finally { un.forEach((u) => u()); }
    return () => {
      added.forEach(([t, type, fn, opts]) => t.removeEventListener(type, fn, opts));
      delete document.documentElement.dataset.state;
    };
  });
</script>

<svelte:head><title>{name} — Polycarpic prototype</title></svelte:head>
{@html screen.html}
