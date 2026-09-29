import type { Kind } from './db.js'

export type Meta = {
  kind: Kind
  title: string
  artist: string
  year: number | null
  cover_url: string | null
}

type Fetch = typeof fetch

const HOSTS = [/^open\.spotify\.com$/, /^(www\.|m\.|music\.)?youtube\.com$/, /^youtu\.be$/, /^[\w-]+\.bandcamp\.com$/]

export const httpUrl = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || raw.length > 500) return null
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

export const isKnownHost = (raw: string) => {
  const url = httpUrl(raw)
  return url !== null && HOSTS.some((h) => h.test(new URL(url).hostname))
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

export const ogTags = (html: string) =>
  Object.fromEntries(
    [...html.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]),
  ) as Record<string, string>

const yearOf = (s = '') => {
  const m = s.match(/\b(19|20)\d{2}\b/)
  return m ? Number(m[0]) : null
}

const TRACK_TYPES = /^(song|música|musica|track|faixa)$/i

export const parseSpotify = (html: string): Meta | null => {
  const og = ogTags(html)
  if (!og['og:title'] || !og['og:description']) return null
  const parts = og['og:description'].split(' · ').map((p) => p.trim())
  const isTrack = og['og:type'] === 'music.song' || parts.some((p) => TRACK_TYPES.test(p))
  return {
    kind: isTrack ? 'track' : 'album',
    title: og['og:title'].replace(/\s+-\s+(Album|Single|EP|Compilation|Álbum)\s+(by|de)\s+.*$/i, '').replace(/\s*\|\s*Spotify$/, ''),
    artist: parts[0] ?? '',
    year: yearOf(og['music:release_date']) ?? yearOf(parts.at(-1)) ?? yearOf(parts.at(-2)),
    cover_url: httpUrl(og['og:image']),
  }
}

export const parseYoutube = (o: { title?: string; author_name?: string; thumbnail_url?: string }): Meta | null => {
  if (!o.title) return null
  const clean = (s: string) => s.replace(/\s*[([](official|oficial|lyric|audio|video|visualizer|clipe|hd|4k)[^)\]]*[)\]]/gi, '').trim()
  const [left, ...rest] = o.title.split(' - ')
  const split = rest.length > 0
  return {
    kind: 'track',
    title: clean(split ? rest.join(' - ') : o.title),
    artist: split ? left.trim() : (o.author_name ?? '').replace(/\s+-\s+Topic$/, ''),
    year: null,
    cover_url: httpUrl(o.thumbnail_url),
  }
}

export const parseBandcamp = (html: string): Meta | null => {
  const og = ogTags(html)
  const m = og['og:title']?.match(/^(.*), by (.*)$/)
  if (!m) return null
  return {
    kind: og['og:type'] === 'song' ? 'track' : 'album',
    title: m[1].trim(),
    artist: m[2].trim(),
    year: null,
    cover_url: httpUrl(og['og:image']),
  }
}

const TIMEOUT_MS = 6000

const get = (f: Fetch, url: string) =>
  f(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; estante/1.0)' }, signal: AbortSignal.timeout(TIMEOUT_MS) })

export const fetchMeta = async (raw: string, f: Fetch = fetch): Promise<Meta | null> => {
  if (!isKnownHost(raw)) return null
  const url = new URL(raw)
  const host = url.hostname
  if (/youtu/.test(host)) {
    const res = await get(f, `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.toString())}`)
    return res.ok ? parseYoutube(await res.json()) : null
  }
  const res = await get(f, url.toString())
  if (!res.ok) return null
  const html = (await res.text()).slice(0, 400_000)
  return host.endsWith('bandcamp.com') ? parseBandcamp(html) : parseSpotify(html)
}
