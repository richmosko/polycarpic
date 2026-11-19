<script lang="ts">
  // POLY-150 Addendum 3 A2: Confirm it's you before a step-up action. Password and an authenticator code, or a passkey with user verification. Opening it
  // sends `begin` for the method shown first; switching method begins again. After a pass the host's data reloads (invalidateAll) and the action that
  // opened the dialog runs as a new request, never a replay. Same mounting (portal on document.body, no page form, fetch only to /api/auth) and clearing
  // as the set-up dialog: the password and code live only here and go on every way out. The backup-code option waits on D7.
  import { Dialog } from 'bits-ui';
  import { invalidateAll } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { api } from './auth-api';
  import { getCredential, type RequestOptionsJSON } from './webauthn';

  let {
    action,
    hasApp,
    hasPasskey,
    onconfirmed,
    onclose,
  }: {
    /** The action's name as a phrase that starts a sentence: "Making new backup codes". */
    action: string;
    /** The user has an authenticator app (my_second_step's totp_added_at); without one the dialog is the passkey-only variant. */
    hasApp: boolean;
    /** The user has a passkey: the paused state offers it only then. */
    hasPasskey: boolean;
    /** Runs after a pass, once the data has reloaded. */
    onconfirmed: () => void;
    onclose: () => void;
  } = $props();

  type Method = 'totp' | 'passkey';
  // svelte-ignore state_referenced_locally
  let method = $state<Method>(hasApp ? 'totp' : 'passkey');
  let challengeId = $state('');
  let options = $state<RequestOptionsJSON | null>(null);
  let password = $state('');
  let code = $state('');
  let error = $state('');
  let paused = $state(false);
  let signInAgain = $state(false);
  let busy = $state(false);

  const clear = () => {
    password = '';
    code = '';
    challengeId = '';
    options = null;
  };
  const close = () => {
    clear();
    onclose();
  };
  onDestroy(clear);

  async function begin(m: Method) {
    method = m;
    error = '';
    options = null;
    const r = await api<{ challengeId?: string; options?: RequestOptionsJSON }>('POST', '/second-step/reauth/begin', { method: m });
    if (r.ok && typeof r.body.challengeId === 'string') {
      challengeId = r.body.challengeId;
      options = r.body.options ?? null;
    } else refused(r);
  }
  onMount(() => void begin(method));

  async function passed() {
    clear();
    await invalidateAll();
    onconfirmed();
  }
  /** A refusal, by status and code only (Addendum 4); the service's message is never shown. */
  function refused(r: { status: number; body: { code?: string } }) {
    if (r.status === 401) location.assign('/sign-in');
    else if (r.status === 429 && r.body.code === 'ACCOUNT_TEMPORARILY_LOCKED') paused = true;
    else if (r.status === 429) error = 'Too many attempts. Wait a minute and try again.';
    else if (r.status === 403 && r.body.code === 'challenge_expired') {
      error = 'Try again.';
      void renew();
    } else if (r.status === 403 && r.body.code === 'password_required') {
      signInAgain = true;
      error = 'Sign in again to confirm it\'s you.';
    } else if (r.status === 403 && r.body.code === 'step_up_failed') error = method === 'passkey' ? "That passkey didn't work. Try again." : "That password or code didn't work. Check both and try again.";
    else error = 'That did not work. Close this and try again.';
  }
  /** A new challenge for the method on screen, keeping the message that asked for it. */
  async function renew() {
    const keep = error;
    await begin(method);
    if (!error && !paused) error = keep;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy || !challengeId) return;
    busy = true;
    error = '';
    try {
      const r = await api('POST', '/second-step/reauth', { challengeId, password, code });
      password = '';
      code = '';
      if (r.ok) return await passed();
      refused(r); // a wrong password or code does not consume the challenge: the same one is retried
    } finally {
      busy = false;
    }
  }

  async function usePasskey() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      if (method !== 'passkey' || !options) await begin('passkey');
      const o = options;
      const response = o ? await getCredential(o) : null;
      const r = response ? await api('POST', '/second-step/reauth/passkey', { challengeId, response }) : null;
      if (r?.ok) return await passed();
      if (r) refused(r);
      else error = "That passkey didn't work. Try again.";
      if (!paused && !(r?.status === 403 && r.body.code === 'challenge_expired')) await begin('passkey'); // a failed assertion consumed the challenge
      if (!error) error = "That passkey didn't work. Try again.";
    } finally {
      busy = false;
    }
  }

  const field = 'border-input bg-card text-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none';
  const primary = 'bg-primary text-primary-foreground focus-visible:ring-ring rounded-md px-3 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50';
  const ghost = 'text-foreground hover:bg-accent focus-visible:ring-ring rounded-md px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none';
  const link = 'text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded text-sm underline focus-visible:ring-2 focus-visible:outline-none';
