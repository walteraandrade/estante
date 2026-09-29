<script lang="ts">
  import { coverOf } from '$lib/client/format'
  import type { Rec } from '$lib/types'

  let { rec }: { rec: Pick<Rec, 'cover_url' | 'artist' | 'title'> } = $props()
  const colors = $derived(coverOf(`${rec.artist}${rec.title}`))
</script>

{#if rec.cover_url}
  <img src={rec.cover_url} alt="" loading="lazy" referrerpolicy="no-referrer" />
{:else}
  <span class="art" style="position:absolute;inset:0" style:background={colors[0]}>
    <span class="sun" style:background={colors[1]}></span>
  </span>
{/if}
