import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serializeSigned } from 'hono/utils/cookie'
import { createApp, type AppOptions } from '../src/lib/server/api.js'
import { migrate, openDb, upsertUser } from '../src/lib/server/db.js'
import { jevModerator } from '../src/lib/server/moderation.js'
import { parseBandcamp, parseSpotify, parseYoutube, isKnownHost } from '../src/lib/server/meta.js'
import { parseChat } from '../scripts/import-chat.js'

const SPOTIFY_ALBUM = `<meta property="og:title" content="Inferno - Album by Boards of Canada | Spotify"/>
<meta property="og:description" content="Boards of Canada · album · 2026 · 18 songs"/>
<meta property="og:type" content="music.album"/>
<meta property="og:image" content="https://i.scdn.co/image/abc"/>
<meta name="music:release_date" content="2026-05-29"/>`

const SPOTIFY_TRACK = `<meta property="og:title" content="Axes"/>
<meta property="og:description" content="Okonski, Rachel Kitchlew · Axes · Song · 2026"/>
<meta property="og:type" content="music.song"/>
<meta property="og:image" content="https://i.scdn.co/image/def"/>`

const setup = (opts: Partial<AppOptions> = {}) => {
  const db = opts.db ?? openDb(':memory:')
  const app = createApp({ db, groupCode: 'segredo', adminCode: 'chave', secret: 's', ...opts })
  const call = (path: string, init: RequestInit & { cookie?: string; ip?: string } = {}) =>
    app.request(`/api${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...(init.ip ? { 'x-real-ip': init.ip } : {}),
      },
    })
  const login = async (name: string, code = 'segredo') => {
    const res = await call('/login', { method: 'POST', body: JSON.stringify({ name, code }) })
    return (res.headers.get('set-cookie') ?? '').split(';')[0]
  }
  const post = (cookie: string, title = 'Laughing Stock') =>
    call('/recs', { method: 'POST', cookie, body: JSON.stringify({ kind: 'album', title, artist: 'Talk Talk' }) })
  const titles = async (cookie: string) => (await (await call('/recs', { cookie })).json()).items.map((r: { title: string }) => r.title)
  return { db, call, login, post, titles }
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
  const all = (await read('/recs')).items
  assert.equal(all.length, 2)
  assert.equal(all.find((r: { title: string }) => r.title === 'Axes').url, null)

  const albums = (await read('/recs?kind=album')).items
  assert.deepEqual(albums.map((r: { title: string }) => r.title), ['Laughing Stock'])
  assert.deepEqual(albums[0].tags, ['pós-rock'])

  const tagged = await read('/recs?tag=pós-rock')
  assert.equal(tagged.items.length, 1)
  assert.equal(tagged.total, 1)

  const found = (await read('/recs?q=silêncio')).items
  assert.equal(found[0].user_name, 'Beto')

  const users = await read('/users')
  assert.deepEqual(users.map((u: { name: string; recs: number }) => [u.name, u.recs]), [['Beto', 1], ['Yuri', 1]])
})

test('pages walk the whole shelf once, newest first, even within the same second', async () => {
  const { call, login } = setup()
  const me = await login('Walter')
  for (const n of [1, 2, 3, 4, 5]) {
    await call('/recs', { method: 'POST', cookie: me, body: JSON.stringify({ kind: n % 2 ? 'album' : 'track', title: `t${n}`, artist: 'a' }) })
  }
  const page = (q: string) => Promise.resolve(call(`/recs?limit=2${q}`, { cookie: me })).then((r) => r.json())
  const walk = async (cursor: string | null, seen: string[][]): Promise<string[][]> => {
    const p = await page(cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
    assert.equal(p.total, 5)
    const next = [...seen, p.items.map((r: { title: string }) => r.title)]
    return p.next ? walk(p.next, next) : next
  }
  assert.deepEqual(await walk(null, []), [['t5', 't4'], ['t3', 't2'], ['t1']])

  const albums = await page('&kind=album')
  assert.equal(albums.total, 3)
  assert.deepEqual(albums.items.map((r: { title: string }) => r.title), ['t5', 't3'])

  const junk = await page('&cursor=nonsense')
  assert.deepEqual(junk.items.map((r: { title: string }) => r.title), ['t5', 't4'])
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

test('removing only hides; an admin sees who removed it and puts it back', async () => {
  const { call, login, post, titles } = setup()
  const beto = await login('Beto')
  const mod = await login('Walter', 'chave')
  const rec = await (await post(beto)).json()

  assert.equal((await call(`/recs/${rec.id}`, { method: 'DELETE', cookie: beto })).status, 200)
  assert.deepEqual(await titles(beto), [])
  assert.deepEqual((await (await call('/users', { cookie: beto })).json()).find((u: { name: string }) => u.name === 'Beto').recs, 0)

  assert.equal((await call('/review', { cookie: beto })).status, 403)
  const { removed } = await (await call('/review', { cookie: mod })).json()
  assert.deepEqual(removed.map((r: { title: string; removed_by_name: string }) => [r.title, r.removed_by_name]), [['Laughing Stock', 'Beto']])

  assert.equal((await call(`/recs/${rec.id}/restore`, { method: 'POST', cookie: beto })).status, 403)
  assert.equal((await call(`/recs/${rec.id}/restore`, { method: 'POST', cookie: mod })).status, 200)
  assert.deepEqual(await titles(beto), ['Laughing Stock'])
})

test('admin comes from the admin code, not from the name', async () => {
  const { call, login, post } = setup()
  const mod = await login('Walter', 'chave')
  const me = await (await call('/me', { cookie: mod })).json()
  assert.equal(me.admin, true)

  const posing = await login('Walter')
  assert.equal((await (await call('/me', { cookie: posing })).json()).admin, false)
  assert.equal((await call('/review', { cookie: posing })).status, 403)

  const yuri = await login('Yuri')
  const rec = await (await post(yuri)).json()
  assert.equal((await call(`/recs/${rec.id}`, { method: 'DELETE', cookie: posing })).status, 404)
  assert.equal((await call(`/recs/${rec.id}`, { method: 'DELETE', cookie: mod })).status, 200)
})

test('changing the group code signs out old sessions; pre-fingerprint cookies keep working', async () => {
  const db = openDb(':memory:')
  const before = setup({ db })
  const beto = await before.login('Beto')
  assert.equal((await before.call('/me', { cookie: beto })).status, 200)

  const legacy = (await serializeSigned('estante_uid', String((await upsertUser(db, 'Yuri')).id), 's')).split(';')[0]
  const res = await before.call('/me', { cookie: legacy })
  assert.equal(res.status, 200)
  const upgraded = (res.headers.get('set-cookie') ?? '').split(';')[0]
  assert.match(upgraded, /^estante_uid=\d+\.member\./)

  const after = setup({ db, groupCode: 'novo' })
  assert.equal((await after.call('/me', { cookie: beto })).status, 401)
  assert.equal((await after.call('/me', { cookie: upgraded })).status, 401)
  assert.equal((await after.call('/me', { cookie: await after.login('Beto', 'novo') })).status, 200)
})

test('guessing the code is throttled per address, and the window slides', async () => {
  let clock = 1_000_000
  const { call } = setup({ now: () => clock })
  const attempt = (code: string, ip = '1.1.1.1') => call('/login', { method: 'POST', ip, body: JSON.stringify({ name: 'Beto', code }) })
  for (let i = 0; i < 10; i++) assert.equal((await attempt('chute')).status, 403)
  assert.equal((await attempt('segredo')).status, 429)
  assert.equal((await attempt('segredo', '2.2.2.2')).status, 200)
  clock += 16 * 60 * 1000
  assert.equal((await attempt('segredo')).status, 200)
})

test('new names and posts are capped far above what a member does', async () => {
  let clock = 1_000_000
  const { call, login, post } = setup({ now: () => clock })
  const named = (name: string) => call('/login', { method: 'POST', ip: '3.3.3.3', body: JSON.stringify({ name, code: 'segredo' }) })
  for (let i = 0; i < 10; i++) assert.equal((await named(`p${i}`)).status, 200)
  assert.equal((await named('p10')).status, 429)
  assert.equal((await named('p0')).status, 200)

  const me = await login('Beto')
  for (let i = 0; i < 30; i++) assert.equal((await post(me, `t${i}`)).status, 201)
  assert.equal((await post(me, 'demais')).status, 429)
  clock += 61 * 60 * 1000
  assert.equal((await post(me, 'depois')).status, 201)
})

test('what moderation holds only its author and admins see, and it fails open', async () => {
  let verdict: () => Promise<boolean> = async () => true
  const { call, login, post, titles } = setup({ moderate: () => verdict() })
  const beto = await login('Beto')
  const yuri = await login('Yuri')
  const mod = await login('Walter', 'chave')

  const held = await (await post(beto, 'COMPRE SEGUIDORES')).json()
  assert.equal(held.status, 'held')
  assert.deepEqual(await titles(beto), ['COMPRE SEGUIDORES'])
  assert.deepEqual(await titles(yuri), [])
  assert.equal((await (await call('/recs', { cookie: yuri })).json()).total, 0)
  assert.deepEqual((await (await call('/review', { cookie: mod })).json()).held.map((r: { id: number }) => r.id), [held.id])

  assert.equal((await (await post(mod, 'do admin')).json()).status, 'visible')
  verdict = async () => {
    throw new Error('jev fora do ar')
  }
  assert.equal((await (await post(yuri, 'Spirit of Eden')).json()).status, 'visible')

  await call(`/recs/${held.id}/restore`, { method: 'POST', cookie: mod })
  assert.ok((await titles(yuri)).includes('COMPRE SEGUIDORES'))
})

test('jev moderator asks one yes/no question and holds only near-certain junk', async () => {
  const sent: { url: string; init: RequestInit }[] = []
  let p = 0.95
  const stub = (async (url: string, init: RequestInit) => {
    sent.push({ url, init })
    return Response.json({ model: 'jev-1.13', answers: { junk: { type: 'noul', noul: p } }, usage: { input_tokens: 90, output_tokens: 0 } })
  }) as typeof fetch
  const moderate = jevModerator('key', stub)
  const rec = { kind: 'album' as const, title: 'Laughing Stock', artist: 'Talk Talk', description: 'o silêncio também toca' }
  assert.equal(await moderate(rec), true)
  p = 0.6
  assert.equal(await moderate(rec), false)

  assert.equal(sent[0].url, 'https://openrouter.ai/api/v1/systemone')
  assert.equal((sent[0].init.headers as Record<string, string>).authorization, 'Bearer key')
  const body = JSON.parse(String(sent[0].init.body))
  assert.equal(body.model, 'typesafe/jev-1.13')
  assert.equal(body.state.title, 'Laughing Stock')
  assert.equal(body.questions.junk.type, 'noul')

  const down = jevModerator('key', (async () => new Response('no', { status: 503 })) as typeof fetch)
  await assert.rejects(down(rec))
})

test('an existing shelf gains the moderation columns and keeps its recommendations', async () => {
  const db = openDb(':memory:')
  await db.batch(
    [
      `create table users (id integer primary key, name text not null unique collate nocase, created_at text not null default '2026-01-01T00:00:00Z')`,
      `create table recommendations (id integer primary key, user_id integer not null, kind text not null, title text not null, artist text not null,
        year integer, url text, cover_url text, description text not null default '', tags text not null default '', created_at text not null default '2026-01-01T00:00:00Z')`,
      `insert into users (name) values ('Beto')`,
      `insert into recommendations (user_id, kind, title, artist) values (1, 'album', 'Laughing Stock', 'Talk Talk')`,
    ],
    'write',
  )
  await migrate(db)
  await migrate(db)
  const { login, titles } = setup({ db })
  assert.deepEqual(await titles(await login('Yuri')), ['Laughing Stock'])
})

test('meta route reads a spotify link through the injected fetch', async () => {
  const stub = (async () => new Response(SPOTIFY_TRACK)) as typeof fetch
  const { call, login } = setup({ fetch: stub })
  const me = await login('Walter')
  const res = await call(`/meta?url=${encodeURIComponent('https://open.spotify.com/track/6T8B')}`, { cookie: me })
  assert.equal((await res.json()).title, 'Axes')
})

test('chat export from iPhone and Android both yield links with sender and time', () => {
  const iphone = `[29/09/26, 14:03:11] Ana Souza: ouçam isso https://open.spotify.com/intl-pt/album/abc?si=x
[29/09/26, 14:05:00] ~ Bruno: https://youtu.be/xyz`
  const android = `29/09/2026 14:03 - As mensagens e ligações são protegidas com a criptografia de ponta a ponta.
29/09/2026 14:04 - Ana Souza: ouçam isso
https://open.spotify.com/album/abc
29/09/2026 14:07 - +55 11 91234-5678: https://thenecks.bandcamp.com/album/buoyant.`
  assert.deepEqual(parseChat(iphone), [
    { name: 'Ana', url: 'https://open.spotify.com/album/abc', at: '2026-09-29T17:03:11Z' },
    { name: 'Bruno', url: 'https://www.youtube.com/watch?v=xyz', at: '2026-09-29T17:05:00Z' },
  ])
  assert.deepEqual(parseChat(android), [
    { name: 'Ana', url: 'https://open.spotify.com/album/abc', at: '2026-09-29T17:04:00Z' },
    { name: '+55 11 91234-5678', url: 'https://thenecks.bandcamp.com/album/buoyant', at: '2026-09-29T17:07:00Z' },
  ])
})
