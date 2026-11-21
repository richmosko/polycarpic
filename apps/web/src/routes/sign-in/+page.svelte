<script lang="ts">
  import { safeNext } from '../../lib/safe-next';
  // Placeholder (POLY-86): an email + password form. The design is POLY-88's.
  let email = $state('');
  let password = $state('');
  let error = $state('');

  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      const res = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) error = 'Too many attempts. Wait a minute and try again.';
      else if (!res.ok) error = 'Could not sign in.';
      else {
        const next = safeNext(new URLSearchParams(location.search).get('next'));
        // The held page is shown only from this response (R7): a code hold, or a passkey-only user (a display hint, never a fact the page trusts).
        if (body.twoFactorRedirect) location.assign(`/sign-in/second-step?${new URLSearchParams({ next })}`);
        else if (body.secondStepRequired === 'passkey') location.assign(`/sign-in/second-step?${new URLSearchParams({ with: 'passkey', next })}`);
        else location.assign(next);
      }
    } catch {
      error = 'Could not sign in.';
    } finally {
      busy = false;
    }
  }
</script>

<form method="post" action="/sign-in" onsubmit={submit} class="mx-auto flex max-w-sm flex-col gap-3 py-12">
  <h1 class="text-xl font-semibold">Sign in</h1>
  <label class="flex flex-col gap-1 text-sm">Email <input name="email" type="email" bind:value={email} required autocomplete="username" class="rounded border px-2 py-1" /></label>
  <label class="flex flex-col gap-1 text-sm">Password <input name="password" type="password" bind:value={password} required autocomplete="current-password" class="rounded border px-2 py-1" /></label>
  {#if error}<p role="alert" class="text-sm">{error}</p>{/if}
  <button type="submit" class="rounded border px-3 py-1">Sign in</button>
  <a href="/sign-in/forgot" class="text-muted-foreground text-sm underline">Forgot your password?</a>
</form>
