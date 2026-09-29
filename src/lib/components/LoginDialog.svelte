<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { api } from '$lib/client/api'

  let dialog: HTMLDialogElement
  let name = $state('')
  let code = $state('')
  let error = $state('')
  let then: (() => void) | undefined

  export const open = (after?: () => void) => {
    then = after
    error = ''
    dialog.showModal()
  }

  const submit = async (e: SubmitEvent) => {
    e.preventDefault()
    try {
      await api('/login', { method: 'POST', body: { name, code } })
      dialog.close()
      code = ''
      await invalidateAll()
      then?.()
    } catch (err) {
      error = (err as Error).message
    }
  }
</script>

<dialog bind:this={dialog} class="sheet">
  <form onsubmit={submit}>
    <h2>entrar na estante</h2>
    <p class="hint">Seu nome, como o grupo te conhece, e o código que circulou no WhatsApp.</p>
    <label>nome<input bind:value={name} required maxlength="40" autocomplete="nickname" /></label>
    <label>código do grupo<input bind:value={code} required type="password" autocomplete="off" /></label>
    <p class="error" role="alert">{error}</p>
    <div class="actions">
      <button type="button" class="ghost" onclick={() => dialog.close()}>cancelar</button>
      <button class="primary">entrar</button>
    </div>
  </form>
</dialog>
