const DESIGNS = [
  ['Main', '1 · Espectrograma'],
  ['Encarte', '2 · Encarte de jazz'],
  ['Lombadas', '3 · Lombadas'],
  ['Xerox', '4 · Xerox'],
  ['Esquina', '5 · Esquina'],
]

const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g

const lookup = (scope, path) =>
  path === 'true' ? true : path === 'false' ? false : path.split('.').reduce((v, k) => (v == null ? v : v[k]), scope)

const fill = (text, scope) => text.replace(HOLE, (_, p) => String(lookup(scope, p) ?? ''))

const expand = (node, scope) => {
  if (node.nodeType === Node.TEXT_NODE) return [document.createTextNode(fill(node.textContent, scope))]
  if (node.nodeType !== Node.ELEMENT_NODE) return []
  const tag = node.tagName.toLowerCase()
  const children = (s) => [...node.childNodes].flatMap((c) => expand(c, s))
  if (tag === 'sc-for') {
    const list = lookup(scope, node.getAttribute('list').replace(HOLE, '$1').trim()) ?? []
    const as = node.getAttribute('as')
    return list.flatMap((item, i) => children({ ...scope, [as]: item, $index: i }))
  }
  if (tag === 'sc-if') return lookup(scope, node.getAttribute('value').replace(HOLE, '$1').trim()) ? children(scope) : []
  const el = document.createElement(tag)
  ;[...node.attributes].forEach((a) => el.setAttribute(a.name, fill(a.value, scope)))
  el.append(...children(scope))
  return [el]
}

class DCLogic {
  constructor() {
    this.props = {}
    this.state = {}
  }
  setState() {}
}

const render = async (name) => {
  const source = await (await fetch(`./${name}.dc.html`)).text()
  const doc = new DOMParser().parseFromString(source, 'text/html')
  const root = doc.querySelector('x-dc')
  const helmet = root.querySelector('helmet')
  document.head.append(...[...helmet.children].map((c) => c.cloneNode(true)))
  helmet.remove()
  const Component = new Function('DCLogic', `${doc.querySelector('script[data-dc-script]').textContent}; return Component`)(DCLogic)
  const vals = new Component().renderVals()
  document.querySelector('#stage').replaceChildren(...[...root.childNodes].flatMap((c) => expand(c, vals)))
}

const current = new URLSearchParams(location.search).get('d') ?? 'Main'
document.querySelector('#nav').append(
  ...DESIGNS.map(([id, label]) =>
    Object.assign(document.createElement('a'), { href: `?d=${id}`, textContent: label, ...(id === current ? { ariaCurrent: 'page' } : {}) }),
  ),
)
render(current).catch((e) => {
  document.querySelector('#error').textContent = e.stack
})
