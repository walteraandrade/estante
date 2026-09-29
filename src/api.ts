import { createHmac } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie'
import type { Client } from '@libsql/client'
import {
  addHit,
  addRec,
  countHits,
  getUser,
  listRecs,
  listReview,
  listTags,
  listUsers,
  migrate,
  removeRec,
  restoreRec,
  upsertUser,
  userExists,
  type Kind,
  type User,
} from './db.js'
import { fetchMeta, httpUrl } from './meta.js'
import type { Moderate } from './moderation.js'

export type AppOptions = {
  db: Client
  groupCode: string
  // Logging in with this code instead of the group code makes that session an admin.
  adminCode?: string
  secret: string
  moderate?: Moderate
  now?: () => number
  secureCookie?: boolean
  fetch?: typeof fetch
}

type Me = User & { admin: boolean }
type Env = { Variables: { user: Me } }
type Role = 'member' | 'admin'

const COOKIE = 'estante_uid'
const YEAR_S = 60 * 60 * 24 * 365
const MIN_MS = 60 * 1000

// High enough that nobody in the group ever meets them.
const LIMITS = {
  wrongCode: { max: 10, ms: 15 * MIN_MS },
  newName: { max: 10, ms: 24 * 60 * MIN_MS },
  postPerUser: { max: 30, ms: 60 * MIN_MS },
  postPerIp: { max: 60, ms: 60 * MIN_MS },
}

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
  const now = o.now ?? Date.now

  const codeFor = (role: Role) => (role === 'admin' ? o.adminCode : o.groupCode)
  const roleOf = (code: string): Role | null =>
    sameCode(code, o.groupCode) ? 'member' : o.adminCode && sameCode(code, o.adminCode) ? 'admin' : null

  // The cookie carries a fingerprint of the code it was issued under, so changing GROUP_CODE (or ADMIN_CODE)
  // signs out everyone who got in with the old one. It is keyed by the secret so it says nothing about the code.
  const stamp = (role: Role) => createHmac('sha256', o.secret).update(`${role}:${codeFor(role)}`).digest('base64url').slice(0, 16)

  const startSession = (c: Context, id: number, role: Role) =>
    setSignedCookie(c, COOKIE, `${id}.${role}.${stamp(role)}`, o.secret, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: o.secureCookie ?? false,
      path: '/',
      maxAge: YEAR_S,
    })

  const ipOf = (c: Context) => c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local'

  const over = async (key: string, limit: { max: number; ms: number }) => (await countHits(o.db, key, now() - limit.ms)) >= limit.max
  const tooMany = (c: Context) => c.json({ error: 'muitas tentativas; espere um pouco e tente de novo' }, 429)

  app.use(async (_c, next) => {
    await ready
    await next()
  })

  const currentUser = async (c: Context): Promise<Me | null> => {
    const raw = await getSignedCookie(c, o.secret, COOKIE)
    if (!raw) return null
    const legacy = /^\d+$/.test(raw)
    const [id, role, mark] = legacy ? [raw, 'member', ''] : raw.split('.')
    if (role !== 'member' && role !== 'admin') return null
    if (!legacy && mark !== stamp(role)) return null
    const user = await getUser(o.db, Number(id))
    if (!user) return null
    // Cookies from before the fingerprint get one silently, so nobody has to log in again.
    if (legacy) await startSession(c, user.id, 'member')
    return { ...user, admin: role === 'admin' }
  }

  const auth = async (c: Context<Env>, next: () => Promise<void>) => {
    const user = await currentUser(c)
    if (!user) return c.json({ error: 'entre com seu nome e o código do grupo' }, 401)
    c.set('user', user)
    await next()
  }

  const admin = async (c: Context<Env>, next: () => Promise<void>) =>
    c.get('user').admin ? next() : c.json({ error: 'só para quem modera' }, 403)

  app.get('/me', async (c) => {
    const user = await currentUser(c)
    return user ? c.json(user) : c.json({ error: 'anônimo' }, 401)
  })

  app.post('/login', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const name = text(body.name, 40)
    if (!name) return c.json({ error: 'diga seu nome' }, 400)
    const ip = ipOf(c)
    if (await over(`code:${ip}`, LIMITS.wrongCode)) return tooMany(c)
    const role = roleOf(text(body.code, 100))
    if (!role) {
      await addHit(o.db, `code:${ip}`, now())
      return c.json({ error: 'código do grupo errado' }, 403)
    }
    if (!(await userExists(o.db, name))) {
      if (await over(`name:${ip}`, LIMITS.newName)) return tooMany(c)
      await addHit(o.db, `name:${ip}`, now())
    }
    const user = await upsertUser(o.db, name)
    await startSession(c, user.id, role)
    return c.json({ ...user, admin: role === 'admin' })
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
        c.get('user').id,
      ),
    )
  })

  app.post('/recs', auth, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const kind = kindOf(body.kind)
    const title = text(body.title, 200)
    const artist = text(body.artist, 200)
    if (!kind || !title || !artist) return c.json({ error: 'faltam tipo, título ou artista' }, 400)
    const me = c.get('user')
    const ip = ipOf(c)
    if ((await over(`post:${me.id}`, LIMITS.postPerUser)) || (await over(`post:${ip}`, LIMITS.postPerIp))) return tooMany(c)
    await Promise.all([addHit(o.db, `post:${me.id}`, now()), addHit(o.db, `post:${ip}`, now())])
    const input = {
      kind,
      title,
      artist,
      year: yearOf(body.year),
      url: httpUrl(body.url),
      cover_url: httpUrl(body.cover_url),
      description: text(body.description, 4000),
      tags: Array.isArray(body.tags) ? body.tags.map((t: unknown) => text(t, 30)) : [],
    }
    // Moderation fails open: if Jev is slow or down, the recommendation goes up as usual.
    const held = !me.admin && o.moderate ? await o.moderate(input).catch(() => false) : false
    const rec = await addRec(o.db, me.id, { ...input, status: held ? 'held' : 'visible' })
    return c.json(rec, 201)
  })

  app.delete('/recs/:id', auth, async (c) => {
    const me = c.get('user')
    const ok = await removeRec(o.db, Number(c.req.param('id')), me.id, me.admin)
    return ok ? c.json({ ok }) : c.json({ error: 'não achei, ou não é sua' }, 404)
  })

  app.get('/review', auth, admin, async (c) => c.json(await listReview(o.db)))

  app.post('/recs/:id/restore', auth, admin, async (c) => {
    const ok = await restoreRec(o.db, Number(c.req.param('id')))
    return ok ? c.json({ ok }) : c.json({ error: 'não achei' }, 404)
  })

  app.get('/meta', auth, async (c) => {
    const meta = await fetchMeta(c.req.query('url') ?? '', o.fetch).catch(() => null)
    return meta ? c.json(meta) : c.json({ error: 'não consegui ler esse link' }, 404)
  })

  return app
}
