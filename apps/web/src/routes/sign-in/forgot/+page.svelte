<script lang="ts">
  // POLY-137 R2.5: one email field; the answer is the same for a known and an unknown address.

  let email = $state('');
  let sent = $state(false);
  let error = $state('');
  let busy = $state(false);
  const field = 'border-input bg-card text-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none';
  const primary = 'bg-primary text-primary-foreground focus-visible:ring-ring w-full rounded-md px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50';
  const link = 'text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded text-sm underline focus-visible:ring-2 focus-visible:outline-none';

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      const res = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) error = 'Too many tries. Wait a minute and try again.';
      else if (res.ok) sent = true;
      else error = 'Could not send the link. Try again.';
    } catch {
      error = 'Could not send the link. Try again.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="mx-auto flex max-w-sm flex-col gap-3 py-12">
  <div class="font-heading mb-2 text-lg font-semibold">polycarpic</div>
  {#if sent}
    <p role="status" class="text-sm">If that address has an account, we have sent it a link. The link works for 15 minutes.</p>
    <a href="/sign-in" class={link}>Back to sign in</a>
  {:else}
    <form class="flex flex-col gap-3" onsubmit={submit}>
      <h1 class="font-heading text-lg font-semibold">Reset your password</h1>
      <label class="flex flex-col gap-1 text-sm">Email <input name="email" type="email" bind:value={email} required autocomplete="username" class={field} /></label>
      {#if error}<p role="alert" class="text-sm">{error}</p>{/if}
      <button type="submit" disabled={busy} class={primary}>Send the link</button>
    </form>
    <a href="/sign-in" class={link}>Back to sign in</a>
  {/if}
</div>
