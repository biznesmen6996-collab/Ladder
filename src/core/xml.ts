/** Minimalny parser i generator XML — bez zależności, działa też poza przeglądarką. */

export interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

export class XmlError extends Error {}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9A-Fa-f]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return isNaN(code) ? m : String.fromCodePoint(code)
    }
    return ENTITIES[e] ?? m
  })
}

export function escapeXml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string))
}

export function parseXml(src: string): XmlNode {
  let i = 0
  const skipWs = () => { while (i < src.length && /\s/.test(src[i])) i++ }

  const parseNode = (): XmlNode | null => {
    skipWs()
    if (src[i] !== '<') return null
    if (src.startsWith('<!--', i)) { i = src.indexOf('-->', i) + 3; return parseNode() }
    if (src.startsWith('<?', i)) { i = src.indexOf('?>', i) + 2; return parseNode() }
    if (src.startsWith('<![CDATA[', i)) { i = src.indexOf(']]>', i) + 3; return parseNode() }
    if (src.startsWith('<!', i)) { i = src.indexOf('>', i) + 1; return parseNode() }
    i++ // <
    const nameEnd = /[\s/>]/.exec(src.slice(i))
    if (!nameEnd) throw new XmlError('Uszkodzony dokument XML')
    const tag = src.slice(i, i + nameEnd.index)
    i += nameEnd.index
    const attrs: Record<string, string> = {}
    for (;;) {
      skipWs()
      if (src[i] === '/' || src[i] === '>') break
      const am = /^([^\s=/>]+)\s*(=\s*("([^"]*)"|'([^']*)'))?/.exec(src.slice(i))
      if (!am) { i++; continue }
      attrs[am[1]] = decodeEntities(am[4] ?? am[5] ?? '')
      i += am[0].length
    }
    const node: XmlNode = { tag, attrs, children: [], text: '' }
    if (src[i] === '/') { i += 2; return node }
    i++ // >
    for (;;) {
      const lt = src.indexOf('<', i)
      if (lt < 0) { node.text += decodeEntities(src.slice(i)); i = src.length; break }
      node.text += decodeEntities(src.slice(i, lt))
      if (src.startsWith('</', lt)) { i = src.indexOf('>', lt) + 1; break }
      if (src.startsWith('<![CDATA[', lt)) {
        const end = src.indexOf(']]>', lt)
        node.text += src.slice(lt + 9, end)
        i = end + 3
        continue
      }
      i = lt
      const child = parseNode()
      if (child) node.children.push(child)
      else break
    }
    node.text = node.text.trim()
    return node
  }

  const root = parseNode()
  if (!root) throw new XmlError('Brak elementu głównego')
  return root
}

/** Nazwa znacznika bez przedrostka przestrzeni nazw. */
export const localName = (n: XmlNode) => n.tag.replace(/^.*:/, '')

export function findAll(node: XmlNode, tag: string): XmlNode[] {
  const out: XmlNode[] = []
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (localName(c) === tag) out.push(c)
      walk(c)
    }
  }
  walk(node)
  return out
}

export function child(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find((c) => localName(c) === tag)
}

export function children(node: XmlNode, tag: string): XmlNode[] {
  return node.children.filter((c) => localName(c) === tag)
}

/* --------------------------- generowanie --------------------------- */

export class XmlWriter {
  private parts: string[] = []
  private depth = 0

  constructor(declaration = true) {
    if (declaration) this.parts.push('<?xml version="1.0" encoding="utf-8"?>')
  }

  private indent() { return '  '.repeat(this.depth) }

  open(tag: string, attrs: Record<string, string | number | boolean | undefined> = {}) {
    this.parts.push(`${this.indent()}<${tag}${attrStr(attrs)}>`)
    this.depth++
    return this
  }

  close(tag: string) {
    this.depth--
    this.parts.push(`${this.indent()}</${tag}>`)
    return this
  }

  empty(tag: string, attrs: Record<string, string | number | boolean | undefined> = {}) {
    this.parts.push(`${this.indent()}<${tag}${attrStr(attrs)}/>`)
    return this
  }

  leaf(tag: string, text: string, attrs: Record<string, string | number | boolean | undefined> = {}) {
    this.parts.push(`${this.indent()}<${tag}${attrStr(attrs)}>${escapeXml(text)}</${tag}>`)
    return this
  }

  raw(text: string) {
    this.parts.push(text.split('\n').map((l) => this.indent() + l).join('\n'))
    return this
  }

  toString() { return this.parts.join('\n') + '\n' }
}

function attrStr(attrs: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join('')
}
