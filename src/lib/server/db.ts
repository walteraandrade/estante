import { createClient, type Client, type InValue } from '@libsql/client'

export type Kind = 'album' | 'track'

export type User = { id: number; name: string }

export type Status = 'visible' | 'held'

export type Rec = {
  id: number
  user_id: number
  user_name: string
  kind: Kind
  title: string
  artist: string
  year: number | null
  url: string | null
  cover_url: string | null
  description: string
  tags: string[]
  status: Status
  created_at: string
}

export type RemovedRec = Rec & { removed_at: string; removed_by_name: string | null }

export type NewRec = {
  kind: Kind
  title: string
  artist: string
  year?: number | null
  url?: string | null
  cover_url?: string | null
  description?: string
  tags?: string[]
  status?: Status
}

export type RecFilter = { kind?: Kind; user?: number; tag?: string; q?: string }

const SCHEMA = [
  `create table if not exists users (
    id integer primary key,
    name text not null unique collate nocase,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )`,
  `create table if not exists recommendations (
    id integer primary key,
    user_id integer not null references users(id) on delete cascade,
    kind text not null check (kind in ('album', 'track')),
    title text not null,
    artist text not null,
    year integer,
    url text,
    cover_url text,
    description text not null default '',
    tags text not null default '',
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )`,
  `create index if not exists recommendations_created on recommendations (created_at desc)`,
  `create table if not exists hits (key text not null, at integer not null)`,
  `create index if not exists hits_key_at on hits (key, at)`,
  `create index if not exists hits_at on hits (at)`,
]

// Added after the first deploy, so existing databases get them through alter table.
const LATER_COLUMNS: [string, string][] = [
  ['status', `status text not null default 'visible' check (status in ('visible', 'held'))`],
  ['removed_at', 'removed_at text'],
  ['removed_by', 'removed_by integer references users(id)'],
]

export const openDb = (url: string, authToken?: string): Client => createClient({ url, authToken })

export const migrate = async (db: Client) => {
  await db.batch(SCHEMA, 'write')
  const have = new Set((await db.execute('pragma table_info(recommendations)')).rows.map((r) => String(r.name)))
  for (const [name, def] of LATER_COLUMNS) {
    if (have.has(name)) continue
    // Two cold starts can race here; the loser sees "duplicate column" and moves on.
    await db.execute(`alter table recommendations add column ${def}`).catch((e) => {
      if (!/duplicate column/i.test(String(e))) throw e
    })
  }
}

