# estante

Shared shelf of album and track recommendations for the *estudos de psicoacústica* group.
SvelteKit app with the Hono API mounted at `/api/*` (`src/routes/api/[...path]/+server.ts`), libSQL (SQLite locally, Turso in production), and a Svelte 5 UI in `src/routes/+page.svelte` and `src/lib/components/`. Filters live in the URL (`?kind=&user=&tag=&q=`), so a filtered view can be shared.

## Local

```bash
pnpm install
pnpm dev          # http://localhost:3300, group code "psicoacustica", data in ./estante.db
pnpm test         # in-memory database, no network
pnpm typecheck    # svelte-check
pnpm build        # Vercel output in .vercel/output
```

## Env

| var | local default | production |
|---|---|---|
| `TURSO_DATABASE_URL` | `file:estante.db` | `libsql://<db>-<org>.turso.io` |
| `TURSO_AUTH_TOKEN` | none | `turso db tokens create <db>` |
| `GROUP_CODE` | `psicoacustica` | the code shared in the WhatsApp group |
| `SESSION_SECRET` | dev value | `openssl rand -hex 32` |
| `ADMIN_CODE` | none | optional; logging in with it instead of `GROUP_CODE` makes that session a moderator |
| `OPENROUTER_API_KEY` | none | optional; turns on the Jev junk filter (needs OpenRouter credits) |

Production refuses to start without the first four. Tables and new columns are created on first request.

## Deploy (Vercel + Turso)

```bash
turso db create estante
turso db show estante --url
turso db tokens create estante
vercel link
vercel env add TURSO_DATABASE_URL production   # and the other three
vercel deploy --prod
```

`@sveltejs/adapter-vercel` builds the functions; `static/` (icons, manifest) is served from the CDN.

## Do WhatsApp para a estante

**Um link por vez, pelo menu de compartilhar.** A estante abre com o formulário já preenchido. Se a pessoa ainda não entrou, pede login primeiro.

- **Android:** abra a estante no Chrome, menu ⋮ → *Instalar app* (ou *Adicionar à tela inicial*). A partir daí, no WhatsApp: segure o link → *Compartilhar* → **estante**.
- **iPhone:** o Safari não tem esse menu para sites, então use um Atalho. No app Atalhos, crie um novo com:
  1. *Receber* **URLs e Texto** da **Planilha de Compartilhamento**
  2. *Codificar URL* (Entrada do Atalho)
  3. *Texto*: `https://<seu-domínio>/?url=` seguido da variável *URL Codificado*
  4. *Abrir URLs* (Texto)

  Depois disso, no WhatsApp: segure o link → *Compartilhar* → **estante**.

Qualquer `…/?url=<link>` (ou `?text=` com um link no meio) funciona assim. Links antigos para `/index.html` redirecionam para `/`.

**O histórico inteiro, de uma vez.** Exporte a conversa (*Exportar conversa → Sem mídia*) no iPhone ou no Android e rode:

```bash
pnpm tsx scripts/import-chat.ts conversa.txt            # dry run
pnpm tsx scripts/import-chat.ts conversa.txt --apply    # grava (use as envs de produção para mandar ao Turso)
```

Links que já estão na estante ficam de fora, então dá para reexportar e rodar de novo. No Android, contatos não salvos chegam como número de telefone e entram na estante com esse nome.

## Model

- `users`: `id`, `name` (unique, case-insensitive), `created_at`.
- `recommendations`: `user_id`, `kind` (`album` | `track`), `title`, `artist`, `year`, `url`, `cover_url`, `description`, `tags` (comma list), `status` (`visible` | `held`), `removed_at`, `removed_by`, `created_at`.
- `hits`: `key`, `at` (ms). Rate-limit counters; rows older than a day are pruned on write.

Login is name + group code, kept in a signed cookie for a year. Anyone with the code can post under any new name, and typing an existing name logs in as that person. That is the tradeoff for having no passwords.

## Abuse

Nothing here adds a step for members. The idea is to make damage undoable rather than to keep people out.

- **Nothing is deleted.** "Tirar da estante" sets `removed_at` and `removed_by`. Someone who logs in under another name can hide that person's posts, but a moderator puts them back.
- **Moderators** log in with `ADMIN_CODE` under their own name. Being a moderator belongs to the session, not the name, so typing a moderator's name with the group code gives no powers. Moderators can take down any post and see the *moderação* panel: posts held by the filter, and everything removed, with who removed it.
- **Changing a code signs out everyone who got in with the old one.** The cookie carries an HMAC of the code it was issued under. If `GROUP_CODE` leaks, change it and share the new one in the group. Cookies from before this change are upgraded silently on the next visit.
- **Invisible limits**, counted in the `hits` table because serverless memory doesn't last between requests: 10 wrong codes per IP per 15 min, 10 new names per IP per day, 30 posts per person and 60 per IP per hour.
- **Jev filter** ([TypeSafe AI](https://typesafe.ai), called through OpenRouter as `typesafe/jev-1.13`), only when `OPENROUTER_API_KEY` is set. Each new post is sent as one yes/no question ("is this junk rather than a music recommendation?"). Only answers at 0.9 or above are held: the author still sees the post, with a note, and everyone else sees it after a moderator approves. If Jev is slow (3 s timeout) or down, the post goes up as usual. Title, artist, link, tags and comment go to OpenRouter and TypeSafe; moderators' own posts are not sent.
