<script lang="ts">
  import { onMount } from 'svelte';

  // Placeholder (POLY-87): the design is POLY-88's. The invitation token is read once from the link, then the address bar
  // is cleaned so it is not left in history, a screenshot or a copied URL (S9).
  let token = '';
  let name = $state('');
  let email = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  onMount(() => {
    const url = new URL(location.href);
    token = url.searchParams.get('invitation') ?? '';
    if (url.searchParams.has('invitation')) {
      url.searchParams.delete('invitation');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      const res = await fetch('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password, invitationToken: token }),
      });
      if (res.status === 429) error = 'Too many attempts. Wait a minute and try again.';
      else if (!res.ok) error = 'Could not sign up. Check that the invitation link is current.';
      else location.assign('/');
    } catch {
      error = 'Could not sign up.';
    } finally {
      busy = false;
    }
  }

  async function social(provider: 'google' | 'github') {
    const res = await fetch('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, callbackURL: '/' }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (body?.url) location.assign(body.url);
    else error = 'Could not start that sign-in.';
  }
</script>

<form method="post" action="/sign-up" onsubmit={submit} class="mx-auto flex max-w-sm flex-col gap-3 py-12">
  <h1 class="text-xl font-semibold">Sign up</h1>
  <label class="flex flex-col gap-1 text-sm">Name <input name="name" type="text" bind:value={name} required autocomplete="name" class="rounded border px-2 py-1" /></label>
  <label class="flex flex-col gap-1 text-sm">Email <input name="email" type="email" bind:value={email} required autocomplete="username" class="rounded border px-2 py-1" /></label>
  <label class="flex flex-col gap-1 text-sm">Password <input name="password" type="password" bind:value={password} required minlength="8" autocomplete="new-password" class="rounded border px-2 py-1" /></label>
  {#if error}<p role="alert" class="text-sm">{error}</p>{/if}
  <button type="submit" class="rounded border px-3 py-1">Sign up</button>
  <button type="button" class="rounded border px-3 py-1" onclick={() => social('google')}>Continue with Google</button>
  <button type="button" class="rounded border px-3 py-1" onclick={() => social('github')}>Continue with GitHub</button>
</form>
