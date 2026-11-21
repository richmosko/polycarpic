<script lang="ts">
  // POLY-137 R2.5: the token arrives in the fragment (RC5). It is read here, in the browser, and the fragment is removed at once.

  let token = '';
  let pw = $state('');
  let again = $state('');
  let view = $state<'form' | 'done' | 'invalid'>('form');
  let error = $state('');
  let busy = $state(false);
  const field = 'border-input bg-card text-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none';
  const primary = 'bg-primary text-primary-foreground focus-visible:ring-ring w-full rounded-md px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50';
  const link = 'text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded text-sm underline focus-visible:ring-2 focus-visible:outline-none';

  // Browser only; the fragment never leaves the page and is removed from the address bar at once.
  if (typeof location !== 'undefined') {
    try {
      token = decodeURIComponent(location.hash.slice(1));
    } catch {
      token = '';
    }
    history.replaceState(null, '', location.pathname);
    if (!token) view = 'invalid';
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    if (pw !== again) {
      error = 'The two passwords do not match.';
      return;
    }
    busy = true;
    error = '';
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: pw }),
      });
      const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      if (res.ok) view = 'done';
      else if (body.code === 'INVALID_TOKEN') view = 'invalid';
      else if (res.status === 429) error = 'Too many tries. Wait a minute and try again.';
      else error = body.message ?? 'Could not change the password.';
    } catch {
      error = 'Could not change the password.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="mx-auto flex max-w-sm flex-col gap-3 py-12">
  <div class="font-heading mb-2 text-lg font-semibold">polycarpic</div>
  {#if view === 'done'}
    <p role="status" class="text-sm">Your password is changed and every device is signed out.</p>
    <a href="/sign-in" class={link}>Sign in</a>
  {:else if view === 'invalid'}
    <p role="alert" class="text-sm">This link no longer works. Ask for a new one.</p>
    <a href="/sign-in/forgot" class={link}>Ask for a new link</a>
  {:else}
    <form class="flex flex-col gap-3" onsubmit={submit}>
      <h1 class="font-heading text-lg font-semibold">Choose a new password</h1>
      <label class="flex flex-col gap-1 text-sm">New password <input name="password" type="password" bind:value={pw} required autocomplete="new-password" class={field} /></label>
      <label class="flex flex-col gap-1 text-sm">New password again <input name="again" type="password" bind:value={again} required autocomplete="new-password" class={field} /></label>
      {#if error}<p role="alert" class="text-sm">{error}</p>{/if}
      <button type="submit" disabled={busy} class={primary}>Change password</button>
    </form>
  {/if}
</div>
