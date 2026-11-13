<!-- @virtual-path: apps/web/src/routes/x.svelte -->
<!-- @expect: poly/confined-module -->
<script lang="ts">
  import { enterNewUserOn } from '@poly/db/new-user';
  export let y = enterNewUserOn;
</script>