const NOW = `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
const SHOWN = `r.removed_at is null and r.status = 'visible'`

const splitTags = (raw: string) => raw.split(',').map((t) => t.trim()).filter(Boolean)

export const normalizeTags = (tags: string[] = []) =>
  [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8)

const toRec = (row: Record<string, unknown>): Rec => ({
  id: Number(row.id),
  user_id: Number(row.user_id),
  user_name: String(row.user_name),
  kind: row.kind as Kind,
  title: String(row.title),
  artist: String(row.artist),
  year: row.year == null ? null : Number(row.year),
  url: (row.url as string | null) ?? null,
  cover_url: (row.cover_url as string | null) ?? null,
  description: String(row.description),
  tags: splitTags(String(row.tags)),
  status: row.status === 'held' ? 'held' : 'visible',
  created_at: String(row.created_at),
})

export const upsertUser = async (db: Client, name: string): Promise<User> => {
  const rs = await db.execute({
    sql: `insert into users (name) values (?)
          on conflict (name) do update set name = users.name
          returning id, name`,
    args: [name],
  })
  return { id: Number(rs.rows[0].id), name: String(rs.rows[0].name) }
}

export const userExists = async (db: Client, name: string) =>
  (await db.execute({ sql: 'select 1 from users where name = ?', args: [name] })).rows.length > 0

export const getUser = async (db: Client, id: number): Promise<User | null> => {
  const rs = await db.execute({ sql: 'select id, name from users where id = ?', args: [id] })
  return rs.rows[0] ? { id: Number(rs.rows[0].id), name: String(rs.rows[0].name) } : null
}

export const listUsers = async (db: Client) => {
  const rs = await db.execute(`
    select u.id, u.name, count(r.id) as recs
    from users u left join recommendations r on r.user_id = u.id and ${SHOWN}
    group by u.id order by recs desc, u.name`)
  return rs.rows.map((r) => ({ id: Number(r.id), name: String(r.name), recs: Number(r.recs) }))
}

export type RecPage = { items: Rec[]; next: string | null; total: number }

const CURSOR = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)~(\d+)$/

const cursorOf = (r: Rec) => `${r.created_at}~${r.id}`

type Condition = [string, InValue[]]

const where = (conditions: Condition[]) => (conditions.length ? 'where ' + conditions.map(([s]) => s).join(' and ') : '')

// Held recommendations stay visible to their author, so a false positive never looks like a lost post.
export const listRecs = async (
  db: Client,
  f: RecFilter = {},
  page: { limit?: number; cursor?: string } = {},
  viewer = 0,
): Promise<RecPage> => {
  const limit = page.limit ?? 30
  const filters: Condition[] = [
    [`r.removed_at is null and (r.status = 'visible' or r.user_id = ?)`, [viewer]],
    f.kind ? ['r.kind = ?', [f.kind]] : null,
    f.user ? ['r.user_id = ?', [f.user]] : null,
    f.tag ? [`(',' || r.tags || ',') like ?`, [`%,${f.tag.toLowerCase()},%`]] : null,
    f.q ? ['(r.title like ? or r.artist like ? or r.description like ?)', Array(3).fill(`%${f.q}%`)] : null,
  ].filter((c): c is Condition => c !== null)
  const at = page.cursor?.match(CURSOR)
  const after: Condition[] = at ? [['(r.created_at < ? or (r.created_at = ? and r.id < ?))', [at[1], at[1], Number(at[2])]]] : []
  const conditions = [...filters, ...after]
  const [rows, count] = await Promise.all([
    db.execute({
      sql: `select r.*, u.name as user_name
            from recommendations r join users u on u.id = r.user_id
            ${where(conditions)}
            order by r.created_at desc, r.id desc
            limit ?`,
      args: [...conditions.flatMap(([, a]) => a), limit + 1],
    }),
    db.execute({ sql: `select count(*) as n from recommendations r ${where(filters)}`, args: filters.flatMap(([, a]) => a) }),
  ])
  const all = rows.rows.map((r) => toRec(r as Record<string, unknown>))
  const items = all.slice(0, limit)
  return { items, next: all.length > limit ? cursorOf(items[items.length - 1]) : null, total: Number(count.rows[0].n) }
}

export const listTags = async (db: Client) => {
  const rs = await db.execute(`select tags from recommendations r where tags <> '' and ${SHOWN}`)
  const counts = rs.rows
    .flatMap((r) => splitTags(String(r.tags)))
    .reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map<string, number>())
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }))
}

export const addRec = async (db: Client, userId: number, r: NewRec): Promise<Rec> => {
  const rs = await db.execute({
    sql: `insert into recommendations (user_id, kind, title, artist, year, url, cover_url, description, tags, status)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id`,
    args: [
      userId,
      r.kind,
      r.title,
      r.artist,
      r.year ?? null,
      r.url ?? null,
      r.cover_url ?? null,
      r.description ?? '',
      normalizeTags(r.tags).join(','),
      r.status ?? 'visible',
    ],
  })
  const found = await db.execute({
    sql: `select r.*, u.name as user_name from recommendations r join users u on u.id = r.user_id where r.id = ?`,
    args: [Number(rs.rows[0].id)],
  })
  return toRec(found.rows[0] as Record<string, unknown>)
}

// Nothing is deleted for real: whoever logs in under someone else's name can't do lasting damage.
export const removeRec = async (db: Client, id: number, by: number, admin = false) => {
  const rs = await db.execute({
    sql: `update recommendations set removed_at = ${NOW}, removed_by = ?
          where id = ? and removed_at is null and (user_id = ? or ?)`,
    args: [by, id, by, admin ? 1 : 0],
  })
  return rs.rowsAffected > 0
}

export const restoreRec = async (db: Client, id: number) => {
  const rs = await db.execute({
    sql: `update recommendations set removed_at = null, removed_by = null, status = 'visible' where id = ?`,
    args: [id],
  })
  return rs.rowsAffected > 0
}

export const listReview = async (db: Client): Promise<{ held: Rec[]; removed: RemovedRec[] }> => {
  const [held, removed] = await Promise.all([
    db.execute(`select r.*, u.name as user_name from recommendations r join users u on u.id = r.user_id
                where r.status = 'held' and r.removed_at is null order by r.created_at desc limit 100`),
    db.execute(`select r.*, u.name as user_name, b.name as removed_by_name
                from recommendations r join users u on u.id = r.user_id left join users b on b.id = r.removed_by
                where r.removed_at is not null order by r.removed_at desc, r.id desc limit 100`),
  ])
  return {
    held: held.rows.map((r) => toRec(r as Record<string, unknown>)),
    removed: removed.rows.map((r) => ({
      ...toRec(r as Record<string, unknown>),
      removed_at: String(r.removed_at),
      removed_by_name: r.removed_by_name == null ? null : String(r.removed_by_name),
    })),
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

export const countHits = async (db: Client, key: string, since: number) =>
  Number((await db.execute({ sql: 'select count(*) as n from hits where key = ? and at > ?', args: [key, since] })).rows[0].n)

export const addHit = async (db: Client, key: string, at: number) => {
  await db.batch(
    [
      { sql: 'delete from hits where at < ?', args: [at - DAY_MS] },
      { sql: 'insert into hits (key, at) values (?, ?)', args: [key, at] },
    ],
    'write',
  )
}
