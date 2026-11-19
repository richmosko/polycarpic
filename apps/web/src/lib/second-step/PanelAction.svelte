<script lang="ts">
  // POLY-150 R5: the two Settings actions that need one small input while the step-up is fresh: Remove the app (asks the password) and Add a passkey
  // (asks a name). Browser fetches to /api/auth/*, same mounting and clearing rules as the set-up dialog (R3.0, R3.5).
  import { Dialog } from 'bits-ui';
  import { invalidateAll } from '$app/navigation';
  import { api } from './auth-api';
  import { createCredential, type CreationOptionsJSON } from './webauthn';

  let { kind, onclose }: { kind: 'removeApp' | 'addPasskey'; onclose: () => void } = $props();

  let password = $state('');
  let name = $state('');
  let busy = $state(false);
  let error = $state('');

  const close = () => {
    password = '';
    name = '';
    onclose();
  };

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      if (kind === 'removeApp') {
        const r = await api('POST', '/two-factor/disable', { password });
        password = '';
        if (!r.ok) {
          error = r.body.code === 'invalid_password' ? "That password isn't right." : 'That did not work. The database may refuse removing your last method.';
          return;
        }
      } else {
        const o = await api<CreationOptionsJSON>('GET', '/passkey/generate-register-options');
        const response = o.ok ? await createCredential(o.body) : null;
        const v = response ? await api('POST', '/passkey/verify-registration', { response, name: name.trim() || 'Passkey' }) : null; // never createSession (S19)
        if (!v?.ok) {
          error = "The passkey wasn't created. The prompt may have been closed, or this device can't make one.";
          return;
        }
      }
      await invalidateAll();
      close();
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onpagehide={() => { password = ''; name = ''; }} />

<Dialog.Root open={true} onOpenChange={(o) => !o && close()}>
  <Dialog.Portal to={document.body}>
    <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
    <Dialog.Content class="bg-card text-card-foreground border-border fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-6 shadow-lg">
      <Dialog.Title class="font-heading text-lg font-semibold">{kind === 'removeApp' ? 'Remove the authenticator app' : 'Add a passkey'}</Dialog.Title>
      <Dialog.Description class="text-muted-foreground mt-1 text-sm">{kind === 'removeApp' ? 'Its backup codes stop working too.' : 'Your browser asks for Touch ID, Face ID or your security key.'}</Dialog.Description>
      <form onsubmit={submit} class="mt-4 flex flex-col gap-3 text-sm">
        {#if kind === 'removeApp'}
          <div class="flex flex-col gap-1">
            <label for="pa-pw">Password</label>
            <input id="pa-pw" class="border-input bg-card w-full rounded-md border px-3 py-2" type="password" autocomplete="current-password" bind:value={password} required />
          </div>
        {:else}
          <div class="flex flex-col gap-1">
            <label for="pa-name">Name this passkey</label>
            <input id="pa-name" class="border-input bg-card w-full rounded-md border px-3 py-2" type="text" bind:value={name} />
          </div>
        {/if}
        {#if error}<p role="alert" class="text-destructive text-sm">{error}</p>{/if}
        <div class="flex justify-end gap-2">
          <button type="button" class="hover:bg-accent rounded-md px-3 py-1.5" onclick={close}>Cancel</button>
          <button type="submit" disabled={busy} class="bg-primary text-primary-foreground rounded-md px-3 py-1.5 font-medium disabled:opacity-50">{kind === 'removeApp' ? 'Remove' : 'Create passkey'}</button>
        </div>
      </form>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
