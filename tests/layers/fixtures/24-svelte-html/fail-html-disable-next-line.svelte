<!-- @virtual-path: apps/web/src/routes/x.svelte -->
<!-- @expect: svelte/no-at-html-tags -->
<!-- red if: an inline eslint-disable-next-line silences the rule (A-39); noInlineConfig dropped for .svelte -->
<script lang="ts">
  let x = '<b>hi</b>';
</script>
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
{@html x}
