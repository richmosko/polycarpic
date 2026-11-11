<script lang="ts">
  let { data, form } = $props();
</script>

<h1 class="mb-4 text-xl font-semibold">Sessions</h1>
{#if form?.error}<p role="alert" class="mb-2 text-sm">{form.error}</p>{/if}
<table class="w-full text-sm">
  <thead><tr><th class="text-left">Device</th><th class="text-left">Started</th><th class="text-left">Last seen</th><th></th></tr></thead>
  <tbody>
    {#each data.sessions as s (s.id)}
      <tr>
        <td>{s.device ?? 'Unknown'}{s.current ? ' (this device)' : ''}</td>
        <td>{s.createdAt}</td>
        <td>{s.lastSeen}</td>
        <td>
          <form method="POST" action="?/revoke">
            <input type="hidden" name="id" value={s.id} />
            <button type="submit">{s.current ? 'Sign out' : 'Revoke'}</button>
          </form>
        </td>
      </tr>
    {/each}
  </tbody>
</table>
