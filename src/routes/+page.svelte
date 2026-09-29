<script lang="ts">
  import { untrack } from 'svelte'
  import { afterNavigate, goto, invalidateAll } from '$app/navigation'
  import { page as current } from '$app/state'
  import { api } from '$lib/client/api'
  import { PAGE, filterParams, isFiltered, sharedLink } from '$lib/client/format'
  import type { Filter, Rec, RecPage } from '$lib/types'
  import AddDialog from '$lib/components/AddDialog.svelte'
  import Artwork from '$lib/components/Artwork.svelte'
  import Avatar from '$lib/components/Avatar.svelte'
  import LoginDialog from '$lib/components/LoginDialog.svelte'
  import Pill from '$lib/components/Pill.svelte'
  import Post from '$lib/components/Post.svelte'
  import ReviewDialog from '$lib/components/ReviewDialog.svelte'

  let { data } = $props()

  let login: LoginDialog
  let add: AddDialog
  let review = $state<ReviewDialog>()

  let recs = $derived(data.page.items)
  let next = $derived(data.page.next)
  let loadingMore = $state(false)
  let composerUrl = $state('')
  let search = $state(untrack(() => data.filter.q))
  let searchTimer: ReturnType<typeof setTimeout>

  const filter = $derived(data.filter)
  const filtered = $derived(isFiltered(filter))
  const total = $derived(data.page.total)
  const held = $derived(data.review?.held.length ?? 0)

  const setFilter = (patch: Partial<Filter>) => {
    const query = filterParams({ ...filter, ...patch })
    goto(query.size ? `?${query}` : '/', { keepFocus: true, noScroll: true, replaceState: 'q' in patch })
  }

  const toggle = <K extends keyof Filter>(key: K, value: Filter[K]) => setFilter({ [key]: filter[key] === value ? '' : value })

  const onSearch = () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => setFilter({ q: search.trim() }), 220)
  }

  const loadMore = async () => {
    if (!next || loadingMore) return
    const base = data.page
    loadingMore = true
    try {
      const query = filterParams(filter)
      query.set('limit', String(PAGE))
      query.set('cursor', next)
      const more = await api<RecPage>(`/recs?${query}`)
      if (base !== data.page) return
      recs = [...recs, ...more.items]
      next = more.next
    } finally {
      loadingMore = false
    }
  }

  const watchMore = (node: HTMLElement) => {
    if (!next) return
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), { rootMargin: '800px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }

  const openAdd = (url = '') => (data.me ? add.open(url) : login.open(() => add.open(url)))

  const logout = async () => {
    await api('/logout', { method: 'POST' })
    await invalidateAll()
  }

  const remove = async (r: Rec) => {
    const whose = data.me?.id === r.user_id ? '' : ` (de ${r.user_name})`
    if (!confirm(`Tirar "${r.title}"${whose} da estante?`)) return
    await api(`/recs/${r.id}`, { method: 'DELETE' })
    await invalidateAll()
  }

  const onPaste = (e: ClipboardEvent) => {
    const url = e.clipboardData?.getData('text')?.trim()
    if (url && /^https?:\/\//.test(url)) {
      e.preventDefault()
      composerUrl = url
      openAdd(url)
    }
  }

  afterNavigate(({ type }) => {
    const shared = type === 'enter' ? sharedLink(current.url.searchParams) : ''
    if (!shared) return
    const query = filterParams(filter)
    goto(query.size ? `?${query}` : '/', { replaceState: true, keepFocus: true, noScroll: true })
    composerUrl = shared
    openAdd(shared)
  })
</script>

<div class="layout">
  <aside class="side side-left">
    <header class="brand">
      <h1>estante</h1>
      <p>estudos de psicoacústica</p>
      <div class="session">
        {#if data.me}
          <span>você é <strong>{data.me.name}</strong></span>
          <button type="button" class="link" onclick={logout}>sair</button>
        {:else}
          <button type="button" class="link" onclick={() => login.open()}>entrar</button>
        {/if}
      </div>
    </header>
    {#if data.users.length}
      <section class="block">
        <h2 class="label">quem trouxe</h2>
        <nav class="people" aria-label="De quem">
          {#each data.users as u (u.id)}
            <button type="button" class="person" aria-pressed={String(u.id) === filter.user} onclick={() => toggle('user', String(u.id))}>
              <Avatar name={u.name} />{u.name}<span class="n">{u.recs}</span>
            </button>
          {/each}
        </nav>
      </section>
    {/if}
    {#if data.review}
      <section class="block">
        <h2 class="label">moderação</h2>
        <button type="button" class="person" id="reviewOpen" onclick={() => review?.open()}>
          revisar a estante<span class="n">{held || ''}</span>
        </button>
      </section>
    {/if}
    {#if data.tags.length}
      <section class="block">
        <h2 class="label">temas</h2>
        <nav class="pills" id="tags" aria-label="Temas">
          {#each data.tags.slice(0, 20) as { tag, count } (tag)}
            <Pill label={tag} pressed={tag === filter.tag} n={count} onclick={() => toggle('tag', tag)} />
          {/each}
        </nav>
      </section>
    {/if}
  </aside>

  <main class="feed">
    <form class="composer" onsubmit={(e) => (e.preventDefault(), openAdd(composerUrl.trim()))}>
      <label class="visually-hidden" for="composerUrl">Link do disco ou da faixa</label>
      <input id="composerUrl" bind:value={composerUrl} onpaste={onPaste} type="url" inputmode="url" autocomplete="off" placeholder="cole um link do Spotify, YouTube ou Bandcamp…" />
      <button class="primary">recomendar</button>
    </form>
    <p class="count" aria-live="polite">{data.me && filtered ? `${total} ${total === 1 ? 'recomendação' : 'recomendações'} neste recorte` : ''}</p>
    <section class="posts" aria-label="Recomendações">
      {#if !data.me}
        <div class="empty">
          <strong>A estante é só do grupo.</strong>
          Entre com seu nome e o código que circulou no WhatsApp.
          <button type="button" class="primary" onclick={() => login.open()}>entrar</button>
        </div>
      {:else}
        {#each recs as rec (rec.id)}
          <Post {rec} me={data.me} tag={filter.tag} onTag={(t) => toggle('tag', t)} onRemove={remove} />
        {:else}
          <div class="empty">
            <strong>{filtered ? 'Nada neste recorte.' : 'A estante está vazia.'}</strong>
            {filtered ? 'Tente outro filtro, ou limpe a busca.' : 'Cole acima o link do disco que você não para de ouvir.'}
          </div>
        {/each}
      {/if}
    </section>
    <p class="more" aria-live="polite" {@attach watchMore}>{loadingMore ? 'carregando mais…' : ''}</p>
  </main>

  {#if data.me}
    <aside class="side side-right">
      <section class="block">
        <h2 class="label">discos ou faixas</h2>
        <div class="segmented" role="radiogroup" aria-label="Tipo">
          {#each [['', 'tudo'], ['album', 'discos'], ['track', 'faixas']] as const as [kind, label] (kind)}
            <button type="button" role="radio" aria-checked={filter.kind === kind} onclick={() => setFilter({ kind })}>{label}</button>
          {/each}
        </div>
      </section>
      <section class="block">
        <label class="label" for="search">buscar</label>
        <input id="search" type="search" bind:value={search} oninput={onSearch} placeholder="título, artista, comentário" autocomplete="off" />
      </section>
      {#if recs.length && !filtered}
        <section class="block mini-block">
          <h2 class="label">na estante</h2>
          <div class="mini">
            {#each recs.slice(0, 9) as r (r.id)}
              <a href="#rec-{r.id}" title="{r.title} · {r.artist}"><Artwork rec={r} /></a>
            {/each}
          </div>
        </section>
      {/if}
    </aside>
  {/if}
</div>

<LoginDialog bind:this={login} />
<AddDialog bind:this={add} tags={data.tags} onAdded={() => (composerUrl = '')} onUnauthorized={() => login.open(() => add.reopen())} />
{#if data.review}
  <ReviewDialog bind:this={review} review={data.review} />
{/if}
