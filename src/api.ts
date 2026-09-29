import { Hono, type Context } from 'hono'
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie'
import type { Client } from '@libsql/client'
import { addRec, deleteRec, getUser, listRecs, listTags, listUsers, migrate, upsertUser, type Kind, type User } from './db.js'
import { fetchMeta, httpUrl } from './meta.js'

export type AppOptions = {
  db: Client
  groupCode: string
  secret: string
  secureCookie?: boolean
  fetch?: typeof fetch
}

type Env = { Variables: { user: User } }

const COOKIE = 'estante_uid'
const YEAR_S = 60 * 60 * 24 * 365

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const kindOf = (v: unknown): Kind | undefined => (v === 'album' || v === 'track' ? v : undefined)
const yearOf = (v: unknown) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1000 && n <= 2100 ? n : null
}

const sameCode = (a: string, b: string) =>
  a.length === b.length && [...a].reduce((acc, ch, i) => acc | (ch.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0

export const createApp = (o: AppOptions) => {
  const ready = migrate(o.db)
  const app = new Hono<Env>().basePath('/api')

  app.use(async (_c, next) => {
    await ready
    await next()
  })

  const currentUser = async (c: Context) => {
    const id = await getSignedCookie(c, o.secret, COOKIE)
    return id ? getUser(o.db, Number(id)) : null
  }

  const auth = async (c: Context<Env>, next: () => Promise<void>) => {
    const user = await currentUser(c)
    if (!user) return c.json({ error: 'entre com seu nome e o código do grupo' }, 401)
    c.set('user', user)
    await next()
  }

  app.get('/me', async (c) => {
    const user = await currentUser(c)
    return user ? c.json(user) : c.json({ error: 'anônimo' }, 401)
  })

  app.post('/login', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const name = text(body.name, 40)
    if (!name) return c.json({ error: 'diga seu nome' }, 400)
    if (!sameCode(text(body.code, 100), o.groupCode)) return c.json({ error: 'código do grupo errado' }, 403)
    const user = await upsertUser(o.db, name)
    await setSignedCookie(c, COOKIE, String(user.id), o.secret, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: o.secureCookie ?? false,
      path: '/',
      maxAge: YEAR_S,
    })
    return c.json(user)
  })

  app.post('/logout', (c) => {
    deleteCookie(c, COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/users', auth, async (c) => c.json(await listUsers(o.db)))
  app.get('/tags', auth, async (c) => c.json(await listTags(o.db)))

  app.get('/recs', auth, async (c) => {
    const q = c.req.query()
    return c.json(
      await listRecs(
        o.db,
        {
          kind: kindOf(q.kind),
          user: Number(q.user) || undefined,
          tag: text(q.tag, 40) || undefined,
          q: text(q.q, 80) || undefined,
        },
        { limit: Math.min(100, Math.max(1, Number(q.limit) || 30)), cursor: text(q.cursor, 40) || undefined },
      ),
    )
  })

  app.post('/recs', auth, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const kind = kindOf(body.kind)
    const title = text(body.title, 200)
    const artist = text(body.artist, 200)
    if (!kind || !title || !artist) return c.json({ error: 'faltam tipo, título ou artista' }, 400)
    const rec = await addRec(o.db, c.get('user').id, {
      kind,
      title,
      artist,
      year: yearOf(body.year),
      url: httpUrl(body.url),
      cover_url: httpUrl(body.cover_url),
      description: text(body.description, 4000),
      tags: Array.isArray(body.tags) ? body.tags.map((t: unknown) => text(t, 30)) : [],
    })
    return c.json(rec, 201)
  })

  app.delete('/recs/:id', auth, async (c) => {
    const ok = await deleteRec(o.db, Number(c.req.param('id')), c.get('user').id)
    return ok ? c.json({ ok }) : c.json({ error: 'não achei, ou não é sua' }, 404)
  })

  app.get('/meta', auth, async (c) => {
    const meta = await fetchMeta(c.req.query('url') ?? '', o.fetch).catch(() => null)
    return meta ? c.json(meta) : c.json({ error: 'não consegui ler esse link' }, 404)
  })

  return app
}
