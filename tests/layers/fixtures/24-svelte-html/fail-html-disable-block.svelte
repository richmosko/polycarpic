<!-- @virtual-path: apps/web/src/routes/x.svelte -->
<!-- @expect: svelte/no-at-html-tags -->
<!-- red if: a bare eslint-disable HTML comment silences the rule (A-39) -->
<!-- eslint-disable -->
<script lang="ts">
  let x = '<b>hi</b>';
</script>
{@html x}
