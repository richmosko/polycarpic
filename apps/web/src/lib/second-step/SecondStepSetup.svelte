<script lang="ts">
  // POLY-150 R3: the one set-up dialog (and Settings' Make new codes). Rendered by bits-ui into document.body, so it never sits inside a page <form>.
  // Its steps are <form>s of their own with no action and no method: every submit calls preventDefault() and posts only by fetch to /api/auth/*.
  // Every secret (password, code, URI, key, QR, backup codes) lives only in this component's state and is cleared on every way out (R3.5).
  import { Dialog } from 'bits-ui';
  import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import { safeNext } from '../safe-next';
  import Icon from '../shell/Icon.svelte';
  import { api } from './auth-api';
  import { createCredential, type CreationOptionsJSON } from './webauthn';
  import { keyFromUri, qrPath } from './qr';

  type Step = 'password' | 'no-mail' | 'email' | 'method' | 'scan' | 'wait' | 'restart' | 'codes' | 'done';
  let {
    mode = 'setup',
    resume = 'password',
    title = mode === 'newcodes' ? 'Make new backup codes' : 'Set up a second step',
    subtitle = mode === 'newcodes' ? 'New codes replace the ones you have now.' : 'A second step keeps a stolen password from reaching your books. Owners and managers of shared entities need one.',
    next,
    offered = false,
    onclose,
  }: {
    mode?: 'setup' | 'newcodes';
    /** Where a reopened set-up resumes (my_second_step's `step`). */
    resume?: 'password' | 'email_code' | 'factor';
    title?: string;
    subtitle?: string;
    /** After Done, go here (through safeNext). Absent: stay on the page that opened the dialog. */
    next?: string | null;
    /** A viewer just after Sign up: set-up is optional, so step 1 offers Skip for now. */
    offered?: boolean;
    onclose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let step = $state<Step>(mode === 'setup' && resume === 'email_code' ? 'email' : mode === 'setup' && resume === 'factor' ? 'method' : 'password');
  let busy = $state(false);
  let error = $state('');
  let signInAgain = $state(false);
  // Secrets: this component's own state, nowhere else.
  let password = $state('');
  let code = $state('');
  let sentTo = $state('');
  let method = $state<'app' | 'passkey'>('app');
  let passkeyName = $state('');
  let totpUri = $state('');
  let codes = $state<string[]>([]);
  let saved = $state(false);
  let confirmLeave = $state(false);
  let pendingTo: URL | null = null;
  let leaving = false;

  const qr = $derived(totpUri ? qrPath(totpUri) : null);
  const key = $derived(totpUri ? keyFromUri(totpUri) : '');
  const stepLabel = $derived(
    step === 'password' || step === 'restart' ? 'Step 1 of 3 · Your password' : step === 'email' ? 'Step 2 of 3 · Check your email' : step === 'scan' ? 'Step 3 of 3 · Add Polycarpic to your authenticator app' : step === 'method' || step === 'wait' ? 'Step 3 of 3 · Choose your second step' : step === 'codes' ? 'Last step · Save your backup codes' : '',
  );

  function clearSecrets() {
    password = '';
    code = '';
    totpUri = '';
    codes = [];
    saved = false;
    sentTo = '';
    passkeyName = '';
  }
  function close() {
    clearSecrets();
    onclose();
  }
  /** Close, Escape and the backdrop: with codes on screen that were not saved, ask first (R3.4). */
  function requestClose() {
    if (step === 'codes' && !saved) {
      confirmLeave = true;
      return;
    }
    close();
  }

  beforeNavigate(({ cancel, to }) => {
    if (leaving) return;
    if (step === 'codes' && !saved) {
      cancel();
      pendingTo = to?.url ?? null;
      confirmLeave = true;
      return;
    }
    clearSecrets();
  });
  onDestroy(clearSecrets);

  function leaveAnyway() {
    leaving = true;
    const to = pendingTo;
    confirmLeave = false;
    close();
    if (to) void goto(to);
  }

  /** Arrow keys move the choice, as a radio group does: only the checked card is in the tab order. */
  function chooseByKey(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    method = method === 'app' ? 'passkey' : 'app';
    error = '';
    const cards = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="radio"]');
    cards[method === 'app' ? 0 : 1]?.focus();
  }

  const cleanly = (e: SubmitEvent, run: () => Promise<void>) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    void run().finally(() => (busy = false));
  };
  const lapsed = (r: { status: number; body: { code?: string } }) => {
    if (r.status === 403 && r.body.code === 'email_confirmation_required') {
      step = 'restart';
      password = '';
      return true;
    }
    return false;
  };

  const sendNow = async () => {
      signInAgain = false;
      const r = await api<{ sentTo?: string }>('POST', '/second-step/send-code', { password });
      password = ''; // the dialog keeps no password past its own request (S5)
      if (r.status === 503) step = 'no-mail';
      else if (r.ok) {
        sentTo = typeof r.body.sentTo === 'string' ? r.body.sentTo : '';
        code = '';
        step = 'email';
      } else if (r.body.code === 'recent_sign_in_required') {
        signInAgain = true;
        error = 'For your safety, sign in again before setting up a second step.';
      } else if (r.body.code === 'email_not_verified') error = 'Verify your email address first, then come back.';
      else if (r.body.code === 'invalid_password') error = "That password isn't right.";
      else if (r.status === 429) error = 'Too many attempts. Wait a minute and try again.';
      else error = 'That did not work. Try again.';
  };
  const sendCode = (e: SubmitEvent) => cleanly(e, sendNow);

  const confirmCode = (e: SubmitEvent) =>
    cleanly(e, async () => {
      const r = await api('POST', '/second-step/confirm-code', { code });
      if (r.ok) {
        code = '';
        step = 'method';
      } else if (lapsed(r)) return;
      else if (r.status === 429) error = 'Too many attempts. Wait a minute and try again.';
      else error = 'That code is wrong or has expired. Check the latest email, or send a new code. After 5 wrong tries a code stops working.';
    });

  const showQr = (e: SubmitEvent) =>
    cleanly(e, async () => {
      const r = await api<{ totpURI?: string; backupCodes?: string[] }>('POST', '/two-factor/enable', { password });
      password = '';
      if (r.ok && typeof r.body.totpURI === 'string') {
        totpUri = r.body.totpURI;
        codes = Array.isArray(r.body.backupCodes) ? r.body.backupCodes : [];
        code = '';
        step = 'scan';
      } else if (lapsed(r)) return;
      else if (r.body.code === 'invalid_password') error = "That password isn't right.";
      else if (r.status === 429) error = 'Too many attempts. Wait a minute and try again.';
      else error = 'That did not work. Try again.';
    });

  const turnOn = (e: SubmitEvent) =>
    cleanly(e, async () => {
      const r = await api('POST', '/two-factor/verify-totp', { code });
      if (r.ok) {
        code = '';
        totpUri = ''; // the URI, the key and the QR are dropped; no route returns them again (S7, S9)
        step = 'codes';
        await invalidateAll(); // the session rotated: the host's data loads under the new handle (R3.6)
      } else if (r.status === 429) error = 'Too many attempts. Wait a minute and try again.';
      else error = "That code didn't match. Enter the newest code your app shows; each lasts 30 seconds. If it still fails, check that your phone sets its clock automatically.";
    });

  const createPasskey = (e: SubmitEvent) =>
    cleanly(e, async () => {
      const failed = () => {
        step = 'method';
        error = "The passkey wasn't created. The prompt may have been closed, or this device can't make one. Try again, or choose Authenticator app.";
      };
      step = 'wait';
      const o = await api<CreationOptionsJSON>('GET', '/passkey/generate-register-options');
      if (!o.ok) return failed();
      const response = await createCredential(o.body);
      if (!response) return failed();
      const v = await api('POST', '/passkey/verify-registration', { response, name: passkeyName.trim() || 'Passkey' }); // never createSession (S19)
      if (!v.ok) return failed();
      step = 'done';
      await invalidateAll();
    });

  const newCodes = (e: SubmitEvent) =>
    cleanly(e, async () => {
      const r = await api<{ backupCodes?: string[] }>('POST', '/two-factor/generate-backup-codes', { password });
      password = '';
      if (r.ok && Array.isArray(r.body.backupCodes)) {
        codes = r.body.backupCodes;
        saved = false;
        step = 'codes';
      } else if (r.body.code === 'invalid_password') error = "That password isn't right.";
      else if (r.status === 429) error = 'Too many attempts. Wait a minute and try again.';
      else error = 'That did not work. Try again.';
    });

  const restart = (e: SubmitEvent) =>
    cleanly(e, async () => {
      await sendNow(); // a refusal is shown on this step
    });

  async function copyKey() {
    await navigator.clipboard?.writeText(key.replace(/\s/g, '')).catch(() => {});
  }
  async function copyAll() {
    await navigator.clipboard?.writeText(codes.join('\n')).catch(() => {});
  }
  function download() {
    const url = URL.createObjectURL(new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'polycarpic-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url); // the object URL is revoked once used
  }
  function finish() {
    const go = mode === 'setup' && next ? safeNext(next) : null;
    close();
    if (go) void goto(go);
  }

  const field = 'border-input bg-card text-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none';
  const primary = 'bg-primary text-primary-foreground focus-visible:ring-ring rounded-md px-3 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50';
  const ghost = 'text-foreground hover:bg-accent focus-visible:ring-ring rounded-md px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none';
  const outline = 'border-border bg-card text-card-foreground hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none';
</script>

<!-- A key or QR restored from the back-forward cache is never shown: the page is left with nothing in it (R3.5). -->
<svelte:window onpagehide={clearSecrets} />

<Dialog.Root open={true} onOpenChange={(o) => !o && requestClose()}>
  <Dialog.Portal to={document.body}>
    <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
    <Dialog.Content
      class="bg-card text-card-foreground border-border fixed top-1/2 left-1/2 z-50 max-h-[90svh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border p-6 shadow-lg"
    >
      <Dialog.Title class="font-heading text-lg font-semibold">{title}</Dialog.Title>
      <Dialog.Description class="text-muted-foreground mt-1 text-sm">{subtitle}</Dialog.Description>

      {#if confirmLeave}
        <div class="mt-4 flex flex-col gap-3 text-sm" role="alertdialog" aria-label="Leave without saving your codes?">
          <p><strong>Leave without saving your codes?</strong> They are already on, and they will not be shown again.</p>
          <div class="flex justify-end gap-2">
            <button type="button" class={ghost} onclick={() => (confirmLeave = false)}>Stay</button>
            <button type="button" class={primary} onclick={leaveAnyway}>Leave anyway</button>
          </div>
        </div>
      {:else}
        <div class="mt-4 flex flex-col gap-3 text-sm">
          {#if stepLabel}<p class="text-muted-foreground text-xs font-medium">{stepLabel}</p>{/if}

          {#if step === 'password'}
            <form onsubmit={mode === 'newcodes' ? newCodes : sendCode} class="flex flex-col gap-3">
              <div class="flex flex-col gap-1">
                <label for="ssd-pw">Password</label>
                <input id="ssd-pw" class={field} type="password" autocomplete="current-password" placeholder="Password" bind:value={password} required />
              </div>
              {#if offered}<p>You joined as a viewer, so this is optional for now. Owners and managers need one, and the first action that needs it asks again.</p>{/if}
              {#if mode === 'setup'}<p class="text-muted-foreground text-xs">Next we email you a code, then you choose an authenticator app or a passkey.</p>{/if}
              {#if error}<p role="alert" class="text-destructive text-sm">{error}{#if signInAgain} <a class="underline" href="/sign-in">Sign in again</a>{/if}</p>{/if}
              <div class="flex justify-end gap-2">
                <button type="button" class={ghost} onclick={close}>{offered ? 'Skip for now' : 'Cancel'}</button>
                <button type="submit" class={primary} disabled={busy}>{mode === 'newcodes' ? 'Make new codes' : 'Continue'}</button>
              </div>
            </form>
          {:else if step === 'no-mail'}
            <div role="status" class="border-border bg-background rounded-md border p-3">Codes can't be sent from this server yet, so a second step can't be set up. Ask the person who runs Polycarpic.</div>
            <div class="flex justify-end"><button type="button" class={primary} onclick={close}>Close</button></div>
          {:else if step === 'email'}
            <form onsubmit={confirmCode} class="flex flex-col gap-3">
              <p>We've asked for a code to be sent to <span class="font-mono">{sentTo || 'your account email'}</span>. It can take a few minutes. This confirms it's really you before your first second step is set up.</p>
              <div class="flex flex-col gap-1">
                <label for="ssd-code">Code from the email</label>
                <input id="ssd-code" class="{field} font-mono text-xl tracking-[0.4em] text-center" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" bind:value={code} aria-invalid={error ? 'true' : undefined} required />
                {#if error}<p role="alert" class="text-destructive text-xs">{error}</p>{/if}
              </div>
              <p class="text-muted-foreground text-xs">
                This code works for 10 minutes, once, in this window. Didn't get it? Check spam, or
                <button type="button" class="underline" onclick={() => { step = 'password'; error = ''; code = ''; }}>send a new code</button>, which asks for your password again.
              </p>
              <div class="flex justify-end gap-2">
                <button type="button" class={ghost} onclick={close}>Cancel</button>
                <button type="submit" class={primary} disabled={busy}>Continue</button>
              </div>
            </form>
          {:else if step === 'restart'}
            <form onsubmit={restart} class="flex flex-col gap-3">
              <p>This set-up took longer than 10 minutes, so for your safety it starts again from your password. Nothing was turned on.</p>
              <div class="flex flex-col gap-1">
                <label for="ssd-restart">Password</label>
                <input id="ssd-restart" class={field} type="password" autocomplete="current-password" placeholder="Password" bind:value={password} required />
              </div>
              {#if error}<p role="alert" class="text-destructive text-sm">{error}</p>{/if}
              <div class="flex justify-end gap-2">
                <button type="button" class={ghost} onclick={close}>Cancel</button>
                <button type="submit" class={primary} disabled={busy}>Continue</button>
              </div>
            </form>
          {:else if step === 'method'}
            <div role="radiogroup" aria-label="Second step method" class="grid gap-2 sm:grid-cols-2" tabindex="-1" onkeydown={chooseByKey}>
              {#each [{ id: 'app', name: 'Authenticator app', text: 'A 6-digit code from an app on your phone. Works on every device.' }, { id: 'passkey', name: 'Passkey', text: 'Touch ID, Face ID or a security key on this device.' }] as m (m.id)}
                <button
                  type="button"
                  role="radio"
                  aria-checked={method === m.id}
                  tabindex={method === m.id ? 0 : -1}
                  class="border-border rounded-md border p-3 text-left {method === m.id ? 'border-primary bg-accent' : 'bg-card'} focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none"
                  onclick={() => { method = m.id as 'app' | 'passkey'; error = ''; }}
                >
                  <span class="block font-medium">{m.name}</span>
                  <span class="text-muted-foreground text-xs">{m.text}</span>
                </button>
              {/each}
            </div>
            {#if method === 'app'}
              <form onsubmit={showQr} class="flex flex-col gap-3">
                <div class="flex flex-col gap-1">
                  <label for="ssd-pw2">Your password, again</label>
                  <input id="ssd-pw2" class={field} type="password" autocomplete="current-password" placeholder="Password" bind:value={password} required />
                </div>
                <p class="text-muted-foreground text-xs">Your password unlocks the QR code for your app. This window keeps none of it.</p>
                {#if error}<p role="alert" class="text-destructive text-sm">{error}</p>{/if}
                <div class="flex justify-end gap-2">
                  <button type="button" class={ghost} onclick={close}>Cancel</button>
                  <button type="submit" class={primary} disabled={busy}>Show the QR code</button>
                </div>
              </form>
            {:else}
              <form onsubmit={createPasskey} class="flex flex-col gap-3">
                <div class="flex flex-col gap-1">
                  <label for="ssd-pk">Name this passkey</label>
                  <input id="ssd-pk" class={field} type="text" bind:value={passkeyName} />
                  <p class="text-muted-foreground text-xs">So you can tell your passkeys apart in Settings.</p>
                </div>
                <p class="text-muted-foreground text-xs">Your browser asks for Touch ID, Face ID or your security key next. A passkey comes with no backup codes; add an authenticator app in Settings to get them.</p>
                {#if error}<p role="alert" class="text-destructive text-sm">{error}</p>{/if}
                <div class="flex justify-end gap-2">
                  <button type="button" class={ghost} onclick={close}>Cancel</button>
                  <button type="submit" class={primary} disabled={busy}>{error ? 'Try again' : 'Create passkey'}</button>
                </div>
              </form>
            {/if}
          {:else if step === 'wait'}
            <div role="status" class="border-border bg-background rounded-md border p-3">Follow your browser's prompt to create the passkey.</div>
            <div class="flex justify-end"><button type="button" class={ghost} onclick={close}>Cancel</button></div>
          {:else if step === 'scan'}
            <form onsubmit={turnOn} class="flex flex-col gap-3">
              <div class="flex items-start gap-4">
                {#if qr}
                  <svg role="img" aria-label="QR code for your authenticator app" viewBox="-2 -2 {qr.size + 4} {qr.size + 4}" class="size-40 shrink-0 rounded-md bg-white text-black" shape-rendering="crispEdges">
                    <path d={qr.d} fill="currentColor" />
                  </svg>
                {/if}
                <div>
                  Scan this with your authenticator app, or enter the key by hand:
                  <div class="text-foreground mt-1.5 font-mono" data-testid="totp-key">{key}</div>
                  <button type="button" class="{ghost} mt-1 -ml-3 inline-flex items-center gap-1.5" onclick={copyKey}><Icon name="copy" class="size-4" />Copy key</button>
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <label for="ssd-totp">Enter the 6-digit code it shows</label>
                <input id="ssd-totp" class="{field} font-mono text-xl tracking-[0.4em] text-center" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" bind:value={code} aria-invalid={error ? 'true' : undefined} required />
                {#if error}<p role="alert" class="text-destructive text-xs">{error}</p>{/if}
              </div>
              <p class="text-muted-foreground text-xs">Next you get ten backup codes to keep somewhere safe.</p>
              <div class="flex justify-end gap-2">
                <button type="button" class={ghost} onclick={close}>Cancel</button>
                <button type="submit" class={primary} disabled={busy}>Turn on second step</button>
              </div>
            </form>
          {:else if step === 'codes'}
            <p>Each code signs you in once when your phone isn't at hand. This is the only time they are shown.</p>
            <ol aria-label="Ten backup codes" class="bg-background grid grid-cols-2 gap-1 rounded-md p-3 font-mono">
              {#each codes as c (c)}<li data-testid="backup-code">{c}</li>{/each}
            </ol>
            <div class="flex gap-2">
              <button type="button" class={outline} onclick={copyAll}>Copy all</button>
              <button type="button" class={outline} onclick={download}>Download (.txt)</button>
            </div>
            <label class="flex items-start gap-2" for="ssd-saved">
              <input id="ssd-saved" type="checkbox" bind:checked={saved} />
              <span>I have saved these codes somewhere safe, away from this device.</span>
            </label>
            <div class="flex justify-end">
              <button type="button" class={primary} disabled={!saved} aria-disabled={!saved} onclick={() => (mode === 'newcodes' ? close() : (step = 'done'))}>Finish</button>
            </div>
          {:else if step === 'done'}
            <div role="status" class="border-border bg-background rounded-md border p-3">Your second step is on. From now on every new sign-in asks for it after your password.</div>
            {#if method === 'passkey' && mode === 'setup'}<p class="text-muted-foreground text-center text-xs">A passkey has no backup codes. To get them, add an authenticator app in Settings.</p>{/if}
            <div class="flex justify-end"><button type="button" class={primary} onclick={finish}>Done</button></div>
          {/if}
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
