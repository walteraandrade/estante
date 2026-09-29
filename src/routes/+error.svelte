<script lang="ts">
  import { page } from '$app/state'
</script>

<main class="layout">
  <div class="empty">
    <strong>Algo deu errado.</strong>
    {page.error?.message}
    <a href="/">voltar à estante</a>
  </div>
</main>
