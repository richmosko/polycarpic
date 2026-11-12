<!-- @virtual-path: apps/web/src/routes/x.svelte -->
<!-- @expect: poly/no-relative-cross-package -->
<script lang="ts">
  import { m } from '../../../migrate/src/index.ts';
  export let y = m;
</script>
