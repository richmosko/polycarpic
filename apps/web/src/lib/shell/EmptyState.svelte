<script lang="ts">
  let { title }: { title: string } = $props();
</script>

<svelte:head><title>{title} · polycarpic</title></svelte:head>

<section class="border-border bg-card text-card-foreground rounded-xl border p-10 text-center">
  <h2 class="font-heading text-lg font-semibold">Nothing here yet</h2>
  <p class="text-muted-foreground mt-2 text-sm">{title} will appear here once it is built.</p>
</section>
