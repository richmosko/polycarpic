<script lang="ts">
  import { ICONS, type IconName } from './icons';

  let {
    name,
    class: cls = 'size-5',
    stroke = 2,
  }: { name: IconName; class?: string; stroke?: number } = $props();
</script>

<svg
  viewBox="0 0 24 24"
  aria-hidden="true"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  class={cls}
>
  {#each ICONS[name] as shape}
    <svelte:element this={shape.t} {...shape.a} />
  {/each}
</svg>
