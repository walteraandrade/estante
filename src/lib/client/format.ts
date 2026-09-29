import type { Filter } from '$lib/types'

export const SEED_TAGS = ['jazz', 'ambient', 'experimental', 'brasileira', 'pós-punk', 'shoegaze', 'eletrônica', 'indie', 'instrumental', 'clássica', 'groove', 'rock']
const TONES = ['#e07b4f', '#a7bf8f', '#f2c14e', '#c9a0dc', '#8fb8d9', '#e6a3a3']
const COVERS = [
  ['#6b2d2d', '#e9d8b4'],
  ['#d9a441', '#5a3a22'],
  ['#e9e4d6', '#2b3a67'],
  ['#2d4a3e', '#d8c9a3'],
  ['#c9481f', '#f0b53c'],
  ['#3c4f5c', '#a8c3cf'],
  ['#2f6b4f', '#f2e3b3'],
  ['#8a1d3a', '#f0e5d3'],
]

const hash = (s: string) => [...s].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)
const pick = <T>(list: T[], key: string) => list[hash(key.toLowerCase()) % list.length]

export const toneOf = (name: string) => pick(TONES, name)
export const coverOf = (key: string) => pick(COVERS, key)

const STEPS: [number, Intl.RelativeTimeFormatUnit, number][] = [
  [60, 'second', 1],
  [3600, 'minute', 60],
  [86400, 'hour', 3600],
  [604800, 'day', 86400],
  [2629800, 'week', 604800],
  [31557600, 'month', 2629800],
  [Infinity, 'year', 31557600],
]
const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })

export const relative = (iso: string) => {
  const s = (new Date(iso).getTime() - Date.now()) / 1000
  const [, unit, size] = STEPS.find(([limit]) => Math.abs(s) < limit)!
  return rtf.format(Math.trunc(s / size), unit)
}

export const safeHref = (url: string | null) => (url && /^https?:\/\//.test(url) ? url : null)

export const readTags = (raw: string) => raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)

export const FILTER_KEYS = ['kind', 'user', 'tag', 'q'] as const

export const filterOf = (params: URLSearchParams): Filter => {
  const kind = params.get('kind')
  return {
    kind: kind === 'album' || kind === 'track' ? kind : '',
    user: params.get('user') ?? '',
    tag: params.get('tag') ?? '',
    q: params.get('q') ?? '',
  }
}

export const filterParams = (f: Filter) => new URLSearchParams(FILTER_KEYS.filter((k) => f[k]).map((k) => [k, f[k]]))

export const isFiltered = (f: Filter) => FILTER_KEYS.some((k) => f[k])

// Links arrive as ?url= (iOS Shortcut) or via the Android share sheet, where WhatsApp puts the link inside ?text=.
export const sharedLink = (params: URLSearchParams) =>
  ['url', 'text', 'title']
    .map((k) => params.get(k)?.match(/https?:\/\/[^\s<>"]+/)?.[0])
    .find(Boolean)
    ?.replace(/[).,;!?]+$/, '') ?? ''

export const PAGE = 30
