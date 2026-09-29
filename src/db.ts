import { createClient, type Client, type InValue } from '@libsql/client'

export type Kind = 'album' | 'track'

export type User = { id: number; name: string }

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
  created_at: string
}

export type NewRec = {
  kind: Kind
  title: string
  artist: string
  year?: number | null
  url?: string | null
  cover_url?: string | null
  description?: string
  tags?: string[]
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
]

export const openDb = (url: string, authToken?: string): Client => createClient({ url, authToken })

export const migrate = async (db: Client) => {
  await db.batch(SCHEMA, 'write')
}

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

export const getUser = async (db: Client, id: number): Promise<User | null> => {
  const rs = await db.execute({ sql: 'select id, name from users where id = ?', args: [id] })
  return rs.rows[0] ? { id: Number(rs.rows[0].id), name: String(rs.rows[0].name) } : null
}

export const listUsers = async (db: Client) => {
  const rs = await db.execute(`
    select u.id, u.name, count(r.id) as recs
    from users u left join recommendations r on r.user_id = u.id
    group by u.id order by recs desc, u.name`)
  return rs.rows.map((r) => ({ id: Number(r.id), name: String(r.name), recs: Number(r.recs) }))
}

export const listRecs = async (db: Client, f: RecFilter = {}): Promise<Rec[]> => {
  const conditions: [string, InValue[]][] = [
    f.kind ? ['r.kind = ?', [f.kind]] : null,
    f.user ? ['r.user_id = ?', [f.user]] : null,
    f.tag ? [`(',' || r.tags || ',') like ?`, [`%,${f.tag.toLowerCase()},%`]] : null,
    f.q ? ['(r.title like ? or r.artist like ? or r.description like ?)', Array(3).fill(`%${f.q}%`)] : null,
  ].filter((c): c is [string, InValue[]] => c !== null)
  const where = conditions.length ? 'where ' + conditions.map(([s]) => s).join(' and ') : ''
  const rs = await db.execute({
    sql: `select r.*, u.name as user_name
          from recommendations r join users u on u.id = r.user_id
          ${where}
          order by r.created_at desc, r.id desc
          limit 500`,
    args: conditions.flatMap(([, a]) => a),
  })
  return rs.rows.map((r) => toRec(r as Record<string, unknown>))
}

export const listTags = async (db: Client) => {
  const rs = await db.execute(`select tags from recommendations where tags <> ''`)
  const counts = rs.rows
    .flatMap((r) => splitTags(String(r.tags)))
    .reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map<string, number>())
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }))
}

export const addRec = async (db: Client, userId: number, r: NewRec): Promise<Rec> => {
  const rs = await db.execute({
    sql: `insert into recommendations (user_id, kind, title, artist, year, url, cover_url, description, tags)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?) returning id`,
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
    ],
  })
  const found = await db.execute({
    sql: `select r.*, u.name as user_name from recommendations r join users u on u.id = r.user_id where r.id = ?`,
    args: [Number(rs.rows[0].id)],
  })
  return toRec(found.rows[0] as Record<string, unknown>)
}

export const deleteRec = async (db: Client, id: number, userId: number) => {
  const rs = await db.execute({ sql: 'delete from recommendations where id = ? and user_id = ?', args: [id, userId] })
  return rs.rowsAffected > 0
}
