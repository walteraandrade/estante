<script lang="ts">
  import { toneOf } from '$lib/client/format'

  let { name }: { name: string } = $props()
</script>

<span class="avatar" style:background={toneOf(name)} aria-hidden="true">{name.trim()[0]?.toUpperCase() ?? '?'}</span>
