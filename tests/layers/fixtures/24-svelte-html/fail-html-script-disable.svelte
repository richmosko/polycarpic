<!-- @virtual-path: apps/web/src/routes/x.svelte -->
<!-- @expect: svelte/no-at-html-tags -->
<!-- red if: a script-side /* eslint-disable */ silences the template rule (A-39) -->
<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  let x = '<b>hi</b>';
</script>
{@html x}
