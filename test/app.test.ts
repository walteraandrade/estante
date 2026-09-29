import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/api.js'
import { openDb } from '../src/db.js'
import { parseBandcamp, parseSpotify, parseYoutube, isKnownHost } from '../src/meta.js'

const SPOTIFY_ALBUM = `<meta property="og:title" content="Inferno - Album by Boards of Canada | Spotify"/>
<meta property="og:description" content="Boards of Canada · album · 2026 · 18 songs"/>
<meta property="og:type" content="music.album"/>
<meta property="og:image" content="https://i.scdn.co/image/abc"/>
<meta name="music:release_date" content="2026-05-29"/>`

const SPOTIFY_TRACK = `<meta property="og:title" content="Axes"/>
<meta property="og:description" content="Okonski, Rachel Kitchlew · Axes · Song · 2026"/>
<meta property="og:type" content="music.song"/>
<meta property="og:image" content="https://i.scdn.co/image/def"/>`

const setup = (fetchStub?: typeof fetch) => {
  const app = createApp({ db: openDb(':memory:'), groupCode: 'segredo', secret: 's', fetch: fetchStub })
  const call = (path: string, init: RequestInit & { cookie?: string } = {}) =>
    app.request(`/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) },
    })
  const login = async (name: string) => {
    const res = await call('/login', { method: 'POST', body: JSON.stringify({ name, code: 'segredo' }) })
    return (res.headers.get('set-cookie') ?? '').split(';')[0]
  }
  return { call, login }
}

test('spotify album page becomes an album with year and cover', () => {
  assert.deepEqual(parseSpotify(SPOTIFY_ALBUM), {
    kind: 'album',
    title: 'Inferno',
    artist: 'Boards of Canada',
    year: 2026,
    cover_url: 'https://i.scdn.co/image/abc',
  })
})

test('spotify song page becomes a track', () => {
  assert.deepEqual(parseSpotify(SPOTIFY_TRACK), {
    kind: 'track',
    title: 'Axes',
    artist: 'Okonski, Rachel Kitchlew',
    year: 2026,
    cover_url: 'https://i.scdn.co/image/def',
  })
})

test('youtube title splits artist and song and drops the video tag', () => {
  const m = parseYoutube({ title: 'DJ Shadow - Nobody Speak (Official Video)', author_name: 'DJ Shadow', thumbnail_url: 'https://i.ytimg.com/x.jpg' })
  assert.equal(m?.artist, 'DJ Shadow')
  assert.equal(m?.title, 'Nobody Speak')
  assert.equal(parseYoutube({ title: 'Lotus Light', author_name: 'Tim Hecker - Topic' })?.artist, 'Tim Hecker')
})

test('bandcamp og title reads "album, by artist"', () => {
  const m = parseBandcamp(`<meta property="og:title" content="Buoyant, by The Necks"><meta property="og:type" content="album">`)
  assert.equal(m?.title, 'Buoyant')
  assert.equal(m?.artist, 'The Necks')
})

test('meta only follows known music hosts', () => {
  assert.equal(isKnownHost('https://open.spotify.com/album/x'), true)
  assert.equal(isKnownHost('https://youtu.be/x'), true)
  assert.equal(isKnownHost('http://169.254.169.254/latest'), false)
  assert.equal(isKnownHost('file:///etc/passwd'), false)
})

test('login needs the group code', async () => {
  const { call } = setup()
  const bad = await call('/login', { method: 'POST', body: JSON.stringify({ name: 'Beto', code: 'x' }) })
  assert.equal(bad.status, 403)
})

test('posting needs a session', async () => {
  const { call } = setup()
  const res = await call('/recs', { method: 'POST', body: JSON.stringify({ kind: 'album', title: 'a', artist: 'b' }) })
  assert.equal(res.status, 401)
})

test('a friend recommends, everyone sees it, filters work', async () => {
  const { call, login } = setup()
  const beto = await login('Beto')
  const yuri = await login('Yuri')
  await call('/recs', {
    method: 'POST',
    cookie: beto,
    body: JSON.stringify({ kind: 'album', title: 'Laughing Stock', artist: 'Talk Talk', year: 1991, tags: ['Pós-rock', 'pós-rock', ' '], description: 'o silêncio também toca' }),
  })
  await call('/recs', { method: 'POST', cookie: yuri, body: JSON.stringify({ kind: 'track', title: 'Axes', artist: 'Okonski', url: 'javascript:alert(1)' }) })

  assert.equal((await call('/recs')).status, 401)
  const read = (path: string) => Promise.resolve(call(path, { cookie: yuri })).then((r) => r.json())
  const all = await read('/recs')
  assert.equal(all.length, 2)
  assert.equal(all.find((r: { title: string }) => r.title === 'Axes').url, null)

  const albums = await read('/recs?kind=album')
  assert.deepEqual(albums.map((r: { title: string }) => r.title), ['Laughing Stock'])
  assert.deepEqual(albums[0].tags, ['pós-rock'])

  const tagged = await read('/recs?tag=pós-rock')
  assert.equal(tagged.length, 1)

  const found = await read('/recs?q=silêncio')
  assert.equal(found[0].user_name, 'Beto')

  const users = await read('/users')
  assert.deepEqual(users.map((u: { name: string; recs: number }) => [u.name, u.recs]), [['Beto', 1], ['Yuri', 1]])
})

test('same name logs back into the same user, case-insensitive', async () => {
  const { call, login } = setup()
  await login('Gabriel')
  const again = await login('gabriel')
  const me = await (await call('/me', { cookie: again })).json()
  assert.equal(me.name, 'Gabriel')
})

test('only the author deletes a recommendation', async () => {
  const { call, login } = setup()
  const beto = await login('Beto')
  const yuri = await login('Yuri')
  const rec = await (await call('/recs', { method: 'POST', cookie: beto, body: JSON.stringify({ kind: 'album', title: 'a', artist: 'b' }) })).json()
  assert.equal((await call(`/recs/${rec.id}`, { method: 'DELETE', cookie: yuri })).status, 404)
  assert.equal((await call(`/recs/${rec.id}`, { method: 'DELETE', cookie: beto })).status, 200)
})

test('meta route reads a spotify link through the injected fetch', async () => {
  const stub = (async () => new Response(SPOTIFY_TRACK)) as typeof fetch
  const { call, login } = setup(stub)
  const me = await login('Walter')
  const res = await call(`/meta?url=${encodeURIComponent('https://open.spotify.com/track/6T8B')}`, { cookie: me })
  assert.equal((await res.json()).title, 'Axes')
})
