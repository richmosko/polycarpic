<script lang="ts">
  // POLY-150 R6 (D3 b, interim): Confirm it's you before a step-up action. Confirming isn't built yet (POLY-151), so the dialog names the action, says so
  // plainly and has one button and no input. It takes a `confirm` function so POLY-151 can fill the real form; the interim passes none. It follows
  // R3.0's mounting (portal on document.body) and R3.5's clearing: nothing is kept here.
  import { Dialog } from 'bits-ui';

  let {
    action,
    confirm,
    onclose,
  }: { action: string; confirm?: (secret: { password: string; code: string }) => Promise<boolean>; onclose: () => void } = $props();

  let password = $state('');
  let code = $state('');
  let error = $state('');

  const close = () => {
    password = '';
    code = '';
    onclose();
  };
  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!confirm) return;
    const ok = await confirm({ password, code });
    password = '';
    code = '';
    if (ok) onclose();
    else error = "That didn't confirm. Check your password and code and try again.";
  }
</script>

<svelte:window onpagehide={() => { password = ''; code = ''; }} />

<Dialog.Root open={true} onOpenChange={(o) => !o && close()}>
  <Dialog.Portal to={document.body}>
    <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
    <Dialog.Content class="bg-card text-card-foreground border-border fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-6 shadow-lg">
      <Dialog.Title class="font-heading text-lg font-semibold">Confirm it's you</Dialog.Title>
      <Dialog.Description class="text-muted-foreground mt-1 text-sm">To {action}, confirm it's you first.</Dialog.Description>
      <div class="mt-4 flex flex-col gap-3 text-sm">
        {#if confirm}
          <form onsubmit={submit} class="flex flex-col gap-3">
            <div class="flex flex-col gap-1">
              <label for="ciy-pw">Password</label>
              <input id="ciy-pw" class="border-input bg-card w-full rounded-md border px-3 py-2" type="password" autocomplete="current-password" bind:value={password} required />
            </div>
            <div class="flex flex-col gap-1">
              <label for="ciy-code">Code from your authenticator app</label>
              <input id="ciy-code" class="border-input bg-card w-full rounded-md border px-3 py-2 font-mono" inputmode="numeric" autocomplete="one-time-code" maxlength="6" bind:value={code} required />
            </div>
            {#if error}<p role="alert" class="text-destructive text-sm">{error}</p>{/if}
            <div class="flex justify-end gap-2">
              <button type="button" class="hover:bg-accent rounded-md px-3 py-1.5" onclick={close}>Close</button>
              <button type="submit" class="bg-primary text-primary-foreground rounded-md px-3 py-1.5 font-medium">Confirm</button>
            </div>
          </form>
        {:else}
          <p>Confirming it's you isn't available yet. You can make changes in the first 5 minutes after you set up your second step, or the person who runs Polycarpic can reset it.</p>
          <div class="flex justify-end">
            <button type="button" class="bg-primary text-primary-foreground focus-visible:ring-ring rounded-md px-3 py-1.5 font-medium focus-visible:ring-2 focus-visible:outline-none" onclick={close}>Close</button>
          </div>
        {/if}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
