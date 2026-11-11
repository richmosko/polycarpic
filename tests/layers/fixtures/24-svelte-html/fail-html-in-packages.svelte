<!-- @virtual-path: packages/ui/src/x.svelte -->
<!-- @expect: svelte/no-at-html-tags -->
<!-- red if: the rule is scoped to apps/ only; C-41 covers packages/ too -->
<script lang="ts">
  let x = '<b>hi</b>';
</script>
{@html x}
