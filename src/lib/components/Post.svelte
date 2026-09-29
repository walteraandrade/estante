<script lang="ts">
  import { relative, safeHref } from '$lib/client/format'
  import type { Me, Rec } from '$lib/types'
  import Artwork from './Artwork.svelte'
  import Avatar from './Avatar.svelte'
  import Pill from './Pill.svelte'

  let { rec, me, tag, onTag, onRemove }: { rec: Rec; me: Me; tag: string; onTag: (tag: string) => void; onRemove: (rec: Rec) => void } = $props()

  const href = $derived(safeHref(rec.url))
  const long = $derived(rec.description.length > 320)
  let expanded = $state(false)
</script>

<article class="post" id="rec-{rec.id}">
  <div class="post-head">
    <Avatar name={rec.user_name} />
    <span><strong>{rec.user_name}</strong> pôs {rec.kind === 'album' ? 'um disco' : 'uma faixa'} na estante · {relative(rec.created_at)}</span>
  </div>
  <div class="post-body">
    {#if href}
      <a class="cover" {href} target="_blank" rel="noopener noreferrer" aria-label="ouvir {rec.title}"><Artwork {rec} /></a>
    {:else}
      <div class="cover"><Artwork {rec} /></div>
    {/if}
    <div class="post-text">
      <h3>{rec.title}</h3>
      <p class="artist">{rec.artist}{rec.year ? ` · ${rec.year}` : ''}</p>
      {#if rec.status === 'held'}
        <p class="held">Só você vê esta por enquanto: ela espera alguém da moderação dar uma olhada.</p>
      {/if}
      {#if rec.description}
        <p class="note" class:clamped={long && !expanded}>{rec.description}</p>
        {#if long}
          <button type="button" class="link" onclick={() => (expanded = !expanded)}>{expanded ? 'recolher' : 'ler tudo'}</button>
        {/if}
      {/if}
      <div class="post-actions">
        {#if href}<a class="listen" {href} target="_blank" rel="noopener noreferrer">ouvir</a>{/if}
        {#each rec.tags as t (t)}
          <Pill label="#{t}" pressed={t === tag} onclick={() => onTag(t)} />
        {/each}
        {#if me.id === rec.user_id || me.admin}
          <button type="button" class="link remove" onclick={() => onRemove(rec)}>tirar da estante</button>
        {/if}
      </div>
    </div>
  </div>
</article>
