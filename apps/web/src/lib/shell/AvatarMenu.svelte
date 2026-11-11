<script lang="ts">
  import { DropdownMenu } from 'bits-ui';
  import Icon from './Icon.svelte';
  import type { ShellSession } from './session';
  import { applyTheme, readTheme, type Theme } from './theme';

  let { session }: { session: ShellSession | null } = $props();

  let theme = $state<Theme>(readTheme());
  const name = $derived(session?.user.name ?? 'Account');
  const initial = $derived(name.slice(0, 1).toUpperCase());

  const pending = ['Profile', 'Settings', 'Notifications', 'Preferences'];

  async function logOut() {
    await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    location.assign('/sign-in');
  }

  function setTheme(value: string) {
    theme = value as Theme;
    applyTheme(theme);
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring flex w-full items-center gap-3 rounded-md p-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
  >
    <span
      aria-hidden="true"
      class="bg-sidebar-border flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium"
      >{initial}</span
    >
    <span class="sr-only">{name}</span>
    <span aria-hidden="true" class="truncate rail:hidden">{name}</span>
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      side="right"
      align="end"
      sideOffset={12}
      class="bg-popover text-popover-foreground border-border min-w-48 rounded-md border p-1 shadow-md"
    >
      {#each pending as item (item)}
        <DropdownMenu.Item
          disabled
          aria-disabled="true"
          class="text-muted-foreground rounded px-3 py-1.5 text-sm"
        >
          {item}
        </DropdownMenu.Item>
      {/each}
      <DropdownMenu.Separator class="bg-border my-1 h-px" />
      <DropdownMenu.Group>
        <DropdownMenu.GroupHeading class="text-muted-foreground px-3 py-1 text-xs"
          >Theme</DropdownMenu.GroupHeading
        >
        <DropdownMenu.RadioGroup value={theme} onValueChange={setTheme}>
          {#each [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']] as const as [option, text] (option)}
            <DropdownMenu.RadioItem
              value={option}
              closeOnSelect={false}
              class="data-highlighted:bg-accent rounded px-3 py-1.5 text-sm data-[state=checked]:font-semibold"
            >
              {#snippet children({ checked })}
                <span class="inline-flex w-4 shrink-0 items-center" data-testid="theme-check">
                  {#if checked}<Icon name="check" class="size-4" />{/if}
                </span>
                {text}
              {/snippet}
            </DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Group>
      <DropdownMenu.Separator class="bg-border my-1 h-px" />
      <DropdownMenu.Item
        disabled
        aria-disabled="true"
        class="text-muted-foreground rounded px-3 py-1.5 text-sm">Shortcuts</DropdownMenu.Item
      >
      {#if session}
        <DropdownMenu.Item onSelect={logOut} class="text-destructive rounded px-3 py-1.5 text-sm">Log out</DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
