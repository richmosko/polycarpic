<script lang="ts">
  // Placeholder (POLY-86): an email + password form. The design is POLY-88's.
  let email = $state('');
  let password = $state('');
  let error = $state('');

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const res = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) error = 'Could not sign in.';
    else if (body.twoFactorRedirect || body.secondStepRequired) location.assign('/sign-in/second-step');
    else {
      const next = new URLSearchParams(location.search).get('next') ?? '/';
      location.assign(next.startsWith('/') && next[1] !== '/' && next[1] !== '\\' ? next : '/');
    }
  }
</script>

<form onsubmit={submit} class="mx-auto flex max-w-sm flex-col gap-3 py-12">
  <h1 class="text-xl font-semibold">Sign in</h1>
  <label class="flex flex-col gap-1 text-sm">Email <input type="email" bind:value={email} required autocomplete="username" class="rounded border px-2 py-1" /></label>
  <label class="flex flex-col gap-1 text-sm">Password <input type="password" bind:value={password} required autocomplete="current-password" class="rounded border px-2 py-1" /></label>
  {#if error}<p role="alert" class="text-sm">{error}</p>{/if}
  <button type="submit" class="rounded border px-3 py-1">Sign in</button>
</form>
