<script lang="ts">
  // POLY-137 R3.7: the token arrives in the fragment. A visit changes nothing; only the button's click POSTs (mail scanners open links).

  let token = '';
  let view = $state<'ask' | 'done' | 'invalid'>('ask');
  let error = $state('');
  let busy = $state(false);
  const primary = 'bg-primary text-primary-foreground focus-visible:ring-ring w-full rounded-md px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50';
  const link = 'text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded text-sm underline focus-visible:ring-2 focus-visible:outline-none';

  // Browser only; reading the fragment cancels nothing. It is removed from the address bar at once.
  if (typeof location !== 'undefined') {
    try {
      token = decodeURIComponent(location.hash.slice(1));
    } catch {
      token = '';
    }
    history.replaceState(null, '', location.pathname);
  }

  async function cancel() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const res = await fetch('/api/auth/second-step/cancel-hold', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) view = 'done';
      else if (res.status === 429) error = 'Too many tries. Wait a minute and try again.';
      else view = 'invalid';
    } catch {
      error = 'Could not cancel. Try again.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Cancel the new sign-in method · polycarpic</title></svelte:head>

<div class="mx-auto flex max-w-sm flex-col gap-3 py-12">
  <div class="font-heading mb-2 text-lg font-semibold">polycarpic</div>
  {#if view === 'done'}
    <p role="status" class="text-sm">Cancelled. The new method is removed and every device is signed out. Sign in and change your password now.</p>
    <a href="/sign-in" class={link}>Sign in</a>
  {:else if view === 'invalid'}
    <p role="alert" class="text-sm">This link no longer works. It may have been used already, or the 24 hours are over. Sign in, check Settings, Sign-in and second step, and change your password if anything there is not yours.</p>
    <a href="/sign-in" class={link}>Sign in</a>
  {:else}
    <h1 class="font-heading text-lg font-semibold">Cancel the new sign-in method</h1>
    <p class="text-sm">Someone added a sign-in method to your account. If it wasn't you, cancel it. This removes the new method and signs your account out on every device.</p>
    {#if error}<p role="alert" class="text-sm">{error}</p>{/if}
    <button type="button" disabled={busy} onclick={cancel} class={primary}>Cancel the new method</button>
  {/if}
</div>
