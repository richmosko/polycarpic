<script lang="ts">
  // POLY-150 R5: Settings → Sign-in and second step. The set-up dialog opens from here, from the Entities message and (?setup=1) from the gate.
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { actionStates } from '../../../lib/second-step-actions';
  import { api } from '../../../lib/second-step/auth-api';
  import ConfirmItsYou from '../../../lib/second-step/ConfirmItsYou.svelte';
  import PanelAction from '../../../lib/second-step/PanelAction.svelte';
  import SecondStepSetup from '../../../lib/second-step/SecondStepSetup.svelte';

  let { data } = $props();
  type Open = null | 'setup' | 'newcodes' | 'confirm' | 'removeApp' | 'addPasskey';
  let confirming = $state<{ action: string; run: () => void } | null>(null);
  let open = $state<Open>(null);
  let error = $state('');

  // ?setup=1 is a display hint only: it opens the dialog on load and grants nothing.
  onMount(() => {
    if (page.url.searchParams.get('setup') === '1' && !data.secondStep.secondStepAt) open = 'setup';
  });

  const s = $derived(data.secondStep);
  const on = $derived(s.secondStepAt !== null);
  const states = $derived(actionStates({ passkeys: s.passkeys, totp_added_at: s.totpAddedAt, needs_a_method: s.needsAMethod, codes_paused: s.codesPaused }, data.recentAuthOk));
  const day = (iso: string) => iso.slice(0, 10);
  // A step-up action runs directly while the last confirmation is fresh; otherwise it opens Confirm it's you (interim, R6).
  const stepUp = (action: string, run: () => void) => {
    if (data.recentAuthOk) return run();
    confirming = { action, run };
    open = 'confirm';
  };

  async function removePasskey(id: string) {
    error = '';
    const r = await api('POST', '/passkey/delete-passkey', { id });
    if (r.ok) await invalidateAll();
    else error = 'That passkey could not be removed. The database may refuse removing your last method.';
  }

  const btn = 'border-border bg-card hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50';
  const row = 'border-border flex items-center justify-between gap-4 border-t py-3 first:border-t-0';
</script>

<h1 class="font-heading mb-4 text-xl font-semibold">Settings</h1>

{#if data.held}
  <p role="status" class="border-border bg-card mb-4 max-w-2xl rounded-md border p-3 text-sm">Your role needs a second step before you can use shared entities. Set one up to carry on.</p>
{/if}

<section id="second-step" class="bg-card border-border max-w-2xl rounded-xl border p-5">
  <h2 class="font-heading text-base font-semibold">Sign-in and second step</h2>
  <p class="text-muted-foreground mb-2 text-sm">Just you, every entity</p>
  {#if error}<p role="alert" class="text-destructive mb-2 text-sm">{error}</p>{/if}

  {#if !on}
    <div class={row}>
      <div>
        <div class="text-sm font-medium">Second step</div>
        <div class="text-muted-foreground text-xs">Off. Set one up to own or manage a shared entity.</div>
      </div>
      <div class="flex items-center gap-2">
        <span class="border-border rounded-full border px-2 py-0.5 text-xs">Off</span>
        <button type="button" class={btn} aria-haspopup="dialog" onclick={() => (open = 'setup')}>Set up second step</button>
      </div>
    </div>
  {:else}
    <div class={row}>
      <div>
        <div class="text-sm font-medium">Second step</div>
        <div class="text-muted-foreground text-xs">Asked at every new sign-in and before export, purge, granting access and linking a bank.</div>
      </div>
      <span class="bg-accent text-accent-foreground rounded-full px-2 py-0.5 text-xs">On</span>
    </div>
    {#if s.totpAddedAt}
      <div class={row}>
        <div>
          <div class="text-sm">Authenticator app</div>
          <div class="text-muted-foreground text-xs">Added {day(s.totpAddedAt)}</div>
        </div>
        {#if states.removeApp !== 'hidden'}
          <button type="button" class={btn} disabled={states.removeApp === 'disabled'} onclick={() => stepUp('Removing your authenticator app', () => (open = 'removeApp'))}>Remove</button>
        {/if}
      </div>
    {/if}
    {#each s.passkeys as k (k.id)}
      <div class={row}>
        <div>
          <div class="text-sm">Passkey: <span>{k.name}</span></div>
          <div class="text-muted-foreground text-xs">Added {day(k.createdAt)}</div>
        </div>
        {#if states.removePasskey !== 'hidden'}
          <button type="button" class={btn} disabled={states.removePasskey === 'disabled'} onclick={() => stepUp('Removing a passkey', () => removePasskey(k.id))}>Remove</button>
        {/if}
      </div>
    {/each}
    {#if s.needsAMethod && s.passkeys.length + (s.totpAddedAt ? 1 : 0) <= 1}
      <p class="text-muted-foreground py-2 text-xs">This is your only method, and your role needs one, so it can't be removed. Add another first.</p>
    {/if}
    {#if s.codesPaused}
      <p class="text-muted-foreground py-2 text-xs">Codes are paused for this account, so methods can't be removed for now.</p>
    {/if}
    <div class={row}>
      <div class="text-sm font-medium">Add a method</div>
      {#if states.addPasskey !== 'hidden'}
        <button type="button" class={btn} onclick={() => stepUp('Adding a passkey', () => (open = 'addPasskey'))}>Add passkey</button>
      {/if}
    </div>
    {#if states.makeNewCodes !== 'hidden'}
      <div class={row}>
        <div>
          <div class="text-sm font-medium">Backup codes</div>
          <div class="text-muted-foreground text-xs">Each works once; new codes replace them all.</div>
        </div>
        <button type="button" class={btn} onclick={() => stepUp('Making new backup codes', () => (open = 'newcodes'))}>Make new codes</button>
      </div>
    {/if}
  {/if}
</section>

{#if open === 'setup'}
  <SecondStepSetup resume={s.step} next={page.url.searchParams.get('next')} offered={!data.held && page.url.searchParams.get('setup') === '1'} onclose={() => (open = null)} />
{:else if open === 'newcodes'}
  <SecondStepSetup mode="newcodes" onclose={() => (open = null)} />
{:else if open === 'removeApp' || open === 'addPasskey'}
  <PanelAction kind={open} onclose={() => (open = null)} />
{:else if open === 'confirm' && confirming}
  <ConfirmItsYou
    action={confirming.action}
    hasApp={s.totpAddedAt !== null}
    hasPasskey={s.passkeys.length > 0}
    onconfirmed={() => {
      const run = confirming?.run;
      open = null;
      confirming = null;
      run?.(); // a new request on the refreshed data, never a replay
    }}
    onclose={() => {
      open = null;
      confirming = null;
    }}
  />
{/if}