</script>

<svelte:window onpagehide={clear} />

<Dialog.Root open={true} onOpenChange={(o) => !o && close()}>
  <Dialog.Portal to={document.body}>
    <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
    <Dialog.Content class="bg-card text-card-foreground border-border fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-6 shadow-lg">
      <Dialog.Title class="font-heading text-lg font-semibold">Confirm it's you</Dialog.Title>
      <Dialog.Description class="text-muted-foreground mt-1 text-sm">{action} needs a fresh check. You won't be asked again for 5 minutes.</Dialog.Description>
      <div class="mt-4 flex flex-col gap-3 text-sm">
        {#if paused}
          <div role="status" class="border-border bg-background rounded-md border p-3"><strong>Codes are paused</strong> after too many wrong codes. Try again later.</div>
          {#if hasPasskey}<p class="text-muted-foreground text-xs">Use a passkey if you have one; it still works.</p>{/if}
          <div class="flex justify-end gap-2">
            <button type="button" class={ghost} onclick={close}>Cancel</button>
            {#if hasPasskey}<button type="button" class={primary} disabled={busy} onclick={() => { paused = false; void usePasskey(); }}>Use a passkey</button>{/if}
          </div>
        {:else if method === 'passkey'}
          <p>Your browser asks for Touch ID, Face ID or your security key.</p>
          {#if error}<p role="alert" class="text-destructive text-sm">{error}{#if signInAgain} <a class="underline" href="/sign-in">Sign in again</a>{/if}</p>{/if}
          <div class="flex items-center justify-between gap-2">
            {#if hasApp}<button type="button" class={link} onclick={() => begin('totp')}>Use your authenticator app</button>{:else}<span></span>{/if}
            <div class="flex gap-2">
              <button type="button" class={ghost} onclick={close}>Cancel</button>
              <button type="button" class={primary} disabled={busy} onclick={usePasskey}>{hasApp ? 'Use a passkey' : 'Use your passkey'}</button>
            </div>
          </div>
        {:else}
          <form onsubmit={submit} class="flex flex-col gap-3">
            <div class="flex flex-col gap-1">
              <label for="ciy-pw">Password</label>
              <input id="ciy-pw" class={field} type="password" autocomplete="current-password" bind:value={password} required />
            </div>
            <div class="flex flex-col gap-1">
              <label for="ciy-code">Code from your authenticator app</label>
              <input id="ciy-code" class="{field} font-mono tracking-widest" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" bind:value={code} aria-invalid={error ? 'true' : undefined} required />
              {#if error}<p role="alert" class="text-destructive text-xs">{error}</p>{/if}
            </div>
            <p class="text-muted-foreground text-xs">
              <button type="button" class={link} onclick={() => begin('passkey')}>Use a passkey instead</button>
            </p>
            <div class="flex justify-end gap-2">
              <button type="button" class={ghost} onclick={close}>Cancel</button>
              <button type="submit" class={primary} disabled={busy || !challengeId}>Confirm</button>
            </div>
          </form>
        {/if}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
