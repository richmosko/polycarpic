<script lang="ts">
  // POLY-150 R7: the held sign-in, a bare page with no server code. Web learns to show it only from the sign-in response; the hold itself is a cookie
  // the sign-in service keeps at /api/auth. The page is the same for every caller: no email, no list of factors, no "passkey available". Every
  // write is a browser fetch to /api/auth/*. Wrong codes read one way and show no count of tries; a lock shows no time (D1, D6 a).
  import { safeNext } from '../../../lib/safe-next';
  import { api } from '../../../lib/second-step/auth-api';
  import { getCredential, type RequestOptionsJSON } from '../../../lib/second-step/webauthn';

  type View = 'code' | 'backup' | 'passkey' | 'locked' | 'expired';
  let view = $state<View>('code');
  let code = $state('');
  let backup = $state('');
  let error = $state('');
  let busy = $state(false);
  // D6 (b): a rough band the service sends only on the lock refusal of a valid hold; absent, the page says "later".
  let band = $state('');

  const go = () => location.assign(safeNext(new URLSearchParams(location.search).get('next')));

  /** One verify call; the answer decides the next view. 401 with no valid hold cookie: expired; 429 with the lock code: locked; anything else wrong: one message. */
  async function verify(path: '/two-factor/verify-totp' | '/two-factor/verify-backup-code', value: string) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const r = await api('POST', path, { code: value });
      if (r.ok) return go();
      if (r.status === 401 && r.body.code === 'INVALID_TWO_FACTOR_COOKIE') view = 'expired';
      else if (r.status === 429 && r.body.code === 'ACCOUNT_TEMPORARILY_LOCKED') {
        band = typeof r.body.pausedFor === 'string' ? r.body.pausedFor : '';
        view = 'locked';
      }
      else if (r.status === 429) error = 'Too many attempts. Wait a minute and try again.';
      else error = "That code didn't work. Check it and try again.";
    } finally {
      busy = false;
    }
  }

  async function usePasskey() {
    if (busy) return;
    busy = true;
    error = '';
    const back = view === 'locked' ? 'locked' : 'code';
    view = 'passkey';
    try {
      const o = await api<RequestOptionsJSON>('GET', '/passkey/generate-authenticate-options');
      if (o.status === 401) {
        view = 'expired';
        return;
      }
      const response = o.ok ? await getCredential(o.body) : null;
      const v = response ? await api('POST', '/passkey/verify-authentication', { response }) : null;
      if (v?.ok) return go();
      view = back;
      error = "That didn't work. Check it and try again.";
    } finally {
      busy = false;
    }
  }

  const when = $derived(band === 'under_an_hour' ? 'in under an hour' : band === 'a_few_hours' ? 'in a few hours' : band === 'up_to_a_day' ? 'within a day' : 'later');
  const field = 'border-input bg-card text-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none';
  const primary = 'bg-primary text-primary-foreground focus-visible:ring-ring w-full rounded-md px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50';
  const link = 'text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded text-left text-sm underline focus-visible:ring-2 focus-visible:outline-none';
  const reset = 'text-muted-foreground text-xs';
</script>

<div class="mx-auto flex max-w-sm flex-col gap-3 py-12">
  <div class="font-heading mb-2 text-lg font-semibold">polycarpic</div>

  {#if view === 'code'}
    <form
      class="flex flex-col gap-3"
      onsubmit={(e) => {
        e.preventDefault();
        void verify('/two-factor/verify-totp', code);
      }}
    >
      <h1 class="font-heading text-xl font-semibold">Second step</h1>
      <p class="text-muted-foreground text-sm">Enter the code from your authenticator app.</p>
      <div class="flex flex-col gap-1">
        <label for="si-code" class="text-sm">6-digit code</label>
        <input id="si-code" class="{field} font-mono tracking-widest" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" bind:value={code} aria-invalid={error ? 'true' : undefined} required />
        {#if error}<p role="alert" class="text-destructive text-xs">{error}</p>{/if}
      </div>
      <button type="submit" class={primary} disabled={busy}>Continue</button>
      <button type="button" class={link} onclick={usePasskey}>Use a passkey instead</button>
      <button type="button" class={link} onclick={() => { view = 'backup'; error = ''; }}>Use a backup code</button>
      <p class={reset}>Lost every method? The person who runs this instance can reset your second step.</p>
    </form>
  {:else if view === 'backup'}
    <form
      class="flex flex-col gap-3"
      onsubmit={(e) => {
        e.preventDefault();
        void verify('/two-factor/verify-backup-code', backup);
      }}
    >
      <h1 class="font-heading text-xl font-semibold">Use a backup code</h1>
      <p class="text-muted-foreground text-sm">Enter one of the ten codes you saved when you set up your second step. Each works once.</p>
      <div class="flex flex-col gap-1">
        <label for="si-backup" class="text-sm">Backup code</label>
        <input id="si-backup" class="{field} font-mono" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="xxxxx-xxxxx" bind:value={backup} aria-invalid={error ? 'true' : undefined} required />
        {#if error}<p role="alert" class="text-destructive text-xs">{error}</p>{/if}
      </div>
      <button type="submit" class={primary} disabled={busy}>Continue</button>
      <button type="button" class={link} onclick={() => { view = 'code'; error = ''; }}>Use your authenticator app</button>
      <p class={reset}>Once you're in, make new codes in Settings if you are running low.</p>
    </form>
  {:else if view === 'passkey'}
    <h1 class="font-heading text-xl font-semibold">Second step</h1>
    <div role="status" class="border-border bg-card rounded-md border p-3 text-sm">Follow your browser's prompt to use your passkey.</div>
    <button type="button" class="border-border bg-card hover:bg-accent rounded-md border px-3 py-2 text-sm" onclick={() => { view = 'code'; busy = false; }}>Use a code instead</button>
    <p class={reset}>Nothing happened? This device may not hold your passkey. Use your phone's code, or a security key.</p>
  {:else if view === 'locked'}
    <h1 class="font-heading text-xl font-semibold">Codes are paused</h1>
    <p class="text-muted-foreground text-sm">Too many wrong codes were entered.</p>
    <div role="status" class="border-border bg-card rounded-md border p-3 text-sm"><strong>Codes are paused for this account.</strong> Use a passkey, or try again {when}.</div>
    {#if error}<p role="alert" class="text-destructive text-xs">{error}</p>{/if}
    <button type="button" class={primary} onclick={usePasskey}>Use a passkey</button>
    <p class={reset}>If this wasn't you, someone may know your password. Once you're in, change it in Settings.</p>
    <p class={reset}>Lost every method? The person who runs this instance can reset your second step.</p>
    <a class={link} href="/sign-in">Back to sign in</a>
  {:else}
    <h1 class="font-heading text-xl font-semibold">Sign in again</h1>
    <p class="text-muted-foreground text-sm">For your safety, this sign-in stopped after 10 minutes or 5 wrong codes. Nothing was changed.</p>
    <a class="bg-primary text-primary-foreground rounded-md px-3 py-2 text-center text-sm font-medium" href="/sign-in">Start again</a>
    <p class={reset}>Lost every method? The person who runs this instance can reset your second step.</p>
  {/if}
</div>
