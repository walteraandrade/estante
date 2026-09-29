import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { migrate, openDb, upsertUser } from '../src/db.js'
import { fetchMeta, type Meta } from '../src/meta.js'

type Shared = { name: string; url: string; at: string }

const HEAD = /^\[(\d\d)\/(\d\d)\/(\d\d), (\d\d):(\d\d):(\d\d)\] ([^:]+): /gm
const MUSIC = /https?:\/\/(?:open\.spotify\.com|music\.youtube\.com|(?:www\.|m\.)?youtube\.com|youtu\.be|[\w-]+\.bandcamp\.com)\/[^\s<>"]+/g
const BRT_OFFSET_H = 3
const NOT_A_RECORD = /open\.spotify\.com\/(playlist|artist|wrapped|show|episode|user)\//

const firstName = (sender: string) => sender.replace(/[~  ]/g, ' ').trim().split(/\s+/)[0]

const toIso = ([dd, mm, yy, h, m, s]: string[]) =>
  new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(h) + BRT_OFFSET_H, Number(m), Number(s))).toISOString().replace(/\.\d{3}Z$/, 'Z')

export const canonical = (raw: string) => {
  const u = new URL(raw.replace(/[).,;!?]+$/, ''))
  if (u.hostname === 'youtu.be') return `https://www.youtube.com/watch?v=${u.pathname.slice(1)}`
  if (/youtube\.com$/.test(u.hostname)) {
    const keep = ['v', 'list'].filter((k) => u.searchParams.get(k)).map((k) => `${k}=${u.searchParams.get(k)}`)
    const path = u.pathname === '/playlist' || u.pathname === '/watch' ? u.pathname : u.pathname.replace(/\/$/, '')
    return `https://${u.hostname === 'music.youtube.com' ? 'music.youtube.com' : 'www.youtube.com'}${path}${keep.length ? '?' + keep.join('&') : ''}`
  }
  if (u.hostname === 'open.spotify.com') return `https://open.spotify.com${u.pathname.replace(/^\/intl-[a-z-]+/, '')}`
  return `${u.origin}${u.pathname}`
}

export const parseChat = (text: string): Shared[] => {
  const clean = text.replace(/‎/g, '')
  const heads = [...clean.matchAll(HEAD)]
  const seen = new Set<string>()
  return heads.flatMap((h, i) => {
    const body = clean.slice(h.index! + h[0].length, heads[i + 1]?.index ?? clean.length)
    return [...body.matchAll(MUSIC)].flatMap(([raw]) => {
      const url = canonical(raw)
      if (seen.has(url) || NOT_A_RECORD.test(url)) return []
      seen.add(url)
      return [{ name: firstName(h[7]), url, at: toIso(h.slice(1, 7)) }]
    })
  })
}

const metaFor = async (url: string): Promise<Meta | null> => {
  const m = await fetchMeta(url.replace('https://music.youtube.com/', 'https://www.youtube.com/')).catch(() => null)
  return m && /[?&]list=/.test(url) && !/[?&]v=/.test(url) ? { ...m, kind: 'album' } : m
}

const main = async () => {
  const [file, flag] = process.argv.slice(2)
  const apply = flag === '--apply'
  const shared = parseChat(readFileSync(file, 'utf8'))
  const db = openDb(process.env.TURSO_DATABASE_URL ?? 'file:estante.db', process.env.TURSO_AUTH_TOKEN)
  await migrate(db)
  const existing = new Set((await db.execute('select url from recommendations where url is not null')).rows.map((r) => String(r.url)))
  const todo = shared.filter((s) => !existing.has(s.url))
  console.log(`${shared.length} links, ${shared.length - todo.length} already on the shelf, ${todo.length} to import${apply ? '' : ' (dry run)'}`)

  const failed: Shared[] = []
  let done = 0
  for (const s of todo) {
    const meta = await metaFor(s.url)
    await new Promise((r) => setTimeout(r, 250))
    if (!meta || !meta.title || !meta.artist) {
      failed.push(s)
      continue
    }
    if (apply) {
      const user = await upsertUser(db, s.name)
      await db.execute({
        sql: `insert into recommendations (user_id, kind, title, artist, year, url, cover_url, description, tags, created_at)
              values (?, ?, ?, ?, ?, ?, ?, '', '', ?)`,
        args: [user.id, meta.kind, meta.title, meta.artist, meta.year, s.url, meta.cover_url, s.at],
      })
    }
    done++
    if (done % 20 === 0) console.log(`  ${done}/${todo.length}`)
  }
  console.log(`${apply ? 'imported' : 'would import'} ${done}, unreadable ${failed.length}`)
  failed.forEach((s) => console.log(`  unreadable: ${s.url}`))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
