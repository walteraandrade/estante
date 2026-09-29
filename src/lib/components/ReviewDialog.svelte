<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { api } from '$lib/client/api'
  import { relative } from '$lib/client/format'
  import type { Rec, RemovedRec } from '$lib/types'
  import Artwork from './Artwork.svelte'

  let { review }: { review: { held: Rec[]; removed: RemovedRec[] } } = $props()

  let dialog: HTMLDialogElement
  let busy = $state<number | null>(null)

  export const open = () => dialog.showModal()

  const act = async (id: number, run: () => Promise<unknown>) => {
    busy = id
    await run().catch((err) => alert((err as Error).message))
    await invalidateAll()
    busy = null
  }

  const restore = (r: Rec) => act(r.id, () => api(`/recs/${r.id}/restore`, { method: 'POST' }))
  const takeDown = (r: Rec) => act(r.id, () => api(`/recs/${r.id}`, { method: 'DELETE' }))
</script>

{#snippet item(r: Rec, note: string)}
  <span class="review-cover"><Artwork rec={r} /></span>
  <div class="review-text">
    <strong>{r.title}</strong>
    <span>{r.artist} · de {r.user_name}</span>
    <span class="hint">{note}</span>
  </div>
{/snippet}

<dialog bind:this={dialog} class="sheet wide">
  <form method="dialog">
    <h2>moderação</h2>
    <p class="hint">Nada some de vez: o que foi tirado da estante fica aqui e pode voltar.</p>
    <h3 class="label">esperando aprovação</h3>
    <div class="review-list">
      {#each review.held as r (r.id)}
        <div class="review-item">
          {@render item(r, `segurada pelo filtro · ${relative(r.created_at)}`)}
          <div class="review-actions">
            <button type="button" class="primary" disabled={busy === r.id} onclick={() => restore(r)}>aprovar</button>
            <button type="button" class="ghost" disabled={busy === r.id} onclick={() => takeDown(r)}>tirar</button>
          </div>
        </div>
      {:else}
        <p class="hint">Nada esperando.</p>
      {/each}
    </div>
    <h3 class="label">tiradas da estante</h3>
    <div class="review-list">
      {#each review.removed as r (r.id)}
        <div class="review-item">
          {@render item(r, `tirada por ${r.removed_by_name ?? 'alguém'} · ${relative(r.removed_at)}`)}
          <div class="review-actions">
            <button type="button" class="ghost" disabled={busy === r.id} onclick={() => restore(r)}>devolver</button>
          </div>
        </div>
      {:else}
        <p class="hint">Nada foi tirado.</p>
      {/each}
    </div>
    <div class="actions">
      <button class="ghost">fechar</button>
    </div>
  </form>
</dialog>
