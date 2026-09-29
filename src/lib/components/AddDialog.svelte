<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { api, type ApiError } from '$lib/client/api'
  import { SEED_TAGS, readTags } from '$lib/client/format'
  import type { Kind, TagCount } from '$lib/types'

  type Meta = { kind: Kind; title: string; artist: string; year: number | null; cover_url: string | null }

  let { tags, onAdded, onUnauthorized }: { tags: TagCount[]; onAdded: () => void; onUnauthorized: () => void } = $props()

  const blank = () => ({ url: '', kind: 'album' as Kind, title: '', artist: '', year: '', tags: '', description: '', cover_url: '' })

  let dialog: HTMLDialogElement
  let description: HTMLTextAreaElement
  let form = $state(blank())
  let status = $state<string | null>(null)
  let error = $state('')
  let saving = $state(false)

  const chosen = $derived(readTags(form.tags))
  const pool = $derived([...new Set([...tags.map((t) => t.tag), ...SEED_TAGS])].slice(0, 16))

  const toggle = (t: string) => {
    form.tags = (chosen.includes(t) ? chosen.filter((c) => c !== t) : [...chosen, t]).join(', ')
  }

  export const open = (url = '') => {
    form = { ...blank(), url }
    status = null
    error = ''
    dialog.showModal()
    if (url) fillFromLink()
  }

  export const reopen = () => dialog.showModal()

  const fillFromLink = async () => {
    const url = form.url.trim()
    if (!url) return
    status = 'lendo o link…'
    try {
      const m = await api<Meta>(`/meta?url=${encodeURIComponent(url)}`)
      form.kind = m.kind
      form.title ||= m.title
      form.artist ||= m.artist
      form.year ||= m.year ? String(m.year) : ''
      form.cover_url = m.cover_url ?? ''
      status = `${m.kind === 'album' ? 'disco' : 'faixa'} · ${m.artist}`
      description.focus()
    } catch (e) {
      status = (e as ApiError).status === 401 ? 'entre para ler links' : 'não consegui ler esse link; preencha à mão'
    }
  }

  const submit = async (e: SubmitEvent) => {
    e.preventDefault()
    saving = true
    try {
      await api('/recs', {
        method: 'POST',
        body: {
          kind: form.kind,
          title: form.title,
          artist: form.artist,
          year: form.year || null,
          url: form.url || null,
          cover_url: form.cover_url || null,
          tags: chosen,
          description: form.description,
        },
      })
      dialog.close()
      onAdded()
      await invalidateAll()
    } catch (err) {
      error = (err as Error).message
      if ((err as ApiError).status === 401) {
        dialog.close()
        onUnauthorized()
      }
    } finally {
      saving = false
    }
  }
</script>

<dialog bind:this={dialog} class="sheet wide">
  <form onsubmit={submit}>
    <h2>pôr na estante</h2>
    <label>link <span class="hint">Spotify, YouTube ou Bandcamp. O resto se preenche.</span>
      <input bind:value={form.url} onchange={fillFromLink} type="url" inputmode="url" placeholder="https://open.spotify.com/…" />
    </label>
    {#if status}
      <div class="preview">
        {#if form.cover_url}<img alt="" src={form.cover_url} />{/if}
        <span>{status}</span>
      </div>
    {/if}
    <fieldset class="segmented" aria-label="Tipo">
      <label><input type="radio" bind:group={form.kind} value="album" /><span>disco</span></label>
      <label><input type="radio" bind:group={form.kind} value="track" /><span>faixa</span></label>
    </fieldset>
    <div class="grid-2">
      <label>título<input bind:value={form.title} required maxlength="200" /></label>
      <label>artista<input bind:value={form.artist} required maxlength="200" /></label>
    </div>
    <div class="grid-2">
      <label>ano<input bind:value={form.year} inputmode="numeric" pattern={'\\d{4}'} maxlength="4" /></label>
      <label>temas<input bind:value={form.tags} list="tagSuggestions" maxlength="200" placeholder="jazz, ambient" /></label>
    </div>
    <div class="pills small">
      {#each pool as t (t)}
        <button type="button" class="pill" aria-pressed={chosen.includes(t)} onclick={() => toggle(t)}>{t}</button>
      {/each}
    </div>
    <datalist id="tagSuggestions">
      {#each pool as t (t)}<option value={t}></option>{/each}
    </datalist>
    <label>por que ouvir<textarea bind:this={description} bind:value={form.description} rows="5" maxlength="4000" placeholder="o que te pegou, em que faixa prestar atenção, com que fone ouvir…"></textarea></label>
    <p class="error" role="alert">{error}</p>
    <div class="actions">
      <button type="button" class="ghost" onclick={() => dialog.close()}>cancelar</button>
      <button class="primary" disabled={saving}>pôr na estante</button>
    </div>
  </form>
</dialog>
