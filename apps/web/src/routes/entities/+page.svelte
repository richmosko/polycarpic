<script lang="ts">
  import EmptyState from '../../lib/shell/EmptyState.svelte';
  import SecondStepSetup from '../../lib/second-step/SecondStepSetup.svelte';

  let { data } = $props();
  let open = $state(false);
</script>

{#if data.secondStepOff}
  <div role="note" class="bg-card border-border mb-4 flex items-center justify-between gap-4 rounded-md border p-3 text-sm">
    <span>Shared entities need a second step. Set one up to create a Trust, Business, Household or Holding, or to invite someone to your Person.</span>
    <button type="button" aria-haspopup="dialog" onclick={() => (open = true)} class="bg-primary text-primary-foreground focus-visible:ring-ring shrink-0 rounded-md px-3 py-1.5 font-medium focus-visible:ring-2 focus-visible:outline-none">Set up second step</button>
  </div>
{/if}

<EmptyState title="Entities" />

{#if open}
  <SecondStepSetup resume={data.resume} onclose={() => (open = false)} />
{/if}
