const SEED_TAGS = ['jazz', 'ambient', 'experimental', 'brasileira', 'pós-punk', 'shoegaze', 'eletrônica', 'indie', 'instrumental', 'clássica', 'groove', 'rock']
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

const $ = (sel) => document.querySelector(sel)

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag)
  Object.entries(attrs).forEach(([k, v]) => {
    if (v == null || v === false) return
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else el.setAttribute(k, v === true ? '' : v)
  })
  el.append(...children.flat().filter((c) => c != null && c !== false))
  return el
}

const api = async (path, init = {}) => {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'algo deu errado'), { status: res.status })
  return data
}

const state = { me: null, recs: [], users: [], tags: [], filter: { kind: '', user: '', tag: '', q: '' } }

const hash = (s) => [...s].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)
const pick = (list, key) => list[hash(key.toLowerCase()) % list.length]

const relative = (iso) => {
  const s = (new Date(iso).getTime() - Date.now()) / 1000
  const fmt = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
  const steps = [[60, 'second', 1], [3600, 'minute', 60], [86400, 'hour', 3600], [604800, 'day', 86400], [2629800, 'week', 604800], [31557600, 'month', 2629800], [Infinity, 'year', 31557600]]
  const [, unit, size] = steps.find(([limit]) => Math.abs(s) < limit)
  return fmt.format(Math.round(s / size), unit)
}

