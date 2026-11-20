<script lang="ts">
  import { DropdownMenu } from 'bits-ui';

  let {
    entities,
    current,
    heldLabel,
  }: { entities: readonly { id: string; name: string }[]; current: string | null; heldLabel?: string } = $props();

  const label = $derived(entities.find((e) => e.id === current)?.name ?? 'Entity');
</script>

{#if heldLabel}
  <!-- A held user (POLY-150 R1.3): the one label, from the session row. Shared entities are POLY-91's. -->
  <button
    type="button"
    disabled
    class="border-border bg-card text-card-foreground rounded-md border px-3 py-1.5 text-sm"
  >
    {heldLabel}
  </button>
{:else if entities.length === 0}
  <button
    type="button"
    disabled
    aria-label="No entity"
    class="border-border bg-card text-muted-foreground rounded-md border px-3 py-1.5 text-sm opacity-70"
  >
    No entity
  </button>
{:else}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class="border-border bg-card text-card-foreground focus-visible:ring-ring rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
    >
      {label}
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        class="bg-popover text-popover-foreground border-border rounded-md border p-1 shadow-md"
      >
        {#each entities as entity (entity.id)}
          <DropdownMenu.Item class="data-highlighted:bg-accent rounded px-3 py-1.5 text-sm">
            {entity.name}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
{/if}
