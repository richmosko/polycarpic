<!-- @virtual-path: apps/web/src/routes/x.svelte -->
<!-- @expect: svelte/no-at-html-tags -->
<!-- red if: svelte/no-at-html-tags is not enabled for .svelte files (C-41) -->
<script lang="ts">
  let x = '<b>hi</b>';
</script>
{@html x}
