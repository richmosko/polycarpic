<!-- @virtual-path: apps/web/src/routes/x.svelte -->
<!-- @expect: no-restricted-imports -->
<!-- red if: SRC lacks `svelte`, so layer rules skip .svelte files, or the parser hides the script imports -->
<script lang="ts">
  import { open } from '@poly/secrets/open';
  const o = open;
</script>
{o}