const safeHref = (url) => (url && /^https?:\/\//.test(url) ? url : null)

const avatar = (name) => h('span', { class: 'avatar', style: `background:${pick(TONES, name)}`, 'aria-hidden': 'true' }, name.trim()[0]?.toUpperCase() ?? '?')

const artwork = (r) => {
  if (r.cover_url) return h('img', { src: r.cover_url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
  const [bg, fg] = pick(COVERS, `${r.artist}${r.title}`)
  return h('span', { class: 'art', style: `position:absolute;inset:0;background:${bg}` }, h('span', { class: 'sun', style: `background:${fg}` }))
}

const pill = (label, pressed, onclick, n) =>
  h('button', { class: 'pill', 'aria-pressed': String(pressed), onclick }, label, n != null ? h('span', { class: 'n' }, String(n)) : null)

const paintSession = () =>
  $('#session').replaceChildren(
    ...(state.me
      ? [h('span', {}, 'você é ', h('strong', {}, state.me.name)), h('button', { class: 'link', onclick: logout }, 'sair')]
      : [h('button', { class: 'link', onclick: () => openLogin() }, 'entrar')]),
  )

const paintFilters = () => {
  const f = state.filter
  document.querySelectorAll('#kindFilter button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === f.kind)))
  $('#peopleBlock').hidden = state.users.length === 0
  $('#people').replaceChildren(
    ...state.users.map((u) =>
      h(
        'button',
        { class: 'person', 'aria-pressed': String(String(u.id) === f.user), onclick: () => setFilter({ user: String(u.id) === f.user ? '' : String(u.id) }) },
        avatar(u.name),
        u.name,
        h('span', { class: 'n' }, String(u.recs)),
      ),
    ),
  )
  $('#tagsBlock').hidden = state.tags.length === 0
  $('#tags').replaceChildren(...state.tags.slice(0, 20).map(({ tag, count }) => pill(tag, tag === f.tag, () => setFilter({ tag: tag === f.tag ? '' : tag }), count)))
}

const post = (r) => {
  const href = safeHref(r.url)
  const coverBox = href
    ? h('a', { class: 'cover', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `ouvir ${r.title}` }, artwork(r))
    : h('div', { class: 'cover' }, artwork(r))
  const note = r.description ? h('p', { class: `note${r.description.length > 320 ? ' clamped' : ''}` }, r.description) : null
  const more = note?.classList.contains('clamped')
    ? h('button', { class: 'link', onclick: (e) => { note.classList.toggle('clamped'); e.target.textContent = note.classList.contains('clamped') ? 'ler tudo' : 'recolher' } }, 'ler tudo')
    : null
  const mine = state.me?.id === r.user_id
  return h(
    'article',
    { class: 'post', id: `rec-${r.id}` },
    h(
      'div',
      { class: 'post-head' },
      avatar(r.user_name),
      h('span', {}, h('strong', {}, r.user_name), ` pôs ${r.kind === 'album' ? 'um disco' : 'uma faixa'} na estante · ${relative(r.created_at)}`),
    ),
    h(
      'div',
      { class: 'post-body' },
      coverBox,
      h(
        'div',
        { class: 'post-text' },
        h('h3', {}, r.title),
        h('p', { class: 'artist' }, r.artist, r.year ? ` · ${r.year}` : ''),
        note,
        more,
        h(
          'div',
          { class: 'post-actions' },
          href ? h('a', { class: 'listen', href, target: '_blank', rel: 'noopener noreferrer' }, 'ouvir') : null,
          r.tags.map((t) => pill(`#${t}`, t === state.filter.tag, () => setFilter({ tag: t === state.filter.tag ? '' : t }))),
          mine ? h('button', { class: 'link remove', onclick: () => remove(r) }, 'tirar da estante') : null,
        ),
      ),
    ),
  )
}

const paintMini = () => {
  const recent = state.recs.slice(0, 9)
  $('#miniBlock').hidden = recent.length === 0 || Object.values(state.filter).some(Boolean)
  $('#mini').replaceChildren(...recent.map((r) => h('a', { href: `#rec-${r.id}`, title: `${r.title} · ${r.artist}` }, artwork(r))))
}

const paintShelf = () => {
  const n = state.recs.length
  const filtered = Object.values(state.filter).some(Boolean)
  $('#count').textContent = filtered ? `${n} ${n === 1 ? 'recomendação' : 'recomendações'} neste recorte` : ''
  $('#shelf').replaceChildren(
    ...(n
      ? state.recs.map(post)
      : [
          h(
            'div',
            { class: 'empty' },
            h('strong', {}, filtered ? 'Nada neste recorte.' : 'A estante está vazia.'),
            filtered ? 'Tente outro filtro, ou limpe a busca.' : 'Cole acima o link do disco que você não para de ouvir.',
          ),
        ]),
  )
}

const paint = () => {
  $('#rightSide').hidden = false
  paintSession()
  paintFilters()
  paintShelf()
  paintMini()
}

const paintGate = () => {
  $('#rightSide').hidden = true
  paintSession()
  paintFilters()
  $('#count').textContent = ''
  $('#miniBlock').hidden = true
  $('#shelf').replaceChildren(
    h(
      'div',
      { class: 'empty' },
      h('strong', {}, 'A estante é só do grupo.'),
      'Entre com seu nome e o código que circulou no WhatsApp.',
      h('button', { class: 'primary', onclick: () => openLogin() }, 'entrar'),
    ),
  )
}

const loadRecs = async () => {
  const q = new URLSearchParams(Object.entries(state.filter).filter(([, v]) => v))
  state.recs = await api(`/recs?${q}`)
  paint()
}

const loadAll = async () => {
  state.me = await api('/me').catch(() => null)
  if (!state.me) return paintGate()
  const [users, tags] = await Promise.all([api('/users'), api('/tags')])
  Object.assign(state, { users, tags })
  await loadRecs()
}

const setFilter = (patch) => {
  state.filter = { ...state.filter, ...patch }
  loadRecs()
}

const debounce = (fn, ms) => {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

const openLogin = (then) => {
  const dialog = $('#loginDialog')
  dialog.returnValue = ''
  $('#loginError').textContent = ''
  dialog.onclose = () => dialog.returnValue === 'ok' && then?.()
  dialog.showModal()
}

const logout = async () => {
  await api('/logout', { method: 'POST' })
  Object.assign(state, { me: null, recs: [], users: [], tags: [] })
  paintGate()
}

const remove = async (r) => {
  if (!confirm(`Tirar "${r.title}" da estante?`)) return
  await api(`/recs/${r.id}`, { method: 'DELETE' })
  await loadAll()
}

const readTags = (raw) => raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)

const paintTagPicker = () => {
  const input = $('#tagsInput')
  const chosen = readTags(input.value)
  const pool = [...new Set([...state.tags.map((t) => t.tag), ...SEED_TAGS])].slice(0, 16)
  const toggle = (t) => {
    input.value = (chosen.includes(t) ? chosen.filter((c) => c !== t) : [...chosen, t]).join(', ')
    paintTagPicker()
  }
  $('#tagPicker').replaceChildren(...pool.map((t) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(chosen.includes(t)), onclick: () => toggle(t) }, t)))
  $('#tagSuggestions').replaceChildren(...pool.map((t) => h('option', { value: t })))
}

const openAdd = (url = '') => {
  if (!state.me) return openLogin(() => openAdd(url))
  const form = $('#addForm')
  form.reset()
  $('#preview').hidden = true
  $('#previewCover').removeAttribute('src')
  $('#addError').textContent = ''
  paintTagPicker()
  $('#addDialog').showModal()
  if (url) {
    form.url.value = url
    fillFromLink()
  }
}

const fillFromLink = async () => {
  const form = $('#addForm')
  const url = form.url.value.trim()
  if (!url) return
  $('#preview').hidden = false
  $('#previewStatus').textContent = 'lendo o link…'
  try {
    const m = await api(`/meta?url=${encodeURIComponent(url)}`)
    form.kind.value = m.kind
    form.title.value ||= m.title
    form.artist.value ||= m.artist
    form.year.value ||= m.year ?? ''
    form.cover_url.value = m.cover_url ?? ''
    m.cover_url ? $('#previewCover').setAttribute('src', m.cover_url) : $('#previewCover').removeAttribute('src')
    $('#previewStatus').textContent = `${m.kind === 'album' ? 'disco' : 'faixa'} · ${m.artist}`
    form.description.focus()
  } catch (e) {
    $('#previewStatus').textContent = e.status === 401 ? 'entre para ler links' : 'não consegui ler esse link; preencha à mão'
  }
}

const submitAdd = async (e) => {
  if (e.submitter?.value === 'cancel') return
  e.preventDefault()
  const form = e.target
  const button = e.submitter
  button.disabled = true
  try {
    await api('/recs', {
      method: 'POST',
      body: {
        kind: form.kind.value,
        title: form.title.value,
        artist: form.artist.value,
        year: form.year.value || null,
        url: form.url.value || null,
        cover_url: form.cover_url.value || null,
        tags: readTags(form.tags.value),
        description: form.description.value,
      },
    })
    $('#addDialog').close()
    $('#composerUrl').value = ''
    await loadAll()
  } catch (err) {
    if (err.status === 401) {
      $('#addDialog').close()
      openLogin(openAdd)
    }
    $('#addError').textContent = err.message
  } finally {
    button.disabled = false
  }
}

const submitLogin = async (e) => {
  if (e.submitter?.value === 'cancel') return
  e.preventDefault()
  const form = e.target
  try {
    state.me = await api('/login', { method: 'POST', body: { name: form.name.value, code: form.code.value } })
    $('#loginDialog').close('ok')
    await loadAll()
  } catch (err) {
    $('#loginError').textContent = err.message
  }
}

const boot = () => {
  $('#kindFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (b) setFilter({ kind: b.dataset.kind })
  })
  $('#search').addEventListener('input', debounce((e) => setFilter({ q: e.target.value.trim() }), 220))
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault()
    openAdd($('#composerUrl').value.trim())
  })
  $('#composerUrl').addEventListener('paste', (e) => {
    const url = e.clipboardData?.getData('text')?.trim()
    if (url && /^https?:\/\//.test(url)) {
      e.preventDefault()
      $('#composerUrl').value = url
      openAdd(url)
    }
  })
  $('#addForm').addEventListener('submit', submitAdd)
  $('#loginForm').addEventListener('submit', submitLogin)
  $('#addForm').url.addEventListener('change', fillFromLink)
  $('#tagsInput').addEventListener('input', paintTagPicker)
  loadAll().catch((e) => {
    $('#count').textContent = `não consegui abrir a estante: ${e.message}`
  })
}

boot()
