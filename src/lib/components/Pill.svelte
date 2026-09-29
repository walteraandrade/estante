<script lang="ts">
  let { label, pressed, onclick, n }: { label: string; pressed: boolean; onclick: () => void; n?: number } = $props()
</script>

<button type="button" class="pill" aria-pressed={pressed} {onclick}>
  {label}{#if n != null}<span class="n">{n}</span>{/if}
</button>
