# estante

Shared shelf of album and track recommendations for the *estudos de psicoacústica* group.
Hono API + libSQL (SQLite locally, Turso in production) + a no-build HTML/JS page in `public/`.

## Local

```bash
pnpm install
pnpm dev          # http://localhost:3300, group code "psicoacustica", data in ./estante.db
pnpm test         # in-memory database, no network
pnpm typecheck
```

## Env

| var | local default | production |
|---|---|---|
| `TURSO_DATABASE_URL` | `file:estante.db` | `libsql://<db>-<org>.turso.io` |
| `TURSO_AUTH_TOKEN` | none | `turso db tokens create <db>` |
| `GROUP_CODE` | `psicoacustica` | the code shared in the WhatsApp group |
| `SESSION_SECRET` | dev value | `openssl rand -hex 32` |

Production refuses to start without all four. Tables are created on first request.

## Deploy (Vercel + Turso)

```bash
turso db create estante
turso db show estante --url
turso db tokens create estante
vercel link
vercel env add TURSO_DATABASE_URL production   # and the other three
vercel deploy --prod
```

Vercel picks up `src/index.ts` as the Hono entry and serves `public/` from the CDN.

## Model

- `users`: `id`, `name` (unique, case-insensitive), `created_at`.
- `recommendations`: `user_id`, `kind` (`album` | `track`), `title`, `artist`, `year`, `url`, `cover_url`, `description`, `tags` (comma list), `created_at`.

Login is name + group code, kept in a signed cookie for a year. Anyone with the code can post under any new name, and typing an existing name logs in as that person. That is the tradeoff for having no passwords.
