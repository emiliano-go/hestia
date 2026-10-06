export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function inlineMd(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
    )
}

export function mdToHtml(md) {
  const blocks = []
  let text = escapeHtml(md).replace(/```([^\n]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    blocks.push('<pre><code>' + code.replace(/\n$/, '') + '</code></pre>')
    return '__MD_BLOCK_' + (blocks.length - 1) + '__MD_BLOCK_'
  })
  const lines = text.split('\n')
  const out = []
  let list = []
  let para = []
  const flushList = () => {
    if (list.length) {
      out.push('<ul>' + list.map((li) => '<li>' + inlineMd(li) + '</li>').join('') + '</ul>')
      list = []
    }
  }
  const flushPara = () => {
    if (para.length) {
      out.push('<p>' + inlineMd(para.join(' ')) + '</p>')
      para = []
    }
  }
  for (const line of lines) {
    const t = line.trim()
    let m
    if ((m = /^######?\s+(.*)$/.exec(t))) {
      flushList()
      flushPara()
      out.push('<h3>' + inlineMd(m[1]) + '</h3>')
    } else if ((m = /^####\s+(.*)$/.exec(t))) {
      flushList()
      flushPara()
      out.push('<h2>' + inlineMd(m[1]) + '</h2>')
    } else if ((m = /^###\s+(.*)$/.exec(t))) {
      flushList()
      flushPara()
      out.push('<h2>' + inlineMd(m[1]) + '</h2>')
    } else if ((m = /^##\s+(.*)$/.exec(t))) {
      flushList()
      flushPara()
      out.push('<h2>' + inlineMd(m[1]) + '</h2>')
    } else if ((m = /^#\s+(.*)$/.exec(t))) {
      flushList()
      flushPara()
      out.push('<h1>' + inlineMd(m[1]) + '</h1>')
    } else if ((m = /^[-*]\s+(.*)$/.exec(t))) {
      flushPara()
      list.push(m[1])
    } else if (t === '') {
      flushList()
      flushPara()
    } else {
      flushList()
      para.push(t)
    }
  }
  flushList()
  flushPara()
  return out
    .join('\n')
    .replace(/__MD_BLOCK_(\d+)__MD_BLOCK_/g, (m, i) => blocks[parseInt(i, 10)])
}
