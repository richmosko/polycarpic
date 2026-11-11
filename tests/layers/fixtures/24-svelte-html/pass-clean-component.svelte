<!-- @virtual-path: apps/web/src/routes/x.svelte -->
<!-- red if: the svelte parser/rule block rejects a plain component (over-blocking) -->
<script lang="ts">
  let x: string = 'hi';
</script>
<p>{x}</p>
