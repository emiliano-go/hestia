import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from './api.js'
import { loginWithPasskey, passkeysSupported, registerPasskey } from './auth.js'

// ---------- helpers ----------

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d) ? String(s) : d.toLocaleString()
}

function relDate(s) {
  const d = new Date(s)
  if (isNaN(d)) return ''
  const diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}

function truncate(str, n = 120) {
  if (!str) return ''
  str = String(str)
  return str.length > n ? str.slice(0, n) + '...' : str
}

const GLOBAL_VIEWS = ['home', 'help', 'search', 'agents', 'gallery', 'reminders', 'watches']
const PROJECT_VIEWS = [
  'welcome',
  'chat',
  'goals',
  'tasks',
  'roadmap',
  'github',
  'activity',
  'automations',
  'files',
  'memory',
  'background',
  'capture',
  'about',
]

function parseHash(hash) {
  const raw = (hash || '').replace(/^#\/?/, '')
  if (!raw) return null
  const [path, query] = raw.split('?')
  const params = new URLSearchParams(query || '')
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'p' && parts[1]) {
    const action = params.get('action')
    return {
      projectId: Number(parts[1]),
      view: {
        type: PROJECT_VIEWS.includes(parts[2]) ? parts[2] : 'welcome',
        ...(action ? { action } : {}),
      },
      session: params.get('session') ? Number(params.get('session')) : null,
    }
  }
  if (parts[0] === 'g' && GLOBAL_VIEWS.includes(parts[1])) {
    return { view: { type: parts[1] } }
  }
  if (parts[0] && GLOBAL_VIEWS.includes(parts[0])) {
    return { view: { type: parts[0] } }
  }
  return null
}

function viewHash(projectId, view, chatSessionId) {
  if (view.type === 'reminders' || view.type === 'watches') return `#/g/${view.type}`
  if (['home', 'help', 'search', 'agents', 'gallery'].includes(view.type)) {
    return `#/${view.type}`
  }
  if (projectId && PROJECT_VIEWS.includes(view.type)) {
    const params = new URLSearchParams()
    if (view.type === 'chat' && chatSessionId) params.set('session', chatSessionId)
    if (view.action && view.action !== 'chat') params.set('action', view.action)
    const q = params.toString() ? `?${params.toString()}` : ''
    return `#/p/${projectId}/${view.type}${q}`
  }
  return '#/home'
}

function useAsync(fn, deps) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    fn()
      .then(setData)
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    reload()
  }, [reload])
  return { data, error, loading, reload }
}

// ---------- icons ----------

const ICON_PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5 9.7V21h5.5v-6h3v6H19V9.7',
  flame:
    'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z',
  plus: 'M12 5v14M5 12h14',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  files: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  memory:
    'M9.5 2A5.5 5.5 0 0 0 4 7.5v.5a4 4 0 0 0 0 8v.5A5.5 5.5 0 0 0 14.5 22 5.5 5.5 0 0 0 20 16.5v-.5a4 4 0 0 0 0-8v-.5A5.5 5.5 0 0 0 14.5 2zM9 9h6M9 13h6M9 17h4',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  agents:
    'M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  gallery:
    'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-4.5-4.5L6 21',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14h5M9.5 8h5M17.5 16h5',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  x: 'M18 6 6 18M6 6l12 12',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8L16.5 17.5l1.8-.7z',
  refresh:
    'M21 4v6h-6M3 20v-6h6M3.5 9a8 8 0 0 1 13.2-3L21 10M21 15a8 8 0 0 1-13.2 3L3 14',
  git: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  check: 'M20 6 9 17l-5-5',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l3 2',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  menu: 'M3 6h18M3 12h18M3 18h18',
  tasks: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  play: 'M6 4l14 8-14 8z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
}

function Icon({ name, size = 16, ...rest }) {
  const d = ICON_PATHS[name]
  if (!d) return null
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={d} />
    </svg>
  )
}

// ---------- theme ----------

const THEME_KEY = 'home-theme'

const DEFAULT_THEME = {
  '--content-bg': '#262624',
  '--sidebar-bg': '#1f1e1d',
  '--surface': '#30302e',
  '--border': '#3d3d3a',
  '--fg': '#f5f4ef',
  '--muted': '#8f8d86',
  '--accent': '#d97757',
  '--ok': '#6a9955',
  '--err': '#e06c5a',
}

const LIGHT_THEME = {
  '--content-bg': '#faf9f5',
  '--sidebar-bg': '#f0eee8',
  '--surface': '#ffffff',
  '--border': '#d9d4c9',
  '--fg': '#2b2a27',
  '--muted': '#6f6d66',
  '--accent': '#c96442',
  '--ok': '#4f7a3f',
  '--err': '#c0392b',
}

const THEME_LABELS = {
  '--content-bg': 'Content background',
  '--sidebar-bg': 'Sidebar background',
  '--surface': 'Surface',
  '--border': 'Border',
  '--fg': 'Text',
  '--muted': 'Muted text',
  '--accent': 'Accent',
  '--ok': 'Success',
  '--err': 'Danger',
}

const THEME_MODES = [
  ['system', 'Follow system'],
  ['light', 'Light'],
  ['dark', 'Dark'],
]

// Optional dark palettes; "Home" is the built-in warm default (no overrides).
const THEME_PRESETS = {
  'titan-black': {
    '--content-bg': '#101018',
    '--sidebar-bg': '#0c0c14',
    '--surface': '#1b1b28',
    '--border': '#2a2a3c',
    '--fg': '#d4d4e0',
    '--muted': '#9a9aac',
    '--accent': '#6ab0cf',
    '--ok': '#70b090',
    '--err': '#d06060',
  },
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

function mixColors(a, b, t) {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  if (!ca || !cb) return a
  return rgbToHex(ca.map((v, i) => v + (cb[i] - v) * t))
}

function rgba(hex, alpha) {
  const rgb = hexToRgb(hex)
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : hex
}

function luminance(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function readableOn(hex) {
  return luminance(hex) > 0.2 ? '#20130c' : '#ffffff'
}

function systemMode() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function effectiveMode(state) {
  return state.mode === 'system' ? systemMode() : state.mode
}

function defaultThemeState() {
  return { mode: 'system', themes: { dark: {}, light: {} } }
}

function loadThemeState() {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (!raw) return defaultThemeState()
    const parsed = JSON.parse(raw)
    if (parsed && parsed.themes) {
      return {
        mode: THEME_MODES.some(([m]) => m === parsed.mode) ? parsed.mode : 'system',
        themes: { dark: parsed.themes.dark || {}, light: parsed.themes.light || {} },
      }
    }
    if (parsed && Object.keys(parsed).some((k) => k.startsWith('--'))) {
      // legacy single palette: keep it as dark-mode overrides
      return { mode: 'dark', themes: { dark: parsed, light: {} } }
    }
    return defaultThemeState()
  } catch (e) {
    return defaultThemeState()
  }
}

function saveThemeState(state) {
  const themes = {}
  for (const mode of ['dark', 'light']) {
    const base = mode === 'light' ? LIGHT_THEME : DEFAULT_THEME
    const clean = Object.fromEntries(
      Object.entries(state.themes[mode] || {}).filter(
        ([k, v]) => base[k] && hexToRgb(v) && v !== base[k]
      )
    )
    if (Object.keys(clean).length) themes[mode] = clean
  }
  if (state.mode === 'system' && Object.keys(themes).length === 0) {
    localStorage.removeItem(THEME_KEY)
  } else {
    localStorage.setItem(THEME_KEY, JSON.stringify({ mode: state.mode, themes }))
  }
}

function applyThemeState(state) {
  const mode = effectiveMode(state)
  const base = mode === 'light' ? LIGHT_THEME : DEFAULT_THEME
  const vars = { ...base, ...(state.themes[mode] || {}) }
  const root = document.documentElement.style
  root.setProperty('color-scheme', mode)
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v)

  const fg = vars['--fg']
  const contentBg = vars['--content-bg']
  const sidebarBg = vars['--sidebar-bg']
  const surface = vars['--surface']
  const border = vars['--border']
  const accent = vars['--accent']

  root.setProperty('--sidebar-bg-hover', mixColors(sidebarBg, fg, 0.06))
  root.setProperty('--sidebar-active', mixColors(sidebarBg, fg, 0.12))
  root.setProperty('--surface-2', mixColors(surface, fg, 0.05))
  root.setProperty('--surface-hover', mixColors(surface, fg, 0.09))
  root.setProperty('--border-soft', mixColors(border, contentBg, 0.45))
  root.setProperty('--fg-secondary', mixColors(fg, contentBg, 0.25))
  root.setProperty('--faint', mixColors(fg, contentBg, 0.5))
  root.setProperty('--accent-dim', mixColors(accent, '#000000', 0.18))
  root.setProperty(
    '--accent-hover',
    mode === 'light' ? mixColors(accent, '#000000', 0.08) : mixColors(accent, '#ffffff', 0.12)
  )
  root.setProperty('--accent-soft', rgba(accent, 0.14))
  root.setProperty('--ok-soft', rgba(vars['--ok'], 0.14))
  root.setProperty('--err-soft', rgba(vars['--err'], 0.14))
  root.setProperty('--on-accent', readableOn(accent))

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', contentBg)
}

// ---------- tiny markdown ----------

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inlineMd(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
    )
}

function mdToHtml(md) {
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

function fmtBytes(n) {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fmtTokens(n) {
  if (!n) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

// ---------- shared bits ----------

function Spinner({ size = 14 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />
}

function Skeleton({ className = '', style }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />
}

const TOOL_ICONS = {
  git_pull: 'refresh',
  git_log: 'git',
  git_diff: 'git',
  git_show: 'git',
  git_status: 'git',
  git_branches: 'git',
  repo_path: 'folder',
  list_files: 'files',
  read_file: 'files',
  grep: 'search',
  read_agents_md: 'info',
  list_docs: 'files',
  gh_commits: 'git',
  gh_prs: 'git',
  gh_issues: 'chat',
  gh_ci_runs: 'settings',
  memory_search: 'search',
  memory_get: 'memory',
  memory_list: 'memory',
  memory_create: 'plus',
  memory_update: 'refresh',
  memory_delete: 'x',
  workspace_write: 'files',
  workspace_read: 'files',
  workspace_list: 'folder',
  run_subagent: 'agents',
  agent_list: 'agents',
}

const TOOL_TITLES = {
  git_pull: 'Pull latest changes',
  git_log: 'Read commit history',
  git_diff: 'Diff changes',
  git_show: 'Show a commit',
  git_status: 'Check git status',
  git_branches: 'List branches',
  repo_path: 'Resolve repository path',
  list_files: 'List files',
  read_file: 'Read a file',
  grep: 'Search file contents',
  read_agents_md: 'Read AGENTS.md',
  list_docs: 'List docs',
  gh_commits: 'Fetch GitHub commits',
  gh_prs: 'Fetch pull requests',
  gh_issues: 'Fetch issues',
  gh_ci_runs: 'Fetch CI runs',
  memory_search: 'Search memory',
  memory_get: 'Get a memory',
  memory_list: 'List memories',
  memory_create: 'Write a memory',
  memory_update: 'Update a memory',
  memory_delete: 'Delete a memory',
  workspace_write: 'Write a workspace file',
  workspace_read: 'Read a workspace file',
  workspace_list: 'List workspace files',
  run_subagent: 'Delegate to a subagent',
  agent_list: 'List agent profiles',
}

function ToolRun({ name, args, result }) {
  const [open, setOpen] = useState(false)
  const status = !result ? 'running' : result.ok ? 'ok' : 'error'
  const label = status === 'running' ? 'Running' : status === 'ok' ? 'Done' : 'Failed'
  const summary = result ? result.preview : JSON.stringify(args)
  return (
    <div className={`tool-run ${status}`}>
      <button className="tool-run-head" onClick={() => setOpen((o) => !o)}>
        <span className="tool-run-icon">
          {status === 'running' ? (
            <Spinner size={14} />
          ) : (
            <Icon name={status === 'ok' ? 'check' : 'x'} size={14} />
          )}
        </span>
        <Icon name={TOOL_ICONS[name] || 'play'} size={14} className="tool-run-toolicon" />
        <span className="tool-run-name" title={TOOL_TITLES[name] || name}>
          {TOOL_TITLES[name] || name}
        </span>
        <span className="tool-run-arg">{truncate(summary, 72)}</span>
        <span className={`tool-run-badge ${status}`}>{label}</span>
        <span className={`tool-run-chevron ${open ? 'open' : ''}`}>
          <Icon name="chevronDown" size={14} />
        </span>
      </button>
      {open && (
        <div className="tool-run-body">
          <div className="tool-run-section">
            <div className="tool-run-label">Arguments</div>
            <pre>{JSON.stringify(args, null, 2)}</pre>
          </div>
          {result && (
            <div className="tool-run-section">
              <div className="tool-run-label">{result.ok ? 'Result' : 'Error'}</div>
              <pre className={result.ok ? '' : 'err'}>{String(result.preview ?? '')}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function pairToolRuns(events) {
  const runs = []
  for (const evt of events) {
    if (evt.event === 'tool_call') {
      runs.push({ name: evt.name, args: evt.arguments, result: null })
    } else if (evt.event === 'tool_result') {
      for (let i = runs.length - 1; i >= 0; i--) {
        if (runs[i].name === evt.name && !runs[i].result) {
          runs[i].result = evt
          break
        }
      }
    }
  }
  return runs
}

function parseToolArgs(value) {
  try {
    return typeof value === 'string' ? JSON.parse(value || '{}') : value || {}
  } catch (e) {
    return {}
  }
}

function messageItems(rows) {
  const items = []
  let last = null
  for (const m of rows) {
    if (m.role === 'user') {
      items.push({ kind: 'user', id: m.id, content: m.content })
      last = null
      continue
    }
    if (m.role === 'tool') {
      if (last) {
        const run = last.runs.find((r) => !r.result && r.name === m.name)
        if (run) run.result = { ok: m.ok !== false, preview: m.content }
      }
      continue
    }
    if (m.role === 'notification') {
      items.push({ kind: 'notification', id: m.id, content: m.content })
      last = null
      continue
    }
    let calls = []
    try {
      calls = m.tool_calls ? JSON.parse(m.tool_calls) : []
    } catch (e) {
      calls = []
    }
    const item = {
      kind: 'assistant',
      id: m.id,
      content: m.content,
      runs: calls.map((c) => ({
        name: c.function?.name || c.name || 'tool',
        args: parseToolArgs(c.function?.arguments ?? c.arguments),
        result: null,
      })),
    }
    items.push(item)
    last = item
  }
  return items
}

function clickable(onClick) {
  return {
    role: 'button',
    tabIndex: 0,
    onClick,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick(e)
      }
    },
  }
}

function Modal({ title, onClose, children }) {
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn modal-close" onClick={onClose} title="Close">
          <Icon name="x" size={16} />
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>,
    document.body
  )
}

function Composer({ onSend, busy, placeholder }) {
  const [value, setValue] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 200) + 'px'
    }
  }, [value])

  const submit = () => {
    const msg = value.trim()
    if (!msg || busy) return
    setValue('')
    onSend(msg)
  }

  return (
    <div className="composer">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="composer-foot">
        <span className="composer-hint">Enter to send, Shift+Enter for a new line</span>
        <button
          className="send-btn"
          onClick={submit}
          disabled={busy || !value.trim()}
          title="Send"
        >
          <Icon name="arrowUp" size={18} />
        </button>
      </div>
    </div>
  )
}

// ---------- add project modal ----------

function AddProjectModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)
  const [steps, setSteps] = useState([])
  const [percent, setPercent] = useState(null)
  const [detail, setDetail] = useState('')

  const submit = (e) => {
    e.preventDefault()
    setCreating(true)
    setError(null)
    setSteps([])
    setPercent(null)
    setDetail('')
    api
      .createProjectStream(
        { name, repo_url: repoUrl },
        {
          onEvent: (evt) => {
            if (evt.event === 'step') {
              setSteps((prev) => {
                const next = prev.filter((s) => s.step !== evt.step)
                const existing = prev.find((s) => s.step === evt.step)
                next.push({
                  step: evt.step,
                  label: evt.label || existing?.label || evt.step,
                  status: evt.status,
                })
                return next
              })
            } else if (evt.event === 'progress') {
              setPercent(evt.percent)
              if (evt.detail) setDetail(evt.detail)
            } else if (evt.event === 'error') {
              setError(evt.detail || 'Clone failed')
            } else if (evt.event === 'done') {
              onCreated(evt.project)
            }
          },
        }
      )
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setCreating(false))
  }

  return (
    <Modal title="Add project" onClose={creating ? () => {} : onClose}>
      <form className="form-col" onSubmit={submit}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={creating}
        />
        <input
          placeholder="Git URL"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          required
          disabled={creating}
        />
        <button className="btn primary" disabled={creating}>
          {creating ? 'Adding project…' : 'Add project'}
        </button>

        {creating && (
          <div className="clone-steps">
            {steps.map((s) => (
              <div key={s.step} className={`clone-step ${s.status}`}>
                <span className="clone-step-icon">
                  {s.status === 'done' ? '✓' : <Spinner size={12} />}
                </span>
                <span className="clone-step-label">{s.label}</span>
                {s.step === 'clone' && s.status === 'running' && percent != null && (
                  <span className="clone-step-pct">{percent}%</span>
                )}
              </div>
            ))}
            {detail && <div className="clone-detail">{detail}</div>}
          </div>
        )}

        {error && <div className="error-text">{error}</div>}
      </form>
    </Modal>
  )
}

// ---------- providers (settings modal) ----------

function ProvidersPanel() {
  const { data: providers, error, loading, reload } = useAsync(api.listProviders, [])
  const presetsReq = useAsync(api.listPresets, [])
  const [form, setForm] = useState({ name: '', base_url: '', api_key_env: '', model: '' })
  const [presetKey, setPresetKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const [testResults, setTestResults] = useState({})

  const presets = presetsReq.data || {}

  const applyPreset = (key) => {
    setPresetKey(key)
    const p = presets[key]
    if (p) {
      setForm({
        name: p.name || key,
        base_url: p.base_url || '',
        api_key_env: p.api_key_env || '',
        model: p.model || '',
      })
    }
  }

  const submit = (e) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    api
      .createProvider(form)
      .then(() => {
        setForm({ name: '', base_url: '', api_key_env: '', model: '' })
        setPresetKey('')
        reload()
      })
      .catch((err) => setFormError(err.message || String(err)))
      .finally(() => setSaving(false))
  }

  const test = (id) => {
    setTestResults((prev) => ({ ...prev, [id]: { testing: true } }))
    api
      .testProvider(id)
      .then((r) => setTestResults((prev) => ({ ...prev, [id]: r })))
      .catch((e) =>
        setTestResults((prev) => ({ ...prev, [id]: { ok: false, error: e.message } }))
      )
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div>
      <form className="form-col" onSubmit={submit}>
        <select value={presetKey} onChange={(e) => applyPreset(e.target.value)}>
          <option value="">Choose a preset...</option>
          {Object.entries(presets).map(([k, p]) => (
            <option key={k} value={k}>
              {p.name || k}
            </option>
          ))}
        </select>
        <input placeholder="Name" value={form.name} onChange={set('name')} required />
        <input placeholder="Base URL" value={form.base_url} onChange={set('base_url')} required />
        <input
          placeholder="API key env var"
          value={form.api_key_env}
          onChange={set('api_key_env')}
          required
        />
        <input placeholder="Model" value={form.model} onChange={set('model')} required />
        <button className="btn primary" disabled={saving}>
          {saving ? 'Saving...' : 'Add provider'}
        </button>
        {formError && <div className="error-text">{formError}</div>}
      </form>
      {loading && <p className="note">Loading...</p>}
      {error && <p className="error-text">{error}</p>}
      {providers && providers.length === 0 && <p className="note">No providers configured.</p>}
      <div className="cards">
        {(providers || []).map((p) => {
          const tr = testResults[p.id]
          return (
            <div key={p.id} className="card">
              <h3>
                {p.name}
                {tr && !tr.testing && (
                  <span className={`badge ${tr.ok ? 'ok' : 'err'}`}>
                    {tr.ok ? `ok: ${tr.model || p.model}` : 'error'}
                  </span>
                )}
              </h3>
              <div className="meta">{p.base_url}</div>
              <div className="meta">
                {p.model} (key: {p.api_key_env})
              </div>
              {tr && !tr.testing && !tr.ok && tr.error && (
                <div className="meta error-text">{tr.error}</div>
              )}
              <div className="row" style={{ marginTop: 10, marginBottom: 0 }}>
                <button className="btn" onClick={() => test(p.id)} disabled={tr?.testing}>
                  {tr?.testing ? 'Testing...' : 'Test'}
                </button>
                <button
                  className="btn danger"
                  onClick={() =>
                    api.deleteProvider(p.id).then(reload).catch((e) => alert(e.message))
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- agents page ----------

const TOOL_GROUPS = [
  {
    key: 'repo',
    label: 'Repository',
    desc: 'Git history, diffs, branches, and showing commits in the clone.',
  },
  { key: 'files', label: 'Files', desc: 'List, read, and search files in the repository.' },
  { key: 'github', label: 'GitHub', desc: 'Commits, pull requests, issues, and CI runs.' },
  { key: 'memory', label: 'Memory', desc: 'Read and write Totem project memory.' },
  {
    key: 'workspace',
    label: 'Workspace',
    desc: 'Write plans, specs, and docs to the project workspace.',
  },
  {
    key: 'tasks',
    label: 'Task board',
    desc: 'Create and move tasks on the project kanban. Main chat agents only.',
  },
  {
    key: 'agents',
    label: 'Delegation',
    desc: 'Hand subtasks to other agents. Main chat agents only.',
  },
]

const ALL_TOOLS = TOOL_GROUPS.map((g) => g.key)

function ToolGroupPicker({ value, onChange }) {
  const selected = new Set(value)
  const toggle = (k) => {
    const next = new Set(selected)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    onChange(TOOL_GROUPS.filter((g) => next.has(g.key)).map((g) => g.key))
  }
  return (
    <div className="tool-groups">
      {TOOL_GROUPS.map((g) => (
        <button
          type="button"
          key={g.key}
          className={`tool-group ${selected.has(g.key) ? 'on' : ''}`}
          onClick={() => toggle(g.key)}
        >
          <span className="tool-group-check">
            {selected.has(g.key) && <Icon name="check" size={12} />}
          </span>
          <span className="tool-group-text">
            <span className="tool-group-label">{g.label}</span>
            <span className="tool-group-desc">{g.desc}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function toTools(value) {
  if (Array.isArray(value)) return value
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function AgentForm({ providers, presets, initial, onSubmit, onCancel, saving, error, submitLabel }) {
  const [form, setForm] = useState(() => ({
    name: initial?.name || '',
    provider_id: initial?.provider_id ? String(initial.provider_id) : '',
    system_prompt: initial?.system_prompt || '',
    tools: toTools(initial?.tools),
    max_turns: initial?.max_turns != null ? String(initial.max_turns) : '6',
  }))
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const applyPreset = (key) => {
    const p = presets[key]
    if (!p) return
    setForm((f) => ({
      ...f,
      name: f.name || p.name || key,
      system_prompt: p.system_prompt || '',
      tools: toTools(p.tools),
      max_turns: p.max_turns != null ? String(p.max_turns) : f.max_turns,
    }))
  }
  const submit = (e) => {
    e.preventDefault()
    onSubmit({
      name: form.name,
      provider_id: form.provider_id ? parseInt(form.provider_id, 10) : undefined,
      system_prompt: form.system_prompt,
      tools: form.tools,
      max_turns: form.max_turns ? parseInt(form.max_turns, 10) : undefined,
    })
  }
  return (
    <form className="agent-form" onSubmit={submit}>
      {!initial && Object.keys(presets).length > 0 && (
        <label className="field">
          <span className="field-label">Start from a preset</span>
          <select defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
            <option value="">Blank agent</option>
            {Object.entries(presets).map(([k, p]) => (
              <option key={k} value={k}>
                {p.name || k}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="field-row">
        <label className="field">
          <span className="field-label">Name</span>
          <input value={form.name} onChange={set('name')} placeholder="default" required />
        </label>
        <label className="field">
          <span className="field-label">Provider / model</span>
          <select value={form.provider_id} onChange={set('provider_id')} required>
            <option value="">Choose a provider...</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.model})
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field">
        <span className="field-label">What this agent can do</span>
        <ToolGroupPicker
          value={form.tools}
          onChange={(tools) => setForm((f) => ({ ...f, tools }))}
        />
        <span className="field-hint">Leave everything off for a plain chat model.</span>
      </div>
      <label className="field narrow">
        <span className="field-label">Max tool turns</span>
        <input type="number" min="1" value={form.max_turns} onChange={set('max_turns')} />
      </label>
      <label className="field">
        <span className="field-label">System prompt (optional)</span>
        <textarea
          rows={4}
          value={form.system_prompt}
          onChange={set('system_prompt')}
          placeholder="Extra instructions prepended to every run for this agent."
        />
      </label>
      <div className="row" style={{ marginBottom: 0 }}>
        <button className="btn primary" disabled={saving}>
          {saving ? (
            <>
              <Spinner size={14} /> Saving
            </>
          ) : (
            submitLabel
          )}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {error && <div className="error-text">{error}</div>}
    </form>
  )
}

function SimpleAgentForm({ defaultAgent, providers, saving, error, onSave, onOpenSettings }) {
  const [providerId, setProviderId] = useState(
    defaultAgent?.provider_id ? String(defaultAgent.provider_id) : ''
  )
  const [prompt, setPrompt] = useState(defaultAgent?.system_prompt || '')

  const submit = (e) => {
    e.preventDefault()
    if (!providerId) return
    onSave({
      name: defaultAgent?.name || 'default',
      provider_id: parseInt(providerId, 10),
      system_prompt: prompt,
      tools: ALL_TOOLS,
      max_turns: defaultAgent?.max_turns || 10,
    })
  }

  if (providers.length === 0) {
    return (
      <div className="panel">
        <div className="placeholder">
          <div className="placeholder-icon">
            <Icon name="alert" size={18} />
          </div>
          <div className="placeholder-title">No providers configured</div>
          <div className="placeholder-hint">
            Add a provider and API key first, then come back to pick your agent.
          </div>
          <button className="btn primary" onClick={onOpenSettings}>
            <Icon name="settings" size={14} /> Open settings
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>One agent for everything</h3>
        <p>
          A single model and prompt handles chat, exploration, review, writing, and memory. This
          is all most setups need.
        </p>
      </div>
      <form className="agent-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Provider / model</span>
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)} required>
            <option value="">Choose a provider...</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.model})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">System prompt (optional)</span>
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Extra instructions prepended to every run."
          />
        </label>
        <div className="field-hint">
          This agent can do everything: repo, files, GitHub, memory, workspace, and delegation.
        </div>
        <button className="btn primary" disabled={saving}>
          {saving ? (
            <>
              <Spinner size={14} /> Saving
            </>
          ) : (
            'Save agent'
          )}
        </button>
        {error && <div className="error-text">{error}</div>}
      </form>
    </div>
  )
}

function AgentsPage({ onOpenSettings }) {
  const agentsReq = useAsync(api.listAgents, [])
  const providersReq = useAsync(api.listProviders, [])
  const presetsReq = useAsync(api.listAgentPresets, [])
  const actionsReq = useAsync(api.listActions, [])

  const [mode, setMode] = useState('simple')
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const [actionSaving, setActionSaving] = useState(null)

  const agents = agentsReq.data || []
  const providers = providersReq.data || []
  const presets = presetsReq.data || {}
  const actions = actionsReq.data || []
  const chatDefaultId = actions.find((a) => a.key === 'chat')?.agent_id
  const defaultAgent =
    agents.find((a) => a.id === chatDefaultId) || agents.find((a) => a.name === 'default') || null

  const providerName = (id) => providers.find((p) => p.id === id)?.name || id || 'default'
  const providerModel = (id) => providers.find((p) => p.id === id)?.model || ''

  const refresh = () => {
    agentsReq.reload()
    actionsReq.reload()
  }

  const saveSimple = (body) => {
    setSaving(true)
    setFormError(null)
    const req = defaultAgent ? api.updateAgent(defaultAgent.id, body) : api.createAgent(body)
    req
      .then((agent) => api.setActionDefault('chat', agent.id))
      .then(refresh)
      .catch((e) => setFormError(e.message || String(e)))
      .finally(() => setSaving(false))
  }

  const saveAgent = (body) => {
    setSaving(true)
    setFormError(null)
    const req = editing ? api.updateAgent(editing.id, body) : api.createAgent(body)
    req
      .then(() => {
        setShowForm(false)
        setEditing(null)
        refresh()
      })
      .catch((e) => setFormError(e.message || String(e)))
      .finally(() => setSaving(false))
  }

  const saveAction = (key, agentId) => {
    setActionSaving(key)
    api
      .setActionDefault(key, agentId)
      .then(() => actionsReq.reload())
      .catch((e) => alert(e.message))
      .finally(() => setActionSaving(null))
  }

  if (agentsReq.loading || providersReq.loading) {
    return (
      <div className="center-col">
        <div className="page-head">
          <h2>Agents</h2>
        </div>
        <Skeleton className="block-skeleton" />
        <Skeleton className="block-skeleton" style={{ marginTop: 12 }} />
      </div>
    )
  }

  return (
    <div className="center-col">
      <div className="page-head">
        <h2>Agents</h2>
        <div className="segmented">
          <button
            className={mode === 'simple' ? 'on' : ''}
            onClick={() => setMode('simple')}
          >
            Simple
          </button>
          <button
            className={mode === 'advanced' ? 'on' : ''}
            onClick={() => setMode('advanced')}
          >
            Advanced
          </button>
        </div>
      </div>

      {mode === 'simple' ? (
        <SimpleAgentForm
          key={defaultAgent?.id || 'new'}
          defaultAgent={defaultAgent}
          providers={providers}
          saving={saving}
          error={formError}
          onSave={saveSimple}
          onOpenSettings={onOpenSettings}
        />
      ) : (
        <div className="agents-advanced">
          <section className="panel">
            <div className="panel-head row-between">
              <div>
                <h3>Agent profiles</h3>
                <p>
                  Each profile binds a provider, a system prompt, and the tools it may use. Create
                  focused agents (explore, review, write) or extra models.
                </p>
              </div>
              {!showForm && (
                <button
                  className="btn primary"
                  onClick={() => {
                    setEditing(null)
                    setFormError(null)
                    setShowForm(true)
                  }}
                >
                  <Icon name="plus" size={14} /> New agent
                </button>
              )}
            </div>

            {showForm && (
              <AgentForm
                key={editing?.id || 'new'}
                providers={providers}
                presets={presets}
                initial={editing}
                saving={saving}
                error={formError}
                submitLabel={editing ? 'Save changes' : 'Create agent'}
                onSubmit={saveAgent}
                onCancel={() => {
                  setShowForm(false)
                  setEditing(null)
                }}
              />
            )}

            {agents.length === 0 && !showForm ? (
              <div className="placeholder">
                <div className="placeholder-icon">
                  <Icon name="agents" size={18} />
                </div>
                <div className="placeholder-title">No agent profiles yet</div>
                <div className="placeholder-hint">Create one to specialise a role or model.</div>
              </div>
            ) : (
              <div className="agent-list">
                {agents.map((a) => (
                  <div key={a.id} className="agent-card">
                    <div className="agent-card-main">
                      <div className="agent-card-name">
                        {a.name}
                        {a.id === chatDefaultId && <span className="badge accent">default</span>}
                      </div>
                      <div className="agent-card-meta">
                        {providerName(a.provider_id)} · {providerModel(a.provider_id) || 'model'} ·{' '}
                        {toTools(a.tools).length} tool groups · {a.max_turns} turns
                      </div>
                    </div>
                    <div className="agent-card-actions">
                      <button
                        className="btn"
                        onClick={() => {
                          setEditing(a)
                          setFormError(null)
                          setShowForm(true)
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn danger"
                        onClick={() =>
                          api
                            .deleteAgent(a.id)
                            .then(refresh)
                            .catch((e) => alert(e.message))
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Defaults per action</h3>
              <p>
                Leave an action on <em>Default agent</em> to use the main agent. Assign another
                profile to give that action its own model or prompt.
              </p>
            </div>
            <div className="action-list">
              {actions.map((a) => (
                <div key={a.key} className="action-row">
                  <div className="action-info">
                    <div className="action-label">{a.label}</div>
                    <div className="action-desc">{a.description}</div>
                  </div>
                  <select
                    value={a.agent_id ?? ''}
                    disabled={actionSaving === a.key}
                    onChange={(e) =>
                      saveAction(a.key, e.target.value ? parseInt(e.target.value, 10) : null)
                    }
                  >
                    <option value="">Default agent</option>
                    {agents.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

// ---------- file reader and views ----------

function FileReaderPane({ projectId, path, onClose }) {
  const [content, setContent] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setContent(null)
    setError(null)
    api
      .getWorkspaceFile(projectId, path)
      .then(setContent)
      .catch((e) => setError(e.message || String(e)))
  }, [projectId, path])

  return (
    <div className="reader">
      <div className="reader-head">
        <span className="fpath">{path}</span>
        <button className="btn" onClick={onClose}>
          Back
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {content === null && !error && <p className="note">Loading...</p>}
      {content !== null &&
        (/\.(md|markdown)$/i.test(path) ? (
          <div className="reader-body prose" dangerouslySetInnerHTML={{ __html: mdToHtml(content) }} />
        ) : (
          <pre>{content}</pre>
        ))}
    </div>
  )
}

function FilesView({ projectId }) {
  const { data, error, loading, reload } = useAsync(
    () => api.listWorkspace(projectId),
    [projectId]
  )
  const [selected, setSelected] = useState(null)
  const files = (data && data.files) || []

  if (selected) {
    return (
      <div className="center-col">
        <FileReaderPane
          projectId={projectId}
          path={selected}
          onClose={() => setSelected(null)}
        />
      </div>
    )
  }

  return (
    <div className="center-col">
      <div className="page-head">
        <h2>Files</h2>
        <button className="btn" onClick={reload} disabled={loading}>
          <Icon name="refresh" size={14} />
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && files.length === 0 && (
        <p className="empty">No workspace files yet. Ask the agent to write a plan or spec.</p>
      )}
      {files.map((f) => (
        <button key={f.path} className="file-row" onClick={() => setSelected(f.path)}>
          <span className="fpath">{f.path}</span>
          <span className="fsize">{fmtBytes(f.bytes)}</span>
        </button>
      ))}
    </div>
  )
}

function GalleryView() {
  const { data: items, error, loading, reload } = useAsync(api.listGallery, [])
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(null)

  const projects = [...new Set((items || []).map((i) => i.project))]
  const filtered = (items || []).filter((i) => !filter || i.project === filter)

  if (selected) {
    return (
      <div className="center-col">
        <FileReaderPane
          projectId={selected.project_id}
          path={selected.path}
          onClose={() => setSelected(null)}
        />
      </div>
    )
  }

  return (
    <div className="center-col">
      <div className="page-head">
        <h2>Gallery</h2>
        <div className="row" style={{ marginBottom: 0 }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button className="btn" onClick={reload} disabled={loading}>
            <Icon name="refresh" size={14} />
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p className="empty">No workspace files yet. Ask the agent to write a plan or spec.</p>
      )}
      <div className="cards">
        {filtered.map((f) => (
          <div
            key={`${f.project_id}:${f.path}`}
            className="card"
            onClick={() => setSelected(f)}
            style={{ cursor: 'pointer' }}
          >
            <h3>
              <span className="badge">{f.project}</span>
            </h3>
            <div className="meta" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
              {f.path}
            </div>
            <div className="meta">{fmtBytes(f.bytes)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- theme panel ----------

function AssistantPanel() {
  const { data, loading } = useAsync(api.getSettings, [])
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [prefs, setPrefs] = useState(null)
  const [newPref, setNewPref] = useState('')
  const [prefBusy, setPrefBusy] = useState(false)
  const [editPref, setEditPref] = useState(null)
  const [prefDraft, setPrefDraft] = useState('')

  useEffect(() => {
    if (data) setForm(data)
  }, [data])

  useEffect(() => {
    api
      .listPreferences()
      .then((r) => setPrefs(r.preferences || []))
      .catch(() => setPrefs([]))
  }, [])

  const addPref = () => {
    const text = newPref.trim()
    if (!text || prefBusy) return
    setPrefBusy(true)
    api
      .addPreference(text)
      .then((r) => {
        setPrefs(r.preferences || [])
        setNewPref('')
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setPrefBusy(false))
  }

  const removePref = (index) => {
    api
      .removePreference(index)
      .then((r) => setPrefs(r.preferences || []))
      .catch((err) => setError(err.message || String(err)))
  }

  const startEdit = (index) => {
    setEditPref(index)
    setPrefDraft((prefs || [])[index] || '')
  }

  const saveEdit = () => {
    const text = prefDraft.trim()
    if (!text) return
    api
      .setPreference(editPref, text)
      .then((r) => {
        setPrefs(r.preferences || [])
        setEditPref(null)
      })
      .catch((err) => setError(err.message || String(err)))
  }

  if (loading || !form) return <p className="note">Loading...</p>

  const field = (key, value) => {
    setSaved(false)
    setForm({ ...form, [key]: value })
  }

  const save = (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    api
      .updateSettings(form)
      .then((next) => {
        setForm(next)
        setSaved(true)
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setSaving(false))
  }

  return (
    <form className="agent-form" onSubmit={save}>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Your name</span>
          <input
            value={form.user_name || ''}
            onChange={(e) => field('user_name', e.target.value)}
            placeholder="How the agent should address you"
          />
        </label>
        <label className="field">
          <span className="field-label">Timezone</span>
          <input
            value={form.timezone || ''}
            onChange={(e) => field('timezone', e.target.value)}
            placeholder="Europe/Rome"
          />
          <span className="field-hint">IANA name; used for reminders and the briefing.</span>
        </label>
      </div>
      <label className="field">
        <span className="field-label">Standing instructions</span>
        <textarea
          rows={3}
          value={form.instructions || ''}
          onChange={(e) => field('instructions', e.target.value)}
          placeholder="Always injected into the agent's system prompt, e.g. 'Be concise. Prefer tests first.'"
        />
      </label>
      <div className="field">
        <span className="field-label">Standing preferences</span>
        <span className="field-hint">
          Always injected into every prompt. Add rules the agent must never forget.
        </span>
        <div className="pref-list">
          {(prefs || []).map((p, i) =>
            editPref === i ? (
              <div key={`edit-${i}`} className="pref-item">
                <input
                  autoFocus
                  value={prefDraft}
                  onChange={(e) => setPrefDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      saveEdit()
                    }
                    if (e.key === 'Escape') setEditPref(null)
                  }}
                />
                <button type="button" className="icon-btn" title="Save" onClick={saveEdit}>
                  <Icon name="check" size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Cancel"
                  onClick={() => setEditPref(null)}
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
            ) : (
              <div key={`${i}-${p}`} className="pref-item">
                <span>{p}</span>
                <button
                  type="button"
                  className="icon-btn"
                  title="Edit preference"
                  onClick={() => startEdit(i)}
                >
                  <Icon name="edit" size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Remove preference"
                  onClick={() => removePref(i)}
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
            )
          )}
          {prefs && prefs.length === 0 && <span className="note">No preferences yet.</span>}
        </div>
        <div className="row" style={{ marginBottom: 0 }}>
          <input
            value={newPref}
            onChange={(e) => setNewPref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addPref()
              }
            }}
            placeholder="e.g. Never use em dashes; use ; : , ( ) - instead"
          />
          <button
            type="button"
            className="btn"
            disabled={!newPref.trim() || prefBusy}
            onClick={addPref}
          >
            {prefBusy ? 'Adding' : 'Add'}
          </button>
        </div>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Daily briefing</span>
          <select
            value={form.briefing_enabled}
            onChange={(e) => field('briefing_enabled', e.target.value)}
          >
            <option value="0">Off</option>
            <option value="1">On</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Briefing time</span>
          <input
            type="time"
            value={form.briefing_time || '08:00'}
            onChange={(e) => field('briefing_time', e.target.value)}
          />
        </label>
      </div>
      <label className="dep-item" style={{ flex: 'none' }}>
        <input
          type="checkbox"
          checked={form.briefing_agent === '1'}
          onChange={(e) => field('briefing_agent', e.target.checked ? '1' : '0')}
        />
        Let the agent add commentary to the briefing
      </label>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Daily plan</span>
          <select
            value={form.daily_plan_enabled}
            onChange={(e) => field('daily_plan_enabled', e.target.value)}
          >
            <option value="0">Off</option>
            <option value="1">On</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Plan time</span>
          <input
            type="time"
            value={form.daily_plan_time || '08:30'}
            onChange={(e) => field('daily_plan_time', e.target.value)}
          />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Weekly review</span>
          <select
            value={form.weekly_review_enabled}
            onChange={(e) => field('weekly_review_enabled', e.target.value)}
          >
            <option value="0">Off</option>
            <option value="1">On</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Review day</span>
          <select
            value={form.weekly_review_day}
            onChange={(e) => field('weekly_review_day', e.target.value)}
          >
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
              <option key={d} value={String(i)}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Review time</span>
          <input
            type="time"
            value={form.weekly_review_time || '16:00'}
            onChange={(e) => field('weekly_review_time', e.target.value)}
          />
        </label>
      </div>
      <label className="dep-item" style={{ flex: 'none' }}>
        <input
          type="checkbox"
          checked={form.web_fetch_enabled === '1'}
          onChange={(e) => field('web_fetch_enabled', e.target.checked ? '1' : '0')}
        />
        Allow the agent to fetch web pages (watchers use this too)
      </label>
      <div className="row" style={{ marginBottom: 0 }}>
        <button className="btn primary" disabled={saving}>
          {saving ? (
            <>
              <Spinner size={14} /> Saving
            </>
          ) : (
            'Save settings'
          )}
        </button>
        {saved && <span className="note">Saved.</span>}
      </div>
      {error && <div className="error-text">{error}</div>}
    </form>
  )
}

function GithubPanel() {
  const { data, loading, reload } = useAsync(api.githubStatus, [])
  const { data: settings } = useAsync(api.getSettings, [])
  const [token, setToken] = useState('')
  const [clientId, setClientId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [device, setDevice] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    if (settings) setClientId(settings.github_oauth_client_id || '')
  }, [settings])

  useEffect(() => () => clearInterval(pollRef.current), [])

  if (loading) return <p className="note">Loading...</p>

  const run = (fn) => {
    setBusy(true)
    setError(null)
    fn()
      .then(() => reload())
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setBusy(false))
  }

  const connect = (e) => {
    e.preventDefault()
    if (!token.trim()) return
    setBusy(true)
    setError(null)
    api
      .githubConnect(token.trim())
      .then(() => {
        setToken('')
        reload()
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setBusy(false))
  }

  const startDevice = () => {
    setBusy(true)
    setError(null)
    api
      .githubDeviceStart()
      .then((d) => {
        setDevice(d)
        clearInterval(pollRef.current)
        pollRef.current = setInterval(
          () => {
            api
              .githubDevicePoll(d.device_code)
              .then((r) => {
                if (r.status === 'connected') {
                  clearInterval(pollRef.current)
                  setDevice(null)
                  reload()
                }
              })
              .catch((err) => {
                clearInterval(pollRef.current)
                setDevice(null)
                setError(err.message || String(err))
              })
          },
          Math.max(5, d.interval || 5) * 1000
        )
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setBusy(false))
  }

  const saveClientId = () => {
    setError(null)
    api
      .updateSettings({ github_oauth_client_id: clientId.trim() })
      .then(() => reload())
      .catch((err) => setError(err.message || String(err)))
  }

  const account = data || {}

  return (
    <div className="agent-form">
      {account.connected ? (
        <div className="github-account">
          {account.avatar_url && <img src={account.avatar_url} alt="" className="github-avatar" />}
          <div className="github-account-main">
            <div className="github-login">{account.login || 'connected'}</div>
            <div className="note">
              {account.source === 'env' ? 'Token from GITHUB_TOKEN (env)' : 'Token stored in Home'}
              {account.scopes?.length ? `, scopes: ${account.scopes.join(', ')}` : ''}
            </div>
          </div>
          <button
            className="btn danger"
            disabled={account.source === 'env'}
            title={account.source === 'env' ? 'Unset GITHUB_TOKEN to disconnect' : 'Disconnect'}
            onClick={() => run(api.githubDisconnect)}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <p className="note">
          No GitHub account connected. Public repositories work without one; connect for private
          repos, higher rate limits, and PR/issue writes.
        </p>
      )}
      {account.error && <p className="error-text">{account.error}</p>}
      {error && <p className="error-text">{error}</p>}

      <form className="row" onSubmit={connect}>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Personal access token (repo scope)"
        />
        <button className="btn primary" disabled={busy || !token.trim()}>
          {busy ? <Spinner size={13} /> : 'Connect'}
        </button>
      </form>

      <div className="row">
        <button
          className="btn"
          disabled={busy || !account.gh_cli}
          title={account.gh_cli ? 'Reuse the token from gh auth' : 'gh CLI not installed'}
          onClick={() => run(api.githubImportGh)}
        >
          <Icon name="git" size={13} /> Import from gh CLI
        </button>
      </div>

      <div className="field">
        <span className="field-label">Sign in with GitHub (device flow)</span>
        {device ? (
          <div className="device-flow">
            <div>
              Enter this code on GitHub: <code className="device-code">{device.user_code}</code>
            </div>
            <a href={device.verification_uri} target="_blank" rel="noreferrer">
              {device.verification_uri}
            </a>
            <div className="note">Waiting for approval...</div>
          </div>
        ) : (
          <div className="row" style={{ marginBottom: 0 }}>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="OAuth app client id"
            />
            <button type="button" className="btn" onClick={saveClientId} disabled={!clientId.trim()}>
              Save
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !clientId.trim()}
              onClick={startDevice}
            >
              Sign in
            </button>
          </div>
        )}
        <span className="field-hint">
          Create an OAuth app (device flow enabled) and paste its client id; no secret needed.
        </span>
      </div>
    </div>
  )
}

function ColorField({ label, value, onChange }) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const commit = () => {
    if (hexToRgb(draft)) onChange(draft)
    else setDraft(value)
  }

  return (
    <div className="theme-row">
      <label>{label}</label>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
    </div>
  )
}

function ThemePanel({ theme, setTheme }) {
  const [editMode, setEditMode] = useState(effectiveMode(theme))
  const base = editMode === 'light' ? LIGHT_THEME : DEFAULT_THEME
  const overrides = theme.themes[editMode] || {}
  const value = (key) => overrides[key] || base[key]

  const setColor = (key, raw) => {
    setTheme({
      ...theme,
      themes: { ...theme.themes, [editMode]: { ...overrides, [key]: raw } },
    })
  }

  return (
    <div className="theme-panel">
      <div className="field">
        <span className="field-label">Appearance</span>
        <div className="segmented">
          {THEME_MODES.map(([mode, label]) => (
            <button
              key={mode}
              className={theme.mode === mode ? 'on' : ''}
              onClick={() => setTheme({ ...theme, mode })}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="field-hint">
          Follow system switches automatically when your OS theme changes.
        </span>
      </div>

      <div className="field">
        <span className="field-label">Presets</span>
        <div className="row" style={{ marginBottom: 0 }}>
          <button
            className="btn"
            onClick={() => {
              setEditMode('dark')
              setTheme({ ...theme, themes: { ...theme.themes, dark: {} } })
            }}
          >
            Home (default)
          </button>
          <button
            className="btn"
            onClick={() => {
              setEditMode('dark')
              setTheme({
                ...theme,
                themes: { ...theme.themes, dark: { ...THEME_PRESETS['titan-black'] } },
              })
            }}
          >
            Titan Black
          </button>
        </div>
      </div>

      <div className="field">
        <span className="field-label">Customize palette</span>
        <div className="segmented">
          {['light', 'dark'].map((mode) => (
            <button
              key={mode}
              className={editMode === mode ? 'on' : ''}
              onClick={() => setEditMode(mode)}
            >
              {mode === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </div>

      <div className="theme-grid">
        {Object.entries(THEME_LABELS).map(([key, label]) => (
          <ColorField key={key} label={label} value={value(key)} onChange={(v) => setColor(key, v)} />
        ))}
      </div>

      <div className="row" style={{ marginBottom: 0 }}>
        <button
          className="btn"
          onClick={() =>
            setTheme({ ...theme, themes: { ...theme.themes, [editMode]: {} } })
          }
        >
          Reset {editMode} palette
        </button>
        <button className="btn" onClick={() => setTheme(defaultThemeState())}>
          Reset all
        </button>
      </div>
    </div>
  )
}

// ---------- skills page ----------

function SkillsView() {
  const { data, loading, error, reload } = useAsync(api.listSkills, [])
  const [source, setSource] = useState('')
  const [subpath, setSubpath] = useState('')
  const [installing, setInstalling] = useState(false)
  const [formError, setFormError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [viewing, setViewing] = useState(null)

  const skills = data || []

  const install = (e) => {
    e.preventDefault()
    if (!source.trim() || installing) return
    setInstalling(true)
    setFormError(null)
    setNotice(null)
    api
      .installSkill({ source: source.trim(), subpath: subpath.trim() || undefined })
      .then((installed) => {
        setSource('')
        setSubpath('')
        setNotice(`Installed ${installed.map((s) => s.name).join(', ')}`)
        reload()
      })
      .catch((err) => setFormError(err.message || String(err)))
      .finally(() => setInstalling(false))
  }

  const remove = (slug) => {
    api.deleteSkill(slug).then(reload).catch((err) => setFormError(err.message || String(err)))
  }

  const open = (slug) => {
    api
      .getSkill(slug)
      .then(setViewing)
      .catch((err) => setFormError(err.message || String(err)))
  }

  return (
    <div className="center-col wide">
      <div className="page-head">
        <h2>Skills</h2>
        <span className="muted">installable instruction packages for your agents</span>
      </div>
      {error && <p className="error-text">{error}</p>}
      {formError && <p className="error-text">{formError}</p>}
      {notice && <p className="muted">{notice}</p>}

      {loading ? (
        <div className="home-list">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="row-skeleton" />
          ))}
        </div>
      ) : skills.length === 0 ? (
        <SectionEmpty
          icon="sparkles"
          title="No skills installed"
          hint="Install a SKILL.md package from GitHub, npm, or an archive URL below."
        />
      ) : (
        <div className="home-list">
          {skills.map((s) => (
            <div key={s.slug} className="skill-row">
              <span className="home-row-main">
                <span className="home-row-title">{s.name}</span>
                <span className="home-row-sub">{s.description}</span>
                <span className="home-row-sub skill-source">{s.source}</span>
              </span>
              <button className="btn" onClick={() => open(s.slug)}>
                View
              </button>
              <button className="btn danger" title="Remove" onClick={() => remove(s.slug)}>
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form className="docs-card" onSubmit={install}>
        <div className="docs-head">
          <Icon name="plus" size={15} />
          <span>Install a skill</span>
        </div>
        <div className="field-row">
          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">Source</span>
            <input
              placeholder="owner/repo, npm:package, or https://…tar.gz"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={installing}
            />
          </label>
          <label className="field">
            <span className="field-label">Subpath (optional)</span>
            <input
              placeholder="skills/pdf"
              value={subpath}
              onChange={(e) => setSubpath(e.target.value)}
              disabled={installing}
            />
          </label>
        </div>
        <div className="row" style={{ marginBottom: 0 }}>
          <button className="btn primary" disabled={installing || !source.trim()}>
            {installing ? (
              <>
                <Spinner size={13} /> Installing…
              </>
            ) : (
              'Install'
            )}
          </button>
          <span className="muted skill-hint">
            GitHub <code>owner/repo</code> · npm <code>npm:pkg</code> · archive URL
          </span>
        </div>
      </form>

      {viewing && (
        <Modal title={viewing.name} onClose={() => setViewing(null)}>
          <pre className="skill-body">{viewing.body}</pre>
        </Modal>
      )}
    </div>
  )
}

// ---------- settings page ----------

const SETTINGS_TABS = [
  ['providers', 'Providers'],
  ['assistant', 'Assistant'],
  ['github', 'GitHub'],
  ['theme', 'Theme'],
]

function SettingsView({ tab, setTab, theme, setTheme }) {
  return (
    <div className="center-col">
      <div className="page-head">
        <h2>Settings</h2>
        <div className="segmented">
          {SETTINGS_TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'providers' && <ProvidersPanel />}
      {tab === 'assistant' && <AssistantPanel />}
      {tab === 'github' && <GithubPanel />}
      {tab === 'theme' && <ThemePanel theme={theme} setTheme={setTheme} />}
    </div>
  )
}

// ---------- background tasks ----------

const JOB_ACTIVE = ['queued', 'running']

function jobWallTime(job) {
  if (!job.started_at) return ''
  const end = job.finished_at ? new Date(job.finished_at) : new Date()
  const seconds = Math.max(0, Math.round((end - new Date(job.started_at)) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function BackgroundView({ projectId }) {
  const [jobs, setJobs] = useState([])
  const [error, setError] = useState(null)

  const load = () =>
    api
      .listJobs(projectId)
      .then(setJobs)
      .catch((e) => setError(e.message || String(e)))

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!jobs.some((j) => JOB_ACTIVE.includes(j.status))) return
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, projectId])

  const stop = (id) => api.stopJob(id).then(load).catch((e) => setError(e.message || String(e)))

  return (
    <div className="center-col">
      <div className="page-head">
        <h2>Background tasks</h2>
        <span className="muted">detached agent runs; the agent is notified when they finish</span>
      </div>
      {error && <p className="error-text">{error}</p>}
      {jobs.length === 0 && <p className="empty">No background tasks yet.</p>}
      <div className="cards">
        {jobs.map((j) => (
          <div key={j.id} className="card">
            <h3>
              <span className={`badge ${j.status === 'completed' ? '' : 'err'}`}>{j.status}</span>
              {j.description || j.kind}
            </h3>
            <div className="meta">
              {j.kind} · {j.action} · #{j.id} {jobWallTime(j) && `· ${jobWallTime(j)}`}
            </div>
            {(j.error || j.result) && (
              <div className="meta job-result">{j.error || j.result}</div>
            )}
            {JOB_ACTIVE.includes(j.status) && (
              <div className="row" style={{ marginTop: 8, marginBottom: 0 }}>
                <button className="btn" onClick={() => stop(j.id)}>
                  Stop
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- capture ----------

function CaptureView({ projectId }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)

  const submit = (e) => {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    setReport(null)
    api
      .capture(projectId, { text: text.trim() })
      .then((r) => {
        setReport(r.report || '(no report)')
        setText('')
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="center-col">
      <div className="page-head">
        <h2>Capture</h2>
        <span className="muted">
          paste notes, an email, or a thread; the agent structures it into tasks,
          reminders, decisions, and client facts
        </span>
      </div>
      <form className="docs-card" onSubmit={submit}>
        <textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste raw notes here..."
        />
        <div className="row" style={{ marginTop: 10, marginBottom: 0 }}>
          <button className="btn primary" disabled={busy || !text.trim()}>
            {busy ? (
              <>
                <Spinner size={13} /> Capturing
              </>
            ) : (
              <>
                <Icon name="plus" size={13} /> Capture
              </>
            )}
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>
      {report !== null && (
        <div className="docs-card">
          <div className="docs-head">
            <Icon name="check" size={15} />
            <span>Captured</span>
          </div>
          <div className="reader-body prose" dangerouslySetInnerHTML={{ __html: mdToHtml(report) }} />
        </div>
      )}
    </div>
  )
}

// ---------- memory ----------

function MemoryView({ projectId, providerId, onStart }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState(null)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState(null)
  const [searching, setSearching] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [fixing, setFixing] = useState(false)
  const [fixReport, setFixReport] = useState(null)
  const [fixError, setFixError] = useState(null)

  const search = (e) => {
    e?.preventDefault()
    setSearching(true)
    setError(null)
    api
      .searchMemory(projectId, q)
      .then(setItems)
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setSearching(false))
  }

  useEffect(() => {
    search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const runFix = (e) => {
    e?.preventDefault()
    if (!instruction.trim() || fixing) return
    setFixing(true)
    setFixError(null)
    setFixReport(null)
    api
      .fixMemory(projectId, {
        instruction: instruction.trim(),
        provider_id: providerId || undefined,
      })
      .then((r) => {
        setFixReport(r.report || '(no report)')
        search()
      })
      .catch((err) => setFixError(err.message || String(err)))
      .finally(() => setFixing(false))
  }

  return (
    <div className="center-col">
      <div className="page-head">
        <h2>Memory</h2>
      </div>
      <div className="fix-panel">
        <form className="fix-row" onSubmit={runFix}>
          <input
            placeholder="Tell the agent what to fix, e.g. mark Flask memories as stale"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <button className="btn primary" disabled={fixing || !instruction.trim()}>
            {fixing ? 'Running...' : 'Fix with agent'}
          </button>
        </form>
        {fixError && <p className="error-text" style={{ marginTop: 8 }}>{fixError}</p>}
        {fixReport !== null && (
          <div className="fix-report">
            <div className="reader-body prose" dangerouslySetInnerHTML={{ __html: mdToHtml(fixReport) }} />
          </div>
        )}
      </div>
      <form className="search-row" onSubmit={search}>
        <input
          placeholder="Search memory..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn" disabled={searching}>
          <Icon name="search" size={14} />
          {searching ? 'Searching' : 'Search'}
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
      {items && items.length === 0 && (
        <p className="empty">
          {q ? 'No memory items match your search.' : 'No memory items yet.'}
        </p>
      )}
      <div className="cards">
        {(items || []).map((m) => (
          <div key={m.id} className="card clickable" {...clickable(() => setSelected(m))}>
            <h3>
              <span className="badge">{m.type}</span>
              {m.title}
            </h3>
            <div className="meta">{m.statement}</div>
            <div className="meta" style={{ marginTop: 6 }}>
              {(m.tags || []).map((t) => (
                <span key={t} className="badge">
                  {t}
                </span>
              ))}{' '}
              {relDate(m.updatedAt || m.updated_at)}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <MemoryDetailModal
          item={selected}
          onClose={() => setSelected(null)}
          onStart={onStart}
        />
      )}
    </div>
  )
}

function MemoryDetailModal({ item, onClose, onStart }) {
  const tags = item.tags || []
  return (
    <Modal title={item.title} onClose={onClose}>
      <div className="detail-rows">
        <DetailRow label="Type" value={item.type} />
        <DetailRow label="Statement" value={item.statement} />
        {item.details && <DetailRow label="Details" value={item.details} />}
        {tags.length > 0 && <DetailRow label="Tags" value={tags.join(', ')} />}
        {item.confidence != null && <DetailRow label="Confidence" value={item.confidence} />}
        {item.importance != null && <DetailRow label="Importance" value={item.importance} />}
        <DetailRow label="Updated" value={relDate(item.updatedAt || item.updated_at)} />
      </div>
      {onStart && (
        <div className="row" style={{ marginTop: 16, marginBottom: 0 }}>
          <button
            className="btn primary"
            onClick={() => {
              onClose()
              onStart(
                `Let's revisit this project memory: "${item.title}". ${item.statement}`
              )
            }}
          >
            <Icon name="chat" size={13} /> Ask about this
          </button>
        </div>
      )}
    </Modal>
  )
}

// ---------- about ----------

function AboutView({ projectId, onDeleted }) {
  const { data: project, error, loading, reload } = useAsync(
    () => api.getProject(projectId),
    [projectId]
  )
  const usageReq = useAsync(() => api.projectUsage(projectId), [projectId])
  const usage = usageReq.data
  const notifyReq = useAsync(api.notifyStatus, [])
  const [pulling, setPulling] = useState(false)
  const [pullOutput, setPullOutput] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmWrites, setConfirmWrites] = useState(false)
  const [budget, setBudget] = useState('')
  const [enforce, setEnforce] = useState(false)
  const [savingBudget, setSavingBudget] = useState(false)
  const [testingNotify, setTestingNotify] = useState(false)
  const [notifyResult, setNotifyResult] = useState(null)
  const [notifyError, setNotifyError] = useState(null)

  useEffect(() => {
    if (project) {
      setBudget(project.token_budget ?? '')
      setEnforce(!!project.budget_enforced)
    }
  }, [project])

  if (loading) return <p className="note">Loading...</p>
  if (error) return <p className="error-text">{error}</p>
  if (!project) return null

  const status = project.status || {}

  const pull = () => {
    setPulling(true)
    setActionError(null)
    setPullOutput(null)
    api
      .pullProject(project.id)
      .then((r) => {
        setPullOutput(r.output || '')
        reload()
      })
      .catch((e) => setActionError(e.message || String(e)))
      .finally(() => setPulling(false))
  }

  const setWrites = (enabled) => {
    setActionError(null)
    api
      .setGitWrites(project.id, enabled)
      .then(() => {
        setConfirmWrites(false)
        reload()
      })
      .catch((e) => setActionError(e.message || String(e)))
  }

  const saveBudget = () => {
    setSavingBudget(true)
    setActionError(null)
    api
      .updateProject(project.id, {
        token_budget: budget === '' ? 0 : Number(budget),
        budget_enforced: enforce,
      })
      .then(() => {
        reload()
        usageReq.reload()
      })
      .catch((e) => setActionError(e.message || String(e)))
      .finally(() => setSavingBudget(false))
  }

  const testNotify = () => {
    setTestingNotify(true)
    setNotifyError(null)
    setNotifyResult(null)
    api
      .notifyTest()
      .then(setNotifyResult)
      .catch((e) => setNotifyError(e.message || String(e)))
      .finally(() => setTestingNotify(false))
  }

  return (
    <div className="center-col">
      <div className="page-head">
        <h2>About</h2>
        {confirmDelete ? (
          <div className="row" style={{ marginBottom: 0 }}>
            <span className="muted">Delete this project?</span>
            <button
              className="btn danger"
              onClick={() =>
                api.deleteProject(project.id).then(onDeleted).catch((e) => alert(e.message))
              }
            >
              Confirm
            </button>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn danger" onClick={() => setConfirmDelete(true)}>
            Delete project
          </button>
        )}
      </div>
      <dl className="kv">
        <dt>Repo</dt>
        <dd>
          <a href={project.repo_url} target="_blank" rel="noreferrer">
            {project.repo_url}
          </a>
        </dd>
        <dt>Local path</dt>
        <dd>{project.local_path}</dd>
        <dt>Branch</dt>
        <dd>{status.branch || 'unknown'}</dd>
        <dt>Head</dt>
        <dd style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{status.head || 'unknown'}</dd>
        <dt>Created</dt>
        <dd>{fmtDate(project.created_at)}</dd>
      </dl>
      <div className="row">
        <button className="btn" onClick={pull} disabled={pulling}>
          {pulling ? 'Pulling...' : 'Pull latest'}
        </button>
      </div>
      {actionError && <p className="error-text">{actionError}</p>}
      {pullOutput !== null && <pre>{pullOutput || '(no output)'}</pre>}
      <h3 className="faint" style={{ fontSize: 13, fontWeight: 600 }}>
        Token usage
      </h3>
      {usage && usage.total.runs > 0 ? (
        <>
          <p className="note">
            {fmtTokens(usage.total.tokens)} tokens across {usage.total.runs} agent runs ·{' '}
            {fmtTokens(usage.total.prompt_tokens)} prompt / {fmtTokens(usage.total.completion_tokens)}{' '}
            completion
          </p>
          <div className="usage-list">
            {usage.by_action.map((a) => (
              <div key={a.action} className="usage-row">
                <span className="usage-name">{a.action}</span>
                <span className="muted">{a.runs} runs</span>
                <span>{fmtTokens(a.tokens)}</span>
              </div>
            ))}
            {usage.by_session.map((s) => (
              <div key={`session-${s.session_id}`} className="usage-row">
                <span className="usage-name">
                  <Icon name="chat" size={13} /> {s.title}
                </span>
                <span className="muted">{s.runs} runs</span>
                <span>{fmtTokens(s.tokens)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="note">No usage recorded yet.</p>
      )}
      <h3 className="faint" style={{ fontSize: 13, fontWeight: 600 }}>
        Monthly budget
      </h3>
      <p className="note">
        {usage && usage.month
          ? `${fmtTokens(usage.month.tokens)} tokens used this month.`
          : 'No usage this month.'}{' '}
        Leave the budget empty for unlimited.
      </p>
      <div className="row">
        <input
          type="number"
          min="0"
          style={{ maxWidth: 160 }}
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="Unlimited"
        />
        <label className="dep-item" style={{ flex: 'none' }}>
          <input
            type="checkbox"
            checked={enforce}
            onChange={(e) => setEnforce(e.target.checked)}
          />
          Skip scheduled runs when the budget is spent
        </label>
        <button className="btn" onClick={saveBudget} disabled={savingBudget}>
          {savingBudget ? <Spinner size={13} /> : 'Save budget'}
        </button>
      </div>
      <h3 className="faint" style={{ fontSize: 13, fontWeight: 600 }}>
        Git writes
      </h3>
      {project.allow_git_writes ? (
        <>
          <p className="note warn-text">
            <Icon name="alert" size={13} /> Enabled: the agent can write files into the clone,
            create branches, commit, push, and open pull requests.
          </p>
          <label className="dep-item" style={{ flex: 'none' }}>
            <input
              type="checkbox"
              checked={!!project.require_write_approval}
              onChange={(e) =>
                api
                  .updateProject(project.id, { require_write_approval: e.target.checked })
                  .then(reload)
                  .catch((err) => setActionError(err.message))
              }
            />
            Require your approval before push or PR
          </label>
          <div className="row">
            <button className="btn danger" onClick={() => setWrites(false)}>
              Disable git writes
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="note">
            Disabled: project code is read-only. Enable to let the agent make code changes on a
            branch, push, and open pull requests.
          </p>
          <div className="row">
            {confirmWrites ? (
              <>
                <span className="muted">Let the agent modify the clone?</span>
                <button className="btn danger" onClick={() => setWrites(true)}>
                  Confirm enable
                </button>
                <button className="btn" onClick={() => setConfirmWrites(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => setConfirmWrites(true)}>
                <Icon name="alert" size={14} /> Enable git writes…
              </button>
            )}
          </div>
        </>
      )}
      <h3 className="faint" style={{ fontSize: 13, fontWeight: 600 }}>
        Notifications
      </h3>
      {notifyReq.data && notifyReq.data.configured.length > 0 ? (
        <>
          <p className="note">
            Channels: {notifyReq.data.configured.join(', ')}. The agent can push with the{' '}
            <code>notify</code> tool; new inbox items and scheduled runs notify automatically.
          </p>
          <div className="row">
            <button className="btn" onClick={testNotify} disabled={testingNotify}>
              {testingNotify ? (
                <>
                  <Spinner size={13} /> Sending
                </>
              ) : (
                <>
                  <Icon name="sparkles" size={13} /> Send test notification
                </>
              )}
            </button>
          </div>
        </>
      ) : (
        <p className="note">
          No channel configured. Set <code>NTFY_TOPIC</code> (optionally <code>NTFY_URL</code>,{' '}
          <code>NTFY_TOKEN</code>), or <code>TELEGRAM_BOT_TOKEN</code> +{' '}
          <code>TELEGRAM_CHAT_ID</code>, then restart Home.
        </p>
      )}
      {notifyResult && (
        <p className="note">
          Sent via {Object.entries(notifyResult).map(([k, v]) => `${k} (${v.ok ? 'ok' : 'failed'})`).join(', ')}.
        </p>
      )}
      {notifyError && <p className="error-text">{notifyError}</p>}
      <h3 className="faint" style={{ fontSize: 13, fontWeight: 600 }}>
        AGENTS.md
      </h3>
      <pre>{project.agents_md || '(empty)'}</pre>
    </div>
  )
}

// ---------- landing / home ----------

function greeting(name) {
  const h = new Date().getHours()
  const base = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  return name ? `${base}, ${name}` : base
}

function SectionEmpty({ icon, title, hint, action }) {
  return (
    <div className="placeholder">
      <div className="placeholder-icon">
        <Icon name={icon} size={18} />
      </div>
      <div className="placeholder-title">{title}</div>
      {hint && <div className="placeholder-hint">{hint}</div>}
      {action}
    </div>
  )
}

function LoginView({ status, onAuthed }) {
  const [setupToken, setSetupToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const supported = passkeysSupported()

  const run = (fn) => {
    setBusy(true)
    setError(null)
    fn()
      .then(onAuthed)
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo">
          <Icon name="flame" size={22} />
        </div>
        <h1>Hestia</h1>
        <p className="note">Sign in with a passkey to continue.</p>
        {!supported && (
          <p className="error-text">This browser does not support passkeys (WebAuthn).</p>
        )}
        {error && <p className="error-text">{error}</p>}
        {status.has_passkeys && (
          <button
            className="btn primary"
            disabled={busy || !supported}
            onClick={() => run(loginWithPasskey)}
          >
            {busy ? <Spinner size={13} /> : <Icon name="check" size={14} />} Sign in with passkey
          </button>
        )}
        <div className="login-setup">
          <div className="field-label">
            {status.has_passkeys ? 'Add another passkey (recovery)' : 'Register a passkey'}
          </div>
          <div className="row" style={{ marginBottom: 0 }}>
            <input
              type="password"
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              placeholder="Setup token"
            />
            <button
              className="btn"
              disabled={busy || !supported || !setupToken}
              onClick={() => run(() => registerPasskey(setupToken))}
            >
              {status.has_passkeys ? 'Add passkey' : 'Register'}
            </button>
          </div>
          <div className="field-hint">
            The setup token is the <code>HOME_SETUP_TOKEN</code> environment variable.
          </div>
        </div>
      </div>
    </div>
  )
}

function InboxCard({ onOpenProject, onStartChat }) {
  const { data, loading, reload } = useAsync(api.listInbox, [])
  const [polling, setPolling] = useState(false)
  const [busy, setBusy] = useState(null)
  const [report, setReport] = useState(null)
  const [actionError, setActionError] = useState(null)
  const items = (data && data.items) || []
  const unread = (data && data.unread) || 0

  if (loading || items.length === 0) return null

  const poll = () => {
    setPolling(true)
    api
      .pollInbox()
      .then(reload)
      .catch(() => {})
      .finally(() => setPolling(false))
  }

  const open = (item) => {
    if (!item.read) api.markInboxRead(item.id).then(reload).catch(() => {})
    if (item.url) window.open(item.url, '_blank', 'noreferrer')
    else onOpenProject(item.project_id)
  }

  const triage = (item) => {
    const [kind, number] = (item.external_id || '').split(':')
    if (!number) return
    setBusy(item.id)
    setActionError(null)
    api
      .triage(item.project_id, { kind: kind === 'pr' ? 'pr' : 'issue', number: Number(number) })
      .then((r) => setReport({ ...r, item }))
      .catch((e) => setActionError(e.message || String(e)))
      .finally(() => setBusy(null))
  }

  const diagnose = (item) => {
    if (!item.read) api.markInboxRead(item.id).then(reload).catch(() => {})
    onStartChat(
      item.project_id,
      `Investigate this CI failure from the inbox and propose a fix.\n\nRun: ${item.title}\nURL: ${item.url || '(none)'}\n\nUse gh_ci_runs to fetch the run and its failed jobs, find the likely cause, and write findings to the workspace with workspace_write.`
    )
  }

  return (
    <section className="inbox-card">
      <div className="inbox-head">
        <h2>
          <Icon name="alert" size={15} /> Inbox
          {unread > 0 && <span className="badge accent">{unread} new</span>}
        </h2>
        <div className="row" style={{ marginBottom: 0 }}>
          <button className="btn" onClick={poll} disabled={polling}>
            {polling ? <Spinner size={13} /> : <Icon name="refresh" size={13} />} Check now
          </button>
          {unread > 0 && (
            <button className="btn" onClick={() => api.markAllInboxRead().then(reload).catch(() => {})}>
              <Icon name="check" size={13} /> Mark all read
            </button>
          )}
        </div>
      </div>
      {actionError && <p className="error-text">{actionError}</p>}
      <div className="home-list">
        {items.slice(0, 6).map((item) => (
          <div key={item.id} className="inbox-item">
            <button
              className={`home-row inbox-main ${item.read ? '' : 'unread'}`}
              onClick={() => open(item)}
            >
              <span className="home-row-icon">
                <Icon name={item.kind === 'run' ? 'play' : item.kind === 'issue' ? 'chat' : 'git'} size={15} />
              </span>
              <span className="home-row-main">
                <span className="home-row-title">{item.title}</span>
                <span className="home-row-sub">
                  {item.project} · {item.subtitle}
                </span>
              </span>
              <span className="home-row-time">{relDate(item.created_at)}</span>
            </button>
            <div className="inbox-actions">
              {item.kind === 'run' ? (
                <button className="btn" onClick={() => diagnose(item)}>
                  <Icon name="sparkles" size={13} /> Diagnose
                </button>
              ) : (
                <button className="btn" disabled={busy === item.id} onClick={() => triage(item)}>
                  {busy === item.id ? (
                    <>
                      <Spinner size={13} /> Triaging
                    </>
                  ) : (
                    <>
                      <Icon name="tasks" size={13} /> Triage
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {report && (
        <Modal title={`Triage · ${report.item.title}`} onClose={() => setReport(null)}>
          <div
            className="reader-body prose"
            dangerouslySetInnerHTML={{ __html: mdToHtml(report.report || '') }}
          />
          {report.path && (
            <p className="note">
              Plan: <code>{report.path}</code>
            </p>
          )}
        </Modal>
      )}
    </section>
  )
}

function HomeView({ onOpenProject, onOpenSession, onOpenFile, onNewProject, onNavigate, onStartChat }) {
  const { data, error, loading } = useAsync(api.activity, [])
  const { data: settings } = useAsync(api.getSettings, [])
  const counts = (data && data.counts) || { projects: 0, sessions: 0, files: 0 }
  const projects = (data && data.projects) || []
  const sessions = (data && data.sessions) || []
  const files = (data && data.files) || []

  return (
    <div className="home">
      <header className="home-hero">
        <div>
          <h1>{greeting((settings && settings.user_name) || '')}</h1>
          <p>Your projects, recent conversations, and agent-generated files in one place.</p>
        </div>
        <button className="btn primary" onClick={onNewProject}>
          <Icon name="plus" size={15} /> New project
        </button>
      </header>

      {error && <p className="error-text">{error}</p>}

      <InboxCard onOpenProject={onOpenProject} onStartChat={onStartChat} />

      <UpcomingReminders onNavigate={onNavigate} />

      {!loading && counts.projects === 0 && (
        <div className="banner">
          <div className="banner-icon">
            <Icon name="sparkles" size={22} />
          </div>
          <div className="banner-body">
            <h3>No projects yet</h3>
            <p>
              Register a Git repository to get an agent-aware workspace with chat, memory, and
              generated files.
            </p>
          </div>
          <button className="btn primary" onClick={onNewProject}>
            <Icon name="plus" size={15} /> Create your first project
          </button>
        </div>
      )}

      <section className="home-section">
        <div className="home-section-head">
          <h2>Recent projects</h2>
          {onNavigate && (
            <button className="link-btn" onClick={() => onNavigate({ type: 'help' })}>
              <Icon name="help" size={13} /> How it works
            </button>
          )}
        </div>
        {loading ? (
          <div className="cards">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="card-skeleton" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <SectionEmpty
            icon="folder"
            title="No projects yet"
            hint="Add a Git repository to begin."
            action={
              <button className="btn" onClick={onNewProject}>
                <Icon name="plus" size={14} /> Add a project
              </button>
            }
          />
        ) : (
          <div className="cards">
            {projects.map((p) => (
              <button key={p.id} className="project-card" onClick={() => onOpenProject(p.id)}>
                <div className="project-card-top">
                  <span className="proj-avatar big">{p.name.slice(0, 1)}</span>
                  <span className="project-card-name">{p.name}</span>
                </div>
                <div className="project-card-repo">
                  <Icon name="git" size={12} />
                  <span>{p.repo_url}</span>
                </div>
                <div className="project-card-foot">
                  <Icon name="clock" size={12} />
                  {relDate(p.last_opened_at || p.created_at)}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="home-grid">
        <section className="home-section">
          <div className="home-section-head">
            <h2>Recent conversations</h2>
          </div>
          {loading ? (
            <div className="home-list">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="row-skeleton" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <SectionEmpty
              icon="chat"
              title="No conversations yet"
              hint="Open a project and ask the agent something."
            />
          ) : (
            <div className="home-list">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  className="home-row"
                  onClick={() => onOpenSession(s.project_id, s.id)}
                >
                  <span className="home-row-icon">
                    <Icon name="chat" size={15} />
                  </span>
                  <span className="home-row-main">
                    <span className="home-row-title">{s.title || 'Untitled'}</span>
                    <span className="home-row-sub">{s.project}</span>
                  </span>
                  <span className="home-row-time">{relDate(s.updated_at)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="home-section">
          <div className="home-section-head">
            <h2>Recent files</h2>
          </div>
          {loading ? (
            <div className="home-list">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="row-skeleton" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <SectionEmpty
              icon="files"
              title="No generated files yet"
              hint="Ask the agent to write a plan or spec."
            />
          ) : (
            <div className="home-list">
              {files.map((f) => (
                <button
                  key={`${f.project_id}:${f.path}`}
                  className="home-row"
                  onClick={() => onOpenFile(f)}
                >
                  <span className="home-row-icon">
                    <Icon name="files" size={15} />
                  </span>
                  <span className="home-row-main">
                    <span className="home-row-title">{f.path}</span>
                    <span className="home-row-sub">
                      {f.project} · {fmtBytes(f.bytes)}
                    </span>
                  </span>
                  <span className="home-row-time">{relDate(f.modified)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// ---------- help ----------

function Doc(props) {
  return (
    <section className="help-section" id={props.id}>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  )
}

function HelpView() {
  const { data: actions } = useAsync(api.listActions, [])
  const actionList = actions || []

  return (
    <div className="help">
      <header className="help-hero">
        <div className="help-badge">
          <Icon name="help" size={22} />
        </div>
        <div>
          <h1>Help &amp; documentation</h1>
          <p>Everything Home does, and how to get the most out of it.</p>
        </div>
      </header>

      <nav className="help-toc">
        <a href="#overview">Overview</a>
        <a href="#quickstart">Quick start</a>
        <a href="#projects">Projects</a>
        <a href="#insight">Project insight</a>
        <a href="#tasks">Task board</a>
        <a href="#goals">Goals &amp; planning</a>
        <a href="#gitwrites">Git writes</a>
        <a href="#ghauth">GitHub account</a>
        <a href="#providers">Providers</a>
        <a href="#agents">Agents &amp; actions</a>
        <a href="#chat">Chat &amp; tools</a>
        <a href="#memory">Memory</a>
        <a href="#background">Background tasks</a>
        <a href="#capture">Capture notes</a>
        <a href="#files">Files &amp; gallery</a>
        <a href="#automation">Search, inbox &amp; automations</a>
        <a href="#assistant">Reminders, watches &amp; briefing</a>
        <a href="#auth">Passkeys &amp; access</a>
        <a href="#settings">Settings &amp; theme</a>
        <a href="#tips">Tips &amp; troubleshooting</a>
      </nav>

      <Doc id="overview" title="Overview">
        <p>
          <strong>Hestia</strong> is a self-hosted cockpit for software projects. Each project is a
          persistent, agent-aware workspace linked to a Git repository. An agent reads the repo,
          answers questions, and writes what it learns into <strong>Totem</strong>, a durable
          project memory that every future conversation starts from.
        </p>
        <p>
          The <strong>Dashboard</strong> (the page you land on) shows your most recently opened
          projects, the latest conversations across all projects, and the newest files agents have
          generated.
        </p>
      </Doc>

      <Doc id="quickstart" title="Quick start">
        <ol className="help-steps">
          <li>
            <strong>Add a project.</strong> Give it a name and a Git URL. Home clones it into the
            data volume and reads its <code>AGENTS.md</code>.
          </li>
          <li>
            <strong>Configure a provider.</strong> Open <em>Settings</em> from the sidebar and pick a
            preset or enter a base URL, model, and the environment variable holding your API key.
            Use <em>Test</em> to verify it works.
          </li>
          <li>
            <strong>Set up an agent.</strong> On the <em>Agents</em> page, stay in <em>Simple</em>{' '}
            mode and pick a provider. One agent now handles everything. Advanced users can
            specialise per action.
          </li>
          <li>
            <strong>Chat.</strong> Open a project and describe a task. Watch each tool call run in
            the chat, then review what the agent learned in the <em>Memory</em> tab.
          </li>
        </ol>
      </Doc>

      <Doc id="projects" title="Projects">
        <p>
          A project is a Git repository plus a workspace. Home never modifies your code unless
          you explicitly enable <em>Git writes</em> for the project: the agent can read files and
          git history, and write files to a separate workspace, but not change the repository.
        </p>
        <ul>
          <li>
            <strong>Add</strong> a project with the <code>+</code> next to <em>Projects</em> or the
            <em>New project</em> button on the Home page.
          </li>
          <li>
            <strong>Open</strong> a project from the sidebar or the Home dashboard. Opening updates
            its place in <em>Recent projects</em>.
          </li>
          <li>
            <strong>Pull</strong> latest changes and refresh <code>AGENTS.md</code> from the
            <em>About</em> tab.
          </li>
          <li>
            <strong>Delete</strong> a project from the <em>About</em> tab. This removes its registry
            entry and clone.
          </li>
        </ul>
      </Doc>

      <Doc id="insight" title="Project insight">
        <p>
          Opening a project shows an <strong>Overview</strong> status board, and each project has
          dedicated <strong>GitHub</strong> and <strong>Activity</strong> tabs.
        </p>
        <ul>
          <li>
            <strong>Overview</strong>: branch, last commit, ahead/behind sync, open task count, and
            (for GitHub remotes) open PRs, open issues, failing CI runs, and the latest run.
          </li>
          <li>
            <strong>Since your last visit</strong>: a digest of commits, memories, generated files,
            and GitHub changes since you last opened the project. Home tracks each project’s last
            opened time, so this resets when you leave and come back.
          </li>
          <li>
            <strong>GitHub</strong>: browse pull requests, issues, and CI runs with filters, open
            them on GitHub, hit <em>Summarize</em> to hand one to the agent, <em>Triage</em> to
            turn it into a plan plus tasks, or <em>Review</em> to run the code-reviewer and write a
            review to the workspace.
          </li>
          <li>
            <strong>Inbox</strong>: new open PRs/issues and failing CI runs appear on the Home
            dashboard. PR/issue items can be triaged in place; CI failures open a diagnose chat.
          </li>
          <li>
            <strong>Token budget</strong>: set a monthly budget in About; the Overview shows usage
            and warns past 80%, and scheduled runs pause when the budget is spent (if enforcement
            is on).
          </li>
          <li>
            <strong>Activity</strong>: a chronological timeline of conversations, memory writes,
            generated files, commits, and GitHub events for the project.
          </li>
          <li>
            <strong>Token usage</strong>: the Overview board shows total tokens consumed by the
            agent; the <em>About</em> tab breaks it down by action and conversation. Tokens are
            read from provider responses, so endpoints that omit usage report nothing.
          </li>
        </ul>
      </Doc>

      <Doc id="tasks" title="Task board">
        <p>
          Every project has a <strong>Kanban board</strong> of tasks, kept separate from chat
          sessions, so the board outlives any conversation. Columns are{' '}
          <em>Backlog</em>, <em>To do</em>, <em>In progress</em>, <em>Review</em>, and{' '}
          <em>Done</em>.
        </p>
        <ul>
          <li>
            <strong>Drag and drop</strong> a card between columns to change its status, or drop it
            on another card to reorder.
          </li>
          <li>
            <strong>Click a card</strong> to edit its title, description, column, priority,
            milestone, and due date, or delete it. Cards can <strong>depend on other tasks</strong>{' '}
            (a blocked badge appears until every dependency is done), carry{' '}
            <strong>acceptance criteria</strong> (moving to done asks for review confirmation), and
            hold <strong>comments</strong> that carry context into the next session. A due date
            shows as a chip, red when overdue, soon when within two days.
          </li>
          <li>
            <strong>Implement with agent</strong> in the task editor opens a chat seeded with the
            task's brief, acceptance criteria, dependencies, and comments, and moves the card to
            in-progress.
          </li>
          <li>
            <strong>Run in background</strong> (with git writes on) hands the task to the agent as
            a detached job: it works on a branch, opens a pull request, records the PR link, and
            moves the card to <em>Review</em>. <strong>Run next</strong> on the board does the same
            for the highest-priority unblocked task. Review the PR on GitHub, then mark the task
            done or send it back.
          </li>
          <li>
            <strong>Push to GitHub</strong> creates an issue for a task when git writes are on; the
            card then shows its issue number and re-syncs never duplicate it.
          </li>
          <li>
            <strong>Suggest next work</strong> runs the agent over the board and memory and
            proposes 2 to 5 backlog tasks tagged <em>suggested</em>; keep the useful ones and
            delete the rest.
          </li>
          <li>
            <strong>Milestones</strong> (the <em>Roadmap</em> tab) group tasks into a goal with a
            target date and a progress bar. Link Totem memories to a milestone to tie decisions
            and constraints to the outcome.
          </li>
          <li>
            <strong>The agent manages the board too.</strong> With the <em>Task board</em> tool
            group enabled, the agent can list, create, move, and delete tasks, and create
            milestones. Ask it to “break this into tasks” and they appear on the board.
          </li>
          <li>
            <strong>Triage.</strong> On the <em>GitHub</em> tab, hit <em>Triage</em> on an issue or
            PR. The agent writes a plan to the workspace and creates tasks for it, tracked under a
            parent task.
          </li>
        </ul>
      </Doc>

      <Doc id="goals" title="Goals &amp; planning">
        <p>
          The <strong>Goals</strong> tab turns an intent into an executable board. A goal owns a
          discussion thread, a spec in the workspace, and (once planned) a milestone.
        </p>
        <ul>
          <li>
            <strong>Create a goal</strong> with a title, description, and success criteria.
          </li>
          <li>
            <strong>Discuss</strong> opens a chat in goal mode: the agent interviews you and keeps
            the draft spec updated at <code>goals/&lt;slug&gt;/spec.md</code>.
          </li>
          <li>
            <strong>Generate board</strong> runs the planner: it writes spec + plan, creates the
            milestone, and adds 3–8 tasks with priorities, acceptance criteria, and dependency
            order.
          </li>
          <li>
            <strong>Converge</strong> re-reads the spec and appends tasks the board is still
            missing. It never edits code or existing tasks.
          </li>
          <li>
            Goal cards show status and milestone progress; the spec opens in the file reader and
            the board jumps to the Tasks tab.
          </li>
        </ul>
      </Doc>

      <Doc id="gitwrites" title="Git writes">
        <p>
          By default the agent is strictly read-only: it can inspect the clone and GitHub but
          never change your code. <strong>Git writes</strong> is a per-project, explicit opt-in,
          toggled from the <em>About</em> tab (with a confirmation step). A red{' '}
          <em>writes on</em> badge shows in the project header while it is enabled.
        </p>
        <ul>
          <li>
            When enabled the agent gains <code>write_file</code> (sandboxed to the clone, never{' '}
            <code>.git</code> or <code>.totem</code>), <code>git_create_branch</code>,{' '}
            <code>git_commit</code>, <code>git_push</code>, and <code>gh_open_pr</code>.
          </li>
          <li>
            The system prompt switches to a write policy: prefer a new branch, focused commits,
            never force-push, and report the branch and PR created.
          </li>
          <li>
            Pushing to GitHub needs <code>GITHUB_TOKEN</code> with write scope; without it the
            agent can still branch and commit locally. Subagents and scheduled jobs stay
            read-only. With <em>Require your approval before push or PR</em> enabled (About),
            the agent must call <code>ask_approval</code> and get an approve answer before
            pushing or opening a PR.
          </li>
        </ul>
      </Doc>

      <Doc id="ghauth" title="GitHub account">
        <p>
          Public repositories work without an account. Connecting GitHub enables private
          repositories, higher rate limits, and issue and pull request writes.
        </p>
        <ul>
          <li>
            <strong>Settings, GitHub</strong>: paste a personal access token (repo scope),
            import the token from the <code>gh</code> CLI (<code>gh auth login</code> first),
            or use device sign-in with your own OAuth app client id.
          </li>
          <li>
            <code>GITHUB_TOKEN</code> in the environment takes precedence over the stored
            token; disconnect is disabled while it is set.
          </li>
          <li>
            The token is stored at <code>&lt;DATA_DIR&gt;/github_token</code> with 0600
            permissions, and is used for clones, pulls, GitHub reads, PRs, issues, and
            reviews.
          </li>
        </ul>
      </Doc>

      <Doc id="providers" title="Providers">
        <p>
          A provider is any OpenAI-compatible endpoint. Home ships presets for popular services and
          supports fully custom ones.
        </p>
        <ul>
          <li>
            <strong>API keys are never stored.</strong> You name an environment variable (for
            example <code>KIMI_API_KEY</code>); Home reads the key from the process environment at
            request time.
          </li>
          <li>
            <strong>Base URL</strong> is the OpenAI-compatible root, e.g.{' '}
            <code>https://api.deepseek.com/v1</code>.
          </li>
          <li>
            <strong>Model</strong> is the model id sent to the endpoint, e.g.{' '}
            <code>deepseek-chat</code>.
          </li>
          <li>
            Use <strong>Test</strong> on a provider card to confirm the key and endpoint connect.
          </li>
        </ul>
      </Doc>

      <Doc id="agents" title="Agents &amp; actions">
        <p>
          An <strong>agent</strong> is a model plus a system prompt plus the tools it may use. There
          are two ways to configure them:
        </p>
        <div className="help-cols">
          <div className="help-card">
            <h3>Simple</h3>
            <p>
              One agent for everything. Pick a provider and (optionally) a prompt; it handles chat,
              exploration, review, writing, and memory. This is the recommended default.
            </p>
          </div>
          <div className="help-card">
            <h3>Advanced</h3>
            <p>
              Create multiple agent profiles and assign a default to each <em>action</em>. Give
              exploration a cheap model and code review a stronger one, for example.
            </p>
          </div>
        </div>
        <h3 className="help-sub">Actions</h3>
        <p>An action is a job the app runs an agent for. Anything left on “Default agent” uses the main agent.</p>
        <div className="help-table">
          {actionList.length === 0 && <p className="note">Loading actions…</p>}
          {actionList.map((a) => (
            <div key={a.key} className="help-table-row">
              <div className="help-table-label">{a.label}</div>
              <div className="help-table-desc">{a.description}</div>
            </div>
          ))}
        </div>
        <h3 className="help-sub">Resolution order</h3>
        <p>
          When an action runs, Home uses: the agent assigned to that action → the main chat agent →
          a profile whose name matches the action. So a single agent truly covers everything.
        </p>
      </Doc>

      <Doc id="chat" title="Chat &amp; tools">
        <p>
          Every message starts a turn. Home builds a system prompt from the project instructions,
          the repository layout, and the most relevant Totem memories, then runs a tool-calling
          loop. Each tool call appears as a live row you can expand:
        </p>
        <ul>
          <li>
            <strong>Running</strong> shows a spinner while the tool executes.
          </li>
          <li>
            <strong>Done</strong> (green check) or <strong>Failed</strong> (red) replaces it with
            the result preview once it finishes. Expand to see arguments and full output.
          </li>
        </ul>
        <h3 className="help-sub">Tool groups</h3>
        <div className="help-table">
          {TOOL_GROUPS.map((g) => (
            <div key={g.key} className="help-table-row">
              <div className="help-table-label">{g.label}</div>
              <div className="help-table-desc">{g.desc}</div>
            </div>
          ))}
        </div>
        <p className="help-note">
          When an agent uses <strong>Delegation</strong>, it hands a read-only subtask to the agent
          configured for an action and continues with the summary. Subagents cannot delegate
          further.
        </p>
        <p>
          The agent can also <strong>ask you a question</strong> with <code>ask_user</code> when a
          decision blocks the work. The turn ends, a notification is pushed (when configured), and
          the question appears as a card in the chat with any suggested choices. It is stored on
          the session, so it survives reloads; your next message answers it and the agent
          continues. <em>Skip</em> dismisses it without an answer.
        </p>
      </Doc>

      <Doc id="memory" title="Memory">
        <p>
          Totem is durable project memory: decisions, gotchas, architecture facts, and open
          questions. It is not a chat log. After each turn the agent records what mattered, and a
          new session bootstraps from ranked memory instead of the old transcript.
        </p>
        <ul>
          <li>
            <strong>Browse &amp; search</strong> memory in the <em>Memory</em> tab.
          </li>
          <li>
            <strong>Repair</strong> memory by describing the fix in plain language and pressing{' '}
            <em>Fix with agent</em>. A memory-only agent applies the changes and reports back.
          </li>
          <li>
            <strong>Preferences and client facts</strong>: memories tagged{' '}
            <code>preference</code> or <code>client:&lt;name&gt;</code> are always injected into
            the agent's context, not just retrieved by relevance. Tag them when writing memory.
          </li>
          <li>
            <strong>About you</strong>: tell the agent "call me Sam" or "remember: reply in short
            bullets" and it saves a global name and standing preferences that are injected into
            every future prompt. Manage them under Settings, Assistant. A{' '}
            <em>Remember this</em> button under each reply saves it as a preference.
          </li>
        </ul>
      </Doc>

      <Doc id="background" title="Background tasks">
        <p>
          Long work runs detached. When the agent calls <code>start_background_task</code> (or
          delegates a subagent with <code>run_in_background</code>), it gets a task id back
          immediately and keeps working or stops, and a notification arrives when the task
          finishes. The <em>Background</em> project tab lists every run with status, wall time,
          output, and a <em>Stop</em> button.
        </p>
        <ul>
          <li>
            On completion Home appends a notification to the originating chat and, if that chat is
            idle, runs a continuation turn that reacts to the result.
          </li>
          <li>
            Up to three tasks run at once; the rest queue. Statuses are{' '}
            <code>completed</code>, <code>failed</code>, <code>timed_out</code>,{' '}
            <code>stopped</code>, and <code>lost</code> (interrupted by a restart).
          </li>
        </ul>
      </Doc>

      <Doc id="capture" title="Capture notes">
        <p>
          Paste raw notes, an email, or a thread into the <em>Capture</em> project tab. The agent
          turns them into structure on your board: concrete items become tasks (with due dates
          when a deadline is stated), time-based nudges become reminders, client and people facts
          become memory tagged <code>client:&lt;name&gt;</code>, decisions become memories, and an
          implied ongoing signal can become a watch. It reports exactly what it created.
        </p>
      </Doc>

      <Doc id="files" title="Files &amp; gallery">
        <p>
          Agents write plans, specs, and research notes to a per-project <strong>workspace</strong>,
          kept outside the repository so your code stays clean.
        </p>
        <ul>
          <li>
            <strong>Files</strong> tab: the workspace files for the current project. Click one to
            read it (markdown is rendered).
          </li>
          <li>
            <strong>Gallery</strong>: generated files across every project, with a filter.
          </li>
          <li>
            The Home dashboard lists the newest generated files across all projects.
          </li>
        </ul>
      </Doc>

      <Doc id="automation" title="Search, inbox &amp; automations">
        <ul>
          <li>
            <strong>Search</strong> (Global section): search Totem memory, workspace file names and
            contents, and conversation titles across every project. Results jump straight to the
            memory browser, the file reader, or the conversation.
          </li>
          <li>
            <strong>Inbox</strong> (Home dashboard): new open pull requests and issues and failing
            CI runs appear here as they are discovered. The first poll of a project is a silent
            baseline; after that, new items arrive unread. <em>Check now</em> polls immediately,
            <em>Mark all read</em> clears the badge.
          </li>
          <li>
            <strong>Notifications</strong>: configure ntfy (<code>NTFY_TOPIC</code>, optional{' '}
            <code>NTFY_URL</code>/<code>NTFY_TOKEN</code>) or Telegram (
            <code>TELEGRAM_BOT_TOKEN</code> + <code>TELEGRAM_CHAT_ID</code>). The agent can push
            with the <code>notify</code> tool, new inbox items and scheduled run results push
            automatically, and a budget skip alerts you. Test from the <em>About</em> tab.
          </li>
          <li>
            <strong>Generated docs</strong> (Overview tab): one click writes an{' '}
            <code>ARCHITECTURE.md</code>, <code>ONBOARDING.md</code>, or an ADR from the project’s
            Totem memory and repository into the workspace.
          </li>
          <li>
            <strong>Automations</strong> (project tab): recurring agent runs. Pick an action
            (GitHub scan, code review, memory curation, docs, …), an interval, and an instruction;
            the background worker runs it and records the last report. Presets cover the nightly
            repo digest, daily PR review, and weekly memory curation. <em>Run now</em> executes one
            immediately. <code>{'{date}'}</code> in the instruction expands to the run date.
          </li>
          <li>
            <strong>Event triggers</strong>: set an automation's trigger to "When an event happens"
            and the agent reacts as things occur instead of on a schedule. Events are CI failures,
            pull requests and issues opened, watch matches, and tasks entering review or done. The
            instruction can use <code>{'{event}'}</code>, <code>{'{event_title}'}</code>, and{' '}
            <code>{'{event_url}'}</code>, with an optional filter substring. The agent can create
            these too via <code>schedule_create</code>.
          </li>
        </ul>
      </Doc>

      <Doc id="assistant" title="Reminders, watches &amp; briefing">
        <ul>
          <li>
            <strong>Reminders</strong> (Global section): one-shot, daily, or weekly nudges
            that fire a push notification. Add them in the view, or ask the agent
            ("remind me tomorrow at 9"). Snooze 10 minutes or 1 day, mark done, delete.
            Overdue items show in red and on the Home dashboard.
          </li>
          <li>
            <strong>Watches</strong> (Global section): monitor without noise. A
            <em>page</em> watch notifies when the page text changes, or when a phrase
            appears (then it completes). A <em>feed</em> watch notifies only on new
            RSS/Atom items. A <em>condition</em> watch runs a small agent check each
            interval and notifies when the condition is met. Pause, run now, and read
            the last result from the view; the agent can manage them with
            <code>watch_add</code>.
          </li>
          <li>
            <strong>Daily briefing</strong>: enable it under Settings, Assistant and pick
            a local time. Home sends one deterministic digest (due reminders, ready
            tasks, unread inbox); optionally the agent adds commentary and writes
            <code>briefings/&lt;date&gt;.md</code>.
          </li>
          <li>
            <strong>Daily plan and weekly review</strong>: enable each under Settings,
            Assistant with a local time (and a weekday for the review). The daily plan
            ranks ready work by priority and due date; the weekly review reports what
            moved, what is blocked or stale, and velocity. With a provider the agent
            writes <code>plans/&lt;date&gt;.md</code> or <code>reviews/&lt;date&gt;.md</code>{' '}
            to the workspace.
          </li>
          <li>
            <strong>Standing preferences</strong> (Settings, Assistant): your name,
            timezone, instructions, and a list of always-on preferences are injected
            into every system prompt and are applied without being asked. The clock in
            that context is what lets the agent resolve "tomorrow at 9".
          </li>
        </ul>
      </Doc>

      <Doc id="auth" title="Passkeys &amp; access">
        <p>
          Authentication is opt-in. With no <code>HOME_SETUP_TOKEN</code> set, Home behaves as
          before: anyone who can reach the port can use it. Set the variable to gate every API
          call behind a WebAuthn passkey.
        </p>
        <ul>
          <li>
            <strong>First passkey</strong>: open Home, enter the setup token on the login screen,
            and register a passkey (Touch ID, Windows Hello, security key, or a phone).
          </li>
          <li>
            <strong>Recovery</strong>: if you lose the device, register another passkey from the
            same screen with the setup token. Keep that token somewhere safe.
          </li>
          <li>
            <strong>Behind a proxy</strong>: set <code>HOME_RP_ID</code> to the domain (e.g.{' '}
            <code>home.example.com</code>) and <code>HOME_ORIGIN</code> to the full origin (e.g.{' '}
            <code>https://home.example.com</code>); set <code>HOME_COOKIE_SECURE=1</code> if TLS
            terminates upstream.
          </li>
          <li>
            <strong>Log out</strong> from the sidebar. Sessions last 30 days.
          </li>
        </ul>
      </Doc>

      <Doc id="settings" title="Settings &amp; theme">
        <p>
          Open <em>Settings</em> from the sidebar.
        </p>
        <ul>
          <li>
            <strong>Providers</strong>: add, test, and delete model endpoints.
          </li>
          <li>
            <strong>Assistant</strong>: name, timezone, standing instructions, daily
            briefing, and the web fetch toggle.
          </li>
          <li>
            <strong>Theme</strong>: tweak every colour. Changes are saved in your browser and
            applied instantly; <em>Reset to defaults</em> restores the built-in palette.
          </li>
        </ul>
      </Doc>

      <Doc id="tips" title="Tips &amp; troubleshooting">
        <ul>
          <li>
            <strong>“No provider configured”</strong>: add one in Settings and make sure the named
            environment variable is set where Home runs.
          </li>
          <li>
            <strong>Test fails</strong>: check the base URL (include the <code>/v1</code>) and that
            the model id is valid for that endpoint.
          </li>
          <li>
            <strong>Agent ignores your request</strong>: project code is read-only by default.
            Ask it to explain a change instead, have it write a plan to the workspace, or enable
            <em>Git writes</em> in About to let it branch and commit.
          </li>
          <li>
            <strong>Pick a role model</strong>: advanced mode lets a cheap model explore and a
            stronger one reason, which saves cost on large repositories.
          </li>
        </ul>
      </Doc>
    </div>
  )
}

// ---------- project overview ----------

const WELCOME_SUGGESTIONS = [
  'Explain how this codebase is structured',
  'Find and fix a bug in the repository',
  'Write tests for the core module',
  'Draft a plan for a new feature',
]

function Stat({ icon, label, value, tone, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`stat ${tone || ''} ${onClick ? 'clickable' : ''}`}
      onClick={onClick}
    >
      <span className="stat-top">
        <Icon name={icon} size={14} className="stat-icon" />
        <span className="stat-label">{label}</span>
      </span>
      <span className="stat-value">{value}</span>
      {onClick && <Icon name="chevronRight" size={14} className="stat-arrow" />}
    </Tag>
  )
}

const CHANGE_FIELDS = [
  { key: 'commits', label: 'commits', icon: 'git' },
  { key: 'memories', label: 'memories', icon: 'memory' },
  { key: 'files', label: 'files', icon: 'files' },
  { key: 'prs', label: 'PRs', icon: 'git' },
  { key: 'issues', label: 'issues', icon: 'chat' },
  { key: 'failed_runs', label: 'failed runs', icon: 'alert' },
]

function DocsSection({ projectId }) {
  const [kind, setKind] = useState('architecture')
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const generate = () => {
    setBusy(true)
    setError(null)
    setResult(null)
    api
      .generateDoc(projectId, { kind, topic: kind === 'adr' ? topic : undefined })
      .then(setResult)
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="docs-card">
      <div className="docs-head">
        <Icon name="files" size={15} />
        <span>Generated docs</span>
        <span className="muted">from Totem memory</span>
      </div>
      <div className="row" style={{ marginBottom: 0 }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="architecture">Architecture · ARCHITECTURE.md</option>
          <option value="onboarding">Onboarding · ONBOARDING.md</option>
          <option value="adr">ADR · adr/&lt;topic&gt;.md</option>
        </select>
        {kind === 'adr' && (
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Decision topic"
          />
        )}
        <button
          className="btn"
          onClick={generate}
          disabled={busy || (kind === 'adr' && !topic.trim())}
        >
          {busy ? (
            <>
              <Spinner size={13} /> Generating
            </>
          ) : (
            <>
              <Icon name="sparkles" size={13} /> Generate
            </>
          )}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {result && (
        <p className="note">
          Wrote <code>{result.path}</code>. {result.report}
        </p>
      )}
    </div>
  )
}

// ---------- overview card details ----------

function DetailRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  )
}

function GitDetail({ id, git }) {
  if (!git) return <p className="muted">No repository data.</p>
  if (id === 'commit') {
    const c = git.last_commit
    if (!c) return <p className="muted">No commits yet.</p>
    return (
      <>
        <DetailRow label="Subject" value={c.subject} />
        <DetailRow label="SHA" value={c.sha} />
        <DetailRow label="Author" value={c.author} />
        <DetailRow label="Date" value={relDate(c.date)} />
      </>
    )
  }
  return (
    <>
      {id === 'branch' && <DetailRow label="Branch" value={git.branch} />}
      {id === 'branch' && <DetailRow label="HEAD" value={git.head} />}
      <DetailRow label="Ahead" value={`${git.ahead} commit(s)`} />
      <DetailRow label="Behind" value={`${git.behind} commit(s)`} />
      <DetailRow label="Working tree" value={git.dirty ? 'Uncommitted changes' : 'Clean'} />
    </>
  )
}

function UsageDetail({ usage }) {
  if (!usage) return <p className="muted">No usage recorded yet.</p>
  return (
    <>
      <DetailRow label="Total tokens" value={fmtTokens(usage.total.tokens)} />
      <DetailRow label="Agent runs" value={usage.total.runs} />
      <DetailRow label="This month" value={fmtTokens(usage.month.tokens)} />
      {usage.budget?.budget ? (
        <DetailRow
          label="Monthly budget"
          value={`${fmtTokens(usage.budget.budget)} (${usage.budget.percent}%)`}
        />
      ) : null}
    </>
  )
}

function DetailItem({ title, sub, onChat, url, chatLabel = 'Chat' }) {
  return (
    <div className="detail-item">
      <div className="detail-item-main">
        <span className="detail-item-title">{title}</span>
        {sub && <span className="detail-item-sub">{sub}</span>}
      </div>
      <div className="detail-item-actions">
        {url && (
          <a className="btn" href={url} target="_blank" rel="noreferrer">
            Open
          </a>
        )}
        {onChat && (
          <button className="btn" onClick={onChat}>
            <Icon name="chat" size={13} /> {chatLabel}
          </button>
        )}
      </div>
    </div>
  )
}

function TasksDetail({ projectId, onStart }) {
  const { data, loading, error } = useAsync(() => api.listTasks(projectId), [projectId])
  if (loading) return <Skeleton className="row-skeleton" />
  if (error) return <p className="error-text">{error}</p>
  const tasks = (data || []).filter((t) => t.status !== 'done')
  if (!tasks.length) return <p className="muted">No open tasks.</p>
  return (
    <div className="detail-list">
      {tasks.map((t) => (
        <DetailItem
          key={t.id}
          title={t.title}
          sub={`${t.status}${t.priority ? ` · ${t.priority}` : ''}`}
          onChat={() => onStart(`Let's work on the task "${t.title}"`)}
        />
      ))}
    </div>
  )
}

function GithubDetail({ projectId, kind, state = 'open', max, onStart }) {
  const { data, loading, error } = useAsync(
    () => api.projectGithub(projectId, kind, state),
    [projectId, kind, state]
  )
  if (loading) return <Skeleton className="row-skeleton" />
  if (error) return <p className="error-text">{error}</p>
  if (data && data.available === false)
    return <p className="muted">{data.error || 'GitHub is unavailable for this project.'}</p>
  let items = (data && data.items) || []
  if (max) items = items.slice(0, max)
  if (!items.length) return <p className="muted">Nothing to show.</p>
  const noun = kind === 'prs' ? 'PR' : kind === 'issues' ? 'issue' : 'run'
  return (
    <div className="detail-list">
      {items.map((it) => {
        const key = it.number ?? it.id
        const name = it.title || it.name || `${noun} ${key}`
        return (
          <DetailItem
            key={key}
            title={it.number ? `#${it.number} ${name}` : name}
            sub={[it.state || it.conclusion || it.status, it.user, it.branch]
              .filter(Boolean)
              .join(' · ')}
            url={it.url}
            onChat={() => onStart(`Let's discuss ${noun} ${it.number ? `#${it.number}` : ''}: ${name}`)}
          />
        )
      })}
    </div>
  )
}

function OverviewDetailModal({ detail, project, git, usage, github, onStart, onClose, onOpenSettings }) {
  return (
    <Modal title={detail.title} onClose={onClose}>
      {['branch', 'commit', 'sync'].includes(detail.id) && (
        <GitDetail id={detail.id} git={git} />
      )}
      {detail.id === 'tasks' && <TasksDetail projectId={project.id} onStart={onStart} />}
      {detail.id === 'tokens' && <UsageDetail usage={usage} />}
      {['prs', 'issues', 'runs', 'ci'].includes(detail.id) && (
        <GithubDetail
          projectId={project.id}
          kind={detail.id === 'ci' ? 'runs' : detail.id}
          max={detail.id === 'ci' ? 1 : undefined}
          onStart={onStart}
        />
      )}
      {detail.id === 'github' && (
        <>
          <p className="muted">{github?.reason || 'GitHub is not connected for this project.'}</p>
          <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
            <button className="btn primary" onClick={() => onOpenSettings('github')}>
              Open GitHub settings
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

function ProjectOverviewView({ project, since, onStart, onNavigate, onOpenSettings }) {
  const ready = since !== undefined
  const { data, error, loading } = useAsync(
    () => (ready ? api.projectStatus(project.id, since || undefined) : Promise.resolve(null)),
    [project.id, since]
  )
  const usageReq = useAsync(() => api.projectUsage(project.id), [project.id])
  const usage = usageReq.data
  const firstVisit = since === null
  const git = data?.git
  const github = data?.github
  const tasks = data?.tasks
  const changes = data?.changes
  const [detail, setDetail] = useState(null)

  const runTone = (run) => {
    if (!run) return ''
    if (run.conclusion === 'success') return 'ok'
    if (run.conclusion === 'failure') return 'err'
    return ''
  }

  return (
    <div className="overview">
      {!firstVisit && changes && changes.total > 0 && (
        <button
          type="button"
          className="digest clickable"
          onClick={() => onNavigate({ type: 'activity' })}
        >
          <span className="digest-head">
            <Icon name="sparkles" size={16} />
            <span>Since your last visit</span>
          </span>
          <span className="digest-chips">
            {CHANGE_FIELDS.filter((f) => changes.counts[f.key] > 0).map((f) => (
              <span key={f.key} className="digest-chip">
                <Icon name={f.icon} size={12} />
                {changes.counts[f.key]} {f.label}
              </span>
            ))}
          </span>
          <Icon name="chevronRight" size={16} className="digest-arrow" />
        </button>
      )}
      {!firstVisit && changes && changes.total === 0 && (
        <div className="digest caught-up">
          <Icon name="check" size={15} /> You are all caught up since your last visit.
        </div>
      )}

      {usage?.budget?.budget && (
        <button
          type="button"
          className={`digest clickable ${usage.budget.percent >= 80 ? 'budget-alert' : ''}`}
          onClick={() => setDetail({ id: 'tokens', title: 'Token usage' })}
        >
          <span className="digest-head">
            <Icon name="alert" size={16} />
            <span>Token budget</span>
          </span>
          <span className="digest-chips">
            <span className="digest-chip">
              {fmtTokens(usage.month.tokens)} / {fmtTokens(usage.budget.budget)} this month (
              {usage.budget.percent}%)
            </span>
            {usage.budget.enforced && (
              <span className="digest-chip">
                scheduled runs {usage.budget.over ? 'paused' : 'allowed'}
              </span>
            )}
          </span>
          <Icon name="chevronRight" size={16} className="digest-arrow" />
        </button>
      )}

      <div className="overview-hero">
        <div>
          <h1>{project.name}</h1>
          <div className="repo">
            <Icon name="git" size={13} />
            <code>{project.repo_url}</code>
          </div>
        </div>
        <button className="btn" onClick={() => onNavigate({ type: 'tasks' })}>
          <Icon name="tasks" size={14} /> Task board
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {loading || !ready ? (
        <div className="stat-grid">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="stat-skeleton" />
          ))}
        </div>
      ) : (
        <div className="stat-grid">
          <Stat
            icon="git"
            label="Branch"
            value={git?.branch || 'unknown'}
            onClick={() => setDetail({ id: 'branch', title: 'Branch' })}
          />
          <Stat
            icon="git"
            label="Last commit"
            value={truncate(git?.last_commit?.subject, 42) || 'none'}
            onClick={() => setDetail({ id: 'commit', title: 'Last commit' })}
          />
          <Stat
            icon="refresh"
            label="Sync"
            value={
              git && (git.ahead || git.behind)
                ? `${git.ahead}↑ ${git.behind}↓`
                : git?.dirty
                  ? 'Local changes'
                  : 'Up to date'
            }
            onClick={() => setDetail({ id: 'sync', title: 'Sync status' })}
          />
          <Stat
            icon="tasks"
            label="Open tasks"
            value={tasks ? tasks.open : '-'}
            onClick={() => setDetail({ id: 'tasks', title: 'Open tasks' })}
          />
          <Stat
            icon="sparkles"
            label="Tokens used"
            value={usage ? fmtTokens(usage.total.tokens) : '-'}
            onClick={() => setDetail({ id: 'tokens', title: 'Token usage' })}
          />
          {github?.available ? (
            <>
              <Stat
                icon="git"
                label="Open PRs"
                value={github.open_prs}
                onClick={() => setDetail({ id: 'prs', title: 'Open pull requests' })}
              />
              <Stat
                icon="chat"
                label="Open issues"
                value={github.open_issues}
                onClick={() => setDetail({ id: 'issues', title: 'Open issues' })}
              />
              <Stat
                icon="alert"
                label="Failing runs"
                value={github.failing_runs}
                tone={github.failing_runs ? 'err' : ''}
                onClick={() => setDetail({ id: 'runs', title: 'CI runs' })}
              />
              <Stat
                icon="play"
                label="Latest CI"
                value={
                  github.latest_run
                    ? github.latest_run.conclusion || github.latest_run.status
                    : 'none'
                }
                tone={runTone(github.latest_run)}
                onClick={() => setDetail({ id: 'ci', title: 'Latest CI run' })}
              />
            </>
          ) : (
            <Stat
              icon="alert"
              label="GitHub"
              value="Not connected"
              onClick={() => setDetail({ id: 'github', title: 'GitHub' })}
            />
          )}
        </div>
      )}

      {detail && (
        <OverviewDetailModal
          detail={detail}
          project={project}
          git={git}
          usage={usage}
          github={github}
          onStart={onStart}
          onClose={() => setDetail(null)}
          onOpenSettings={onOpenSettings}
        />
      )}

      <DocsSection projectId={project.id} />

      <div className="overview-prompt">
        <Composer
          busy={false}
          placeholder="Ask anything, or describe a task..."
          onSend={(msg) => onStart(msg)}
        />
      </div>
      <div className="suggestions">
        {WELCOME_SUGGESTIONS.map((s) => (
          <button key={s} className="suggestion" onClick={() => onStart(s)}>
            <span>{s}</span>
            <Icon name="arrowUp" size={14} className="suggestion-arrow" />
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- github ----------

function GithubItemModal({ item, kind, triaging, reviewing, onClose, onChat, onTriage, onReview }) {
  const noun = kind === 'prs' ? 'pull request' : kind === 'issues' ? 'issue' : 'run'
  const name = item.title || item.name || `${noun}`
  const label = item.number != null ? `#${item.number} ${name}` : name
  return (
    <Modal title={label} onClose={onClose}>
      <div className="detail-rows">
        <DetailRow label="Type" value={noun} />
        <DetailRow label="State" value={item.conclusion || item.state || item.status} />
        {item.user && <DetailRow label="Author" value={item.user} />}
        {item.branch && <DetailRow label="Branch" value={item.branch} />}
        {item.event && <DetailRow label="Event" value={item.event} />}
        {item.labels?.length > 0 && <DetailRow label="Labels" value={item.labels.join(', ')} />}
        {item.updated_at && <DetailRow label="Updated" value={relDate(item.updated_at)} />}
      </div>
      <div className="row" style={{ marginTop: 16, marginBottom: 0, flexWrap: 'wrap' }}>
        {onChat && kind !== 'runs' && (
          <button
            className="btn primary"
            onClick={() => {
              onClose()
              onChat(
                `Let's discuss ${noun} #${item.number}: "${name}". Explain the context and what should happen next.`
              )
            }}
          >
            <Icon name="chat" size={13} /> Chat about this
          </button>
        )}
        {onTriage && kind !== 'runs' && (
          <button
            className="btn"
            disabled={triaging === item.number}
            onClick={() => {
              onClose()
              onTriage(item)
            }}
          >
            <Icon name="tasks" size={13} /> Triage
          </button>
        )}
        {onReview && kind !== 'runs' && (
          <button
            className="btn"
            disabled={reviewing === item.number}
            onClick={() => {
              onClose()
              onReview(item)
            }}
          >
            <Icon name="check" size={13} /> Review
          </button>
        )}
        {item.url && (
          <a className="btn" href={item.url} target="_blank" rel="noreferrer">
            Open on GitHub
          </a>
        )}
      </div>
    </Modal>
  )
}

function GithubView({ projectId, onSummarize, onOpenTasks }) {
  const [kind, setKind] = useState('prs')
  const [state, setState] = useState('open')
  const [selected, setSelected] = useState(null)
  const [triaging, setTriaging] = useState(null)
  const [triageReport, setTriageReport] = useState(null)
  const [reviewing, setReviewing] = useState(null)
  const [reviewReport, setReviewReport] = useState(null)
  const { data, error, loading, reload } = useAsync(
    () => api.projectGithub(projectId, kind, kind === 'runs' ? 'open' : state),
    [projectId, kind, state]
  )
  const items = (data && data.items) || []

  const badgeTone = (value) => {
    if (['open', 'success'].includes(value)) return 'ok'
    if (['failure', 'closed'].includes(value)) return 'err'
    return ''
  }

  const runTriage = (it) => {
    setTriaging(it.number)
    api
      .triage(projectId, { kind: kind === 'prs' ? 'pr' : 'issue', number: it.number })
      .then((r) => setTriageReport({ ...r, item: it }))
      .catch((e) => setTriageReport({ error: e.message || String(e), item: it }))
      .finally(() => setTriaging(null))
  }

  const runReview = (it) => {
    setReviewing(it.number)
    api
      .reviewItem(projectId, { kind: kind === 'prs' ? 'pr' : 'issue', number: it.number })
      .then((r) => setReviewReport({ ...r, item: it }))
      .catch((e) => setReviewReport({ error: e.message || String(e), item: it }))
      .finally(() => setReviewing(null))
  }

  return (
    <div className="center-col wide">
      <div className="page-head">
        <h2>GitHub</h2>
        <button className="btn" onClick={reload} disabled={loading}>
          <Icon name="refresh" size={14} />
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      <div className="gh-toolbar">
        <div className="segmented">
          <button className={kind === 'prs' ? 'on' : ''} onClick={() => setKind('prs')}>
            Pull requests
          </button>
          <button className={kind === 'issues' ? 'on' : ''} onClick={() => setKind('issues')}>
            Issues
          </button>
          <button className={kind === 'runs' ? 'on' : ''} onClick={() => setKind('runs')}>
            CI runs
          </button>
        </div>
        {kind !== 'runs' && (
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}
      {data && !data.available && (
        <SectionEmpty
          icon="alert"
          title="GitHub unavailable"
          hint={data.error || 'This project has no GitHub remote, or no token is configured.'}
        />
      )}
      {loading && (
        <div className="gh-list">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="row-skeleton" />
          ))}
        </div>
      )}
      {!loading && data && data.available && items.length === 0 && (
        <SectionEmpty icon="check" title="Nothing here" hint="No items for this filter." />
      )}
      <div className="gh-list">
        {items.map((it) => (
          <div
            key={it.number ?? it.id}
            className="gh-row clickable"
            {...clickable(() => setSelected(it))}
          >
            <Icon
              name={kind === 'runs' ? 'play' : kind === 'issues' ? 'chat' : 'git'}
              size={15}
              className="gh-row-icon"
            />
            <div className="gh-row-main">
              <div className="gh-row-title">
                {it.number != null && <span className="gh-num">#{it.number}</span>}
                {it.title || it.name}
              </div>
              <div className="gh-row-meta">
                {it.user && <span>{it.user}</span>}
                {it.branch && <span>{it.branch}</span>}
                {it.event && <span>{it.event}</span>}
                {it.labels?.length > 0 && <span>{it.labels.join(', ')}</span>}
                {it.updated_at && <span>{relDate(it.updated_at)}</span>}
              </div>
            </div>
            <span className={`badge ${badgeTone(it.conclusion || it.state)}`}>
              {it.conclusion || it.state}
            </span>
            <div className="gh-row-actions" onClick={(e) => e.stopPropagation()}>
              {kind !== 'runs' && (
                <button
                  className="btn primary"
                  title="Turn into a plan + tasks"
                  disabled={triaging === it.number}
                  onClick={() => runTriage(it)}
                >
                  {triaging === it.number ? (
                    <>
                      <Spinner size={13} /> Triaging
                    </>
                  ) : (
                    <>
                      <Icon name="tasks" size={13} /> Triage
                    </>
                  )}
                </button>
              )}
              {kind !== 'runs' && (
                <button
                  className="btn"
                  title="Review with the code-reviewer agent"
                  disabled={reviewing === it.number}
                  onClick={() => runReview(it)}
                >
                  {reviewing === it.number ? (
                    <>
                      <Spinner size={13} /> Reviewing
                    </>
                  ) : (
                    <>
                      <Icon name="check" size={13} /> Review
                    </>
                  )}
                </button>
              )}
              {onSummarize && kind !== 'runs' && (
                <button
                  className="btn"
                  title="Summarize with the agent"
                  onClick={() =>
                    onSummarize(
                      `Summarize ${kind === 'prs' ? 'pull request' : 'issue'} #${it.number}: "${it.title}". Explain what it is, what changed or is requested, and anything notable.`
                    )
                  }
                >
                  <Icon name="sparkles" size={13} />
                </button>
              )}
              {it.url && (
                <a className="btn" href={it.url} target="_blank" rel="noreferrer">
                  Open
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <GithubItemModal
          item={selected}
          kind={kind}
          triaging={triaging}
          reviewing={reviewing}
          onClose={() => setSelected(null)}
          onChat={onSummarize}
          onTriage={runTriage}
          onReview={runReview}
        />
      )}

      {reviewReport && (
        <Modal title={`Review · ${reviewReport.item.title}`} onClose={() => setReviewReport(null)}>
          {reviewReport.error && <p className="error-text">{reviewReport.error}</p>}
          {reviewReport.report && (
            <div
              className="reader-body prose"
              dangerouslySetInnerHTML={{ __html: mdToHtml(reviewReport.report) }}
            />
          )}
          {reviewReport.path && (
            <p className="note">
              Review: <code>{reviewReport.path}</code>
            </p>
          )}
        </Modal>
      )}

      {triageReport && (
        <Modal title={`Triage · ${triageReport.item.title}`} onClose={() => setTriageReport(null)}>
          {triageReport.error && <p className="error-text">{triageReport.error}</p>}
          {triageReport.report && (
            <div
              className="reader-body prose"
              dangerouslySetInnerHTML={{ __html: mdToHtml(triageReport.report) }}
            />
          )}
          {triageReport.path && (
            <p className="note">
              Plan: <code>{triageReport.path}</code>
            </p>
          )}
          <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
            <button
              className="btn"
              onClick={() => {
                setTriageReport(null)
                if (onOpenTasks) onOpenTasks()
              }}
            >
              <Icon name="tasks" size={14} /> View tasks
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ---------- activity ----------

const ACTIVITY_META = {
  session: { icon: 'chat', label: 'Conversation' },
  memory: { icon: 'memory', label: 'Memory' },
  file: { icon: 'files', label: 'File' },
  commit: { icon: 'git', label: 'Commit' },
  pr: { icon: 'git', label: 'Pull request' },
  issue: { icon: 'chat', label: 'Issue' },
  run: { icon: 'play', label: 'CI run' },
}

function dayLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const today = new Date()
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(today) - startOf(d)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function ActivityView({ projectId, onOpenSession, onOpenFile }) {
  const { data, error, loading } = useAsync(() => api.projectActivity(projectId), [projectId])
  const items = (data && data.items) || []

  const groups = useMemo(() => {
    const out = []
    let current = null
    for (const item of items) {
      const label = dayLabel(item.timestamp)
      if (!current || current.label !== label) {
        current = { label, items: [] }
        out.push(current)
      }
      current.items.push(item)
    }
    return out
  }, [items])

  return (
    <div className="center-col">
      <div className="page-head">
        <h2>Activity</h2>
      </div>
      {error && <p className="error-text">{error}</p>}
      {loading && (
        <div className="gh-list">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="row-skeleton" />
          ))}
        </div>
      )}
      {!loading && items.length === 0 && (
        <SectionEmpty
          icon="clock"
          title="No activity yet"
          hint="Conversations, memory, files, commits, and GitHub events will appear here."
        />
      )}
      {groups.map((group) => (
        <div key={group.label} className="activity-group">
          <div className="activity-day">{group.label}</div>
          {group.items.map((item, i) => {
            const meta = ACTIVITY_META[item.kind] || { icon: 'clock' }
            const clickable = item.session_id || item.path
            return (
              <button
                key={`${item.kind}-${item.timestamp}-${i}`}
                className={`activity-row ${clickable ? 'clickable' : ''} ${item.url ? 'external' : ''}`}
                onClick={() => {
                  if (item.session_id) onOpenSession(item.session_id)
                  else if (item.path) onOpenFile(item)
                  else if (item.url) window.open(item.url, '_blank', 'noreferrer')
                }}
              >
                <span className={`activity-icon ${item.kind}`}>
                  <Icon name={meta.icon} size={14} />
                </span>
                <span className="activity-main">
                  <span className="activity-title">{truncate(item.title, 90)}</span>
                  <span className="activity-sub">{item.subtitle}</span>
                </span>
                <span className="activity-time">{relDate(item.timestamp)}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ---------- kanban tasks ----------

const TASK_COLUMNS = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'todo', label: 'To do' },
  { key: 'doing', label: 'In progress' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
]

const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' }

function dueInfo(due) {
  if (!due) return null
  const d = new Date(due)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((d - today) / 86400000)
  return {
    text: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    overdue: d < today,
    soon: days >= 0 && days <= 2,
  }
}

function TaskEditor({ task, projectId, onClose, onSaved, onImplement, gitWrites }) {
  const isNew = !task.id
  const [title, setTitle] = useState(task.title || '')
  const [description, setDescription] = useState(task.description || '')
  const [status, setStatus] = useState(task.status || 'backlog')
  const [priority, setPriority] = useState(task.priority || 'medium')
  const [milestoneId, setMilestoneId] = useState(task.milestone_id || '')
  const [dueDate, setDueDate] = useState((task.due_at || '').slice(0, 10))
  const [dependsOn, setDependsOn] = useState(task.depends_on || [])
  const [acceptance, setAcceptance] = useState(task.acceptance || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [commentBody, setCommentBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [running, setRunning] = useState(false)
  const [issueNumber, setIssueNumber] = useState(task.github_issue || null)
  const milestonesReq = useAsync(() => api.listMilestones(projectId), [projectId])
  const milestones = milestonesReq.data || []
  const tasksReq = useAsync(() => api.listTasks(projectId), [projectId])
  const otherTasks = (tasksReq.data || []).filter((t) => t.id !== task.id)
  const commentsReq = useAsync(
    () => (task.id ? api.listComments(task.id) : Promise.resolve([])),
    [task.id]
  )
  const comments = commentsReq.data || []

  const toggleDep = (id) => {
    setDependsOn((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    )
  }

  const postComment = (e) => {
    e.preventDefault()
    if (!commentBody.trim()) return
    setPosting(true)
    api
      .addComment(task.id, { body: commentBody.trim() })
      .then(() => {
        setCommentBody('')
        commentsReq.reload()
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setPosting(false))
  }

  const implement = () => {
    const brief = [
      `Implement this task from the project board.`,
      ``,
      `## Task #${task.id}: ${task.title}`,
      description || '(no description)',
      ``,
      `Acceptance criteria: ${acceptance || '(none)'}`,
      ...(task.blocked_by?.length ? [`Blocked by: task ${task.blocked_by.join(', ')}`] : []),
      ...(comments.length
        ? [``, `Comments:`, ...comments.map((c) => `- ${c.author}: ${c.body}`)]
        : []),
      ``,
      `When you are done, leave a comment with task_comment and move the task to review with task_update.`,
    ].join('\n')
    api.updateTask(task.id, { status: 'doing' }).catch(() => {})
    onImplement(brief)
  }

  const runInBackground = () => {
    setRunning(true)
    setError(null)
    api
      .implementTask(task.id)
      .then(() => {
        onSaved?.()
        onClose()
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setRunning(false))
  }

  const syncIssue = () => {
    setSyncing(true)
    setError(null)
    api
      .syncIssues(projectId, { task_ids: [task.id] })
      .then((r) => {
        const created = (r.created || [])[0]
        if (created) setIssueNumber(created.issue)
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setSyncing(false))
  }

  const save = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    const body = {
      title: title.trim(),
      description,
      acceptance,
      status,
      priority,
      milestone_id: milestoneId ? parseInt(milestoneId, 10) : 0,
      depends_on: dependsOn,
      due_at: dueDate || '',
    }
    if (!isNew && status === 'done' && task.status !== 'done' && acceptance.trim()) {
      const ok = window.confirm(
        `Acceptance criteria:\n${acceptance}\n\nConfirm the review and mark this task done?`
      )
      if (!ok) {
        setSaving(false)
        return
      }
      body.reviewed = true
    }
    const req = isNew
      ? api.createTask(projectId, body)
      : api.updateTask(task.id, body)
    req
      .then(onSaved)
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setSaving(false))
  }

  const remove = () => {
    if (isNew) return onClose()
    if (!window.confirm('Delete this task?')) return
    api.deleteTask(task.id).then(onSaved).catch((err) => setError(err.message))
  }

  return (
    <Modal title={isNew ? 'New task' : 'Edit task'} onClose={onClose}>
      <form className="agent-form" onSubmit={save}>
        <label className="field">
          <span className="field-label">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        </label>
        <label className="field">
          <span className="field-label">Description</span>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional detail, links..."
          />
        </label>
        <label className="field">
          <span className="field-label">Acceptance criteria</span>
          <textarea
            rows={2}
            value={acceptance}
            onChange={(e) => setAcceptance(e.target.value)}
            placeholder="How do we verify this is done? (gates the Done column)"
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Column</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {TASK_COLUMNS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Due date</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Milestone</span>
            <select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
              <option value="">No milestone</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        {otherTasks.length > 0 && (
          <div className="field">
            <span className="field-label">Blocked by</span>
            <div className="dep-list">
              {otherTasks.map((t) => (
                <label key={t.id} className="dep-item">
                  <input
                    type="checkbox"
                    checked={dependsOn.includes(t.id)}
                    onChange={() => toggleDep(t.id)}
                  />
                  <span className="dep-title">{t.title}</span>
                  <span className={`badge ${t.status === 'done' ? 'ok' : ''}`}>{t.status}</span>
                </label>
              ))}
            </div>
            <span className="field-hint">
              This task is blocked until every selected task is done.
            </span>
          </div>
        )}
        {!isNew && (
          <div className="field">
            <span className="field-label">Comments</span>
            <div className="comment-list">
              {comments.length === 0 && <div className="field-hint">No comments yet.</div>}
              {comments.map((c) => (
                <div key={c.id} className="comment-row">
                  <span className="comment-author">{c.author}</span>
                  <span className="comment-body">{c.body}</span>
                  <span className="comment-time">{relDate(c.created_at)}</span>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginBottom: 0 }}>
              <input
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Leave a note for the next session..."
              />
              <button
                type="button"
                className="btn"
                disabled={posting || !commentBody.trim()}
                onClick={postComment}
              >
                {posting ? <Spinner size={13} /> : 'Comment'}
              </button>
            </div>
          </div>
        )}
        <div className="row" style={{ marginBottom: 0 }}>
          <button className="btn primary" disabled={saving || !title.trim()}>
            {saving ? (
              <>
                <Spinner size={14} /> Saving
              </>
            ) : isNew ? (
              'Create task'
            ) : (
              'Save changes'
            )}
          </button>
          {!isNew && onImplement && (
            <button type="button" className="btn" onClick={implement}>
              <Icon name="sparkles" size={14} /> Implement with agent
            </button>
          )}
          {!isNew && gitWrites && (
            <button type="button" className="btn" disabled={running} onClick={runInBackground}>
              {running ? (
                <>
                  <Spinner size={13} /> Starting
                </>
              ) : (
                <>
                  <Icon name="play" size={14} /> Run in background
                </>
              )}
            </button>
          )}
          {task.pr_url && (
            <a className="note" href={task.pr_url} target="_blank" rel="noreferrer">
              Pull request
            </a>
          )}
          {!isNew && gitWrites && !issueNumber && (
            <button type="button" className="btn" disabled={syncing} onClick={syncIssue}>
              {syncing ? (
                <>
                  <Spinner size={13} /> Pushing
                </>
              ) : (
                <>
                  <Icon name="git" size={14} /> Push to GitHub
                </>
              )}
            </button>
          )}
          {issueNumber && <span className="badge">issue #{issueNumber}</span>}
          {!isNew && (
            <button type="button" className="btn danger" onClick={remove}>
              Delete
            </button>
          )}
        </div>
        {error && <div className="error-text">{error}</div>}
      </form>
    </Modal>
  )
}

function TasksView({ projectId, onImplement, gitWrites }) {
  const { data, error, loading, reload } = useAsync(() => api.listTasks(projectId), [projectId])
  const [tasks, setTasks] = useState([])
  const [dragId, setDragId] = useState(null)
  const [editor, setEditor] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestReport, setSuggestReport] = useState(null)
  const [suggestError, setSuggestError] = useState(null)
  const [runningNext, setRunningNext] = useState(false)

  const runNext = () => {
    setRunningNext(true)
    setSuggestError(null)
    api
      .runNextTask(projectId)
      .then(() => reload())
      .catch((e) => setSuggestError(e.message || String(e)))
      .finally(() => setRunningNext(false))
  }

  const suggest = () => {
    setSuggesting(true)
    setSuggestError(null)
    setSuggestReport(null)
    api
      .suggestTasks(projectId)
      .then((r) => {
        setSuggestReport(r)
        reload()
      })
      .catch((e) => setSuggestError(e.message || String(e)))
      .finally(() => setSuggesting(false))
  }

  useEffect(() => {
    if (data) setTasks(data)
  }, [data])

  const columns = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => a.position - b.position)
    return TASK_COLUMNS.map((col) => ({
      ...col,
      tasks: sorted.filter((t) => t.status === col.key),
    }))
  }, [tasks])

  const move = (taskId, status, beforeTask = null) => {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    const siblings = tasks
      .filter((t) => t.status === status && t.id !== taskId)
      .sort((a, b) => a.position - b.position)
    let position
    if (beforeTask) {
      const idx = siblings.findIndex((t) => t.id === beforeTask.id)
      const prev = siblings[idx - 1]
      const next = siblings[idx] || beforeTask
      position = prev ? (prev.position + next.position) / 2 : next.position - 1
    } else {
      position = siblings.length ? siblings[siblings.length - 1].position + 1 : 0
    }
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status, position } : t))
    )
    api.updateTask(taskId, { status, position }).then(reload).catch(() => reload())
  }

  const onDropColumn = (e, status) => {
    e.preventDefault()
    if (dragId != null) move(dragId, status)
    setDragId(null)
  }

  const onDropCard = (e, card) => {
    e.preventDefault()
    e.stopPropagation()
    if (dragId != null && dragId !== card.id) move(dragId, card.status, card)
    setDragId(null)
  }

  return (
    <div className="tasks">
      <div className="page-head">
        <h2>Tasks</h2>
        <div className="row" style={{ marginBottom: 0 }}>
          <button className="btn" disabled={suggesting} onClick={suggest}>
            {suggesting ? (
              <>
                <Spinner size={13} /> Thinking
              </>
            ) : (
              <>
                <Icon name="sparkles" size={14} /> Suggest next work
              </>
            )}
          </button>
          {gitWrites && (
            <button className="btn" disabled={runningNext} onClick={runNext}>
              {runningNext ? (
                <>
                  <Spinner size={13} /> Starting
                </>
              ) : (
                <>
                  <Icon name="play" size={14} /> Run next
                </>
              )}
            </button>
          )}
          <button className="btn primary" onClick={() => setEditor({ status: 'backlog' })}>
            <Icon name="plus" size={14} /> New task
          </button>
        </div>
      </div>
      {suggestError && <p className="error-text">{suggestError}</p>}
      {error && <p className="error-text">{error}</p>}
      {loading ? (
        <div className="kanban">
          {TASK_COLUMNS.map((c) => (
            <div key={c.key} className="kanban-col">
              <Skeleton className="row-skeleton" />
              <Skeleton className="row-skeleton" style={{ marginTop: 8 }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="kanban">
          {columns.map((col) => (
            <div
              key={col.key}
              className={`kanban-col ${dragId != null ? 'droppable' : ''}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDropColumn(e, col.key)}
            >
              <div className="kanban-col-head">
                <span className="kanban-col-title">{col.label}</span>
                <span className="kanban-count">{col.tasks.length}</span>
              </div>
              <div className="kanban-cards">
                {col.tasks.map((t) => (
                  <div
                    key={t.id}
                    className={`kanban-card ${dragId === t.id ? 'dragging' : ''}`}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => setDragId(null)}
                    onDrop={(e) => onDropCard(e, t)}
                    onClick={() => setEditor(t)}
                  >
                    <div className="kanban-card-title">{t.title}</div>
                    {t.blocked_by?.length > 0 && (
                      <div className="kanban-card-blocked">
                        <span className="badge err" title={`Blocked by task ${t.blocked_by.join(', ')}`}>
                          blocked
                        </span>
                      </div>
                    )}
                    {t.description && (
                      <div className="kanban-card-desc">{truncate(t.description, 120)}</div>
                    )}
                    <div className="kanban-card-foot">
                      <span className={`priority ${t.priority}`}>
                        {PRIORITY_LABEL[t.priority]}
                      </span>
                      {t.source === 'suggested' && <span className="badge accent">suggested</span>}
                      {(() => {
                        const dl = dueInfo(t.due_at)
                        return (
                          dl && (
                            <span
                              className={`due-chip ${dl.overdue ? 'overdue' : dl.soon ? 'soon' : ''}`}
                              title="Due date"
                            >
                              <Icon name="clock" size={11} /> {dl.text}
                            </span>
                          )
                        )
                      })()}
                      {t.pr_url && (
                        <a
                          className="due-chip"
                          href={t.pr_url}
                          target="_blank"
                          rel="noreferrer"
                          title="Pull request"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Icon name="git" size={11} /> PR
                        </a>
                      )}
                      <span className="kanban-card-time">{relDate(t.updated_at)}</span>
                    </div>
                  </div>
                ))}
                <button
                  className="kanban-add"
                  onClick={() => setEditor({ status: col.key })}
                >
                  <Icon name="plus" size={13} /> Add
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editor && (
        <TaskEditor
          projectId={projectId}
          task={editor}
          onImplement={onImplement}
          gitWrites={gitWrites}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            reload()
          }}
        />
      )}

      {suggestReport && (
        <Modal title="Suggested next work" onClose={() => setSuggestReport(null)}>
          <div
            className="reader-body prose"
            dangerouslySetInnerHTML={{ __html: mdToHtml(suggestReport.report || '') }}
          />
          <p className="note">
            {suggestReport.task_ids?.length || 0} tasks added to backlog, tagged suggested.
          </p>
        </Modal>
      )}
    </div>
  )
}

// ---------- roadmap / milestones ----------

function ProgressBar({ percent }) {
  return (
    <div className="progress" title={`${percent}% complete`}>
      <div className="progress-fill" style={{ width: `${percent}%` }} />
    </div>
  )
}

function fmtDay(value) {
  if (!value) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const d = dateOnly ? new Date(`${value}T00:00:00`) : new Date(value)
  return isNaN(d) ? value : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function MilestoneEditor({ milestone, projectId, onClose, onSaved }) {
  const isNew = !milestone.id
  const [title, setTitle] = useState(milestone.title || '')
  const [description, setDescription] = useState(milestone.description || '')
  const [targetDate, setTargetDate] = useState(milestone.target_date || '')
  const [status, setStatus] = useState(milestone.status || 'open')
  const [memories, setMemories] = useState(milestone.memories || [])
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const search = (e) => {
    e.preventDefault()
    if (!q.trim()) return
    setSearching(true)
    api
      .searchMemory(projectId, q.trim())
      .then((r) => setResults(r || []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false))
  }

  const addMemory = (m) => {
    if (!memories.some((x) => x.id === m.id)) {
      setMemories((prev) => [...prev, { id: m.id, title: m.title }])
    }
  }
  const removeMemory = (id) => setMemories((prev) => prev.filter((x) => x.id !== id))

  const save = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    const body = {
      title: title.trim(),
      description,
      target_date: targetDate || null,
      status,
      memories,
    }
    const req = isNew
      ? api.createMilestone(projectId, body)
      : api.updateMilestone(milestone.id, body)
    req
      .then(onSaved)
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setSaving(false))
  }

  const remove = () => {
    if (isNew) return onClose()
    if (!window.confirm('Delete this milestone? Its tasks are kept, just unassigned.')) return
    api.deleteMilestone(milestone.id).then(onSaved).catch((err) => setError(err.message))
  }

  return (
    <Modal title={isNew ? 'New milestone' : 'Edit milestone'} onClose={onClose}>
      <form className="agent-form" onSubmit={save}>
        <label className="field">
          <span className="field-label">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        </label>
        <label className="field">
          <span className="field-label">Description</span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this milestone deliver?"
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Target date</span>
            <input type="date" value={targetDate || ''} onChange={(e) => setTargetDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">Open</option>
              <option value="done">Done</option>
            </select>
          </label>
        </div>

        <div className="field">
          <span className="field-label">Linked memories (Totem)</span>
          {memories.length > 0 && (
            <div className="link-chips">
              {memories.map((m) => (
                <span key={m.id} className="link-chip">
                  <Icon name="memory" size={12} />
                  {m.title || m.id}
                  <button type="button" onClick={() => removeMemory(m.id)} title="Unlink">
                    <Icon name="x" size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form className="search-row compact" onSubmit={search}>
            <input
              placeholder="Search memory to link a decision or constraint..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="btn" disabled={searching}>
              {searching ? <Spinner size={14} /> : <Icon name="search" size={14} />}
            </button>
          </form>
          {results && results.length === 0 && (
            <span className="field-hint">No memories match.</span>
          )}
          {results && results.length > 0 && (
            <div className="search-results">
              {results.slice(0, 6).map((m) => (
                <button
                  type="button"
                  key={m.id}
                  className="search-result"
                  onClick={() => addMemory(m)}
                  disabled={memories.some((x) => x.id === m.id)}
                >
                  <span className="badge">{m.type}</span>
                  <span className="search-result-title">{m.title}</span>
                  <Icon name="plus" size={13} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="row" style={{ marginBottom: 0 }}>
          <button className="btn primary" disabled={saving || !title.trim()}>
            {saving ? (
              <>
                <Spinner size={14} /> Saving
              </>
            ) : isNew ? (
              'Create milestone'
            ) : (
              'Save changes'
            )}
          </button>
          {!isNew && (
            <button type="button" className="btn danger" onClick={remove}>
              Delete
            </button>
          )}
        </div>
        {error && <div className="error-text">{error}</div>}
      </form>
    </Modal>
  )
}

const STATUS_DOT = { backlog: 'todo', todo: 'todo', doing: 'doing', review: 'review', done: 'done' }

function RoadmapView({ projectId, onOpenTasks }) {
  const { data, error, loading, reload } = useAsync(
    () => api.listMilestones(projectId),
    [projectId]
  )
  const tasksReq = useAsync(() => api.listTasks(projectId), [projectId])
  const milestones = data || []
  const tasks = tasksReq.data || []
  const [editor, setEditor] = useState(null)

  const byMilestone = useMemo(() => {
    const map = {}
    for (const t of tasks) {
      if (t.milestone_id != null) (map[t.milestone_id] ||= []).push(t)
    }
    return map
  }, [tasks])
  const unassigned = tasks.filter((t) => t.milestone_id == null)

  const reopen = () => {
    reload()
    tasksReq.reload()
  }

  return (
    <div className="center-col wide">
      <div className="page-head">
        <h2>Roadmap</h2>
        <button className="btn primary" onClick={() => setEditor({})}>
          <Icon name="plus" size={14} /> New milestone
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {loading ? (
        <div className="milestone-grid">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="block-skeleton" />
          ))}
        </div>
      ) : milestones.length === 0 ? (
        <SectionEmpty
          icon="flag"
          title="No milestones yet"
          hint="Group tasks into a goal and track progress toward it."
          action={
            <button className="btn" onClick={() => setEditor({})}>
              <Icon name="plus" size={14} /> Add a milestone
            </button>
          }
        />
      ) : (
        <div className="milestone-grid">
          {milestones.map((m) => {
            const list = byMilestone[m.id] || []
            return (
              <div
                key={m.id}
                className={`milestone ${m.status} clickable`}
                {...clickable(() => setEditor(m))}
              >
                <div className="milestone-head">
                  <div className="milestone-title-row">
                    <span className="milestone-title">{m.title}</span>
                    {m.status === 'done' && <span className="badge ok">done</span>}
                    {m.target_date && (
                      <span className="milestone-date">
                        <Icon name="clock" size={12} /> {fmtDay(m.target_date)}
                      </span>
                    )}
                  </div>
                  <button
                    className="icon-btn small"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditor(m)
                    }}
                    title="Edit"
                  >
                    <Icon name="settings" size={15} />
                  </button>
                </div>
                {m.description && <div className="milestone-desc">{m.description}</div>}

                <div className="milestone-progress">
                  <ProgressBar percent={m.progress.percent} />
                  <span className="milestone-percent">
                    {m.progress.done}/{m.progress.total} · {m.progress.percent}%
                  </span>
                </div>

                {m.memories.length > 0 && (
                  <div className="link-chips">
                    {m.memories.map((mem) => (
                      <span key={mem.id} className="link-chip static">
                        <Icon name="memory" size={12} />
                        {mem.title || mem.id}
                      </span>
                    ))}
                  </div>
                )}

                {list.length > 0 ? (
                  <div className="milestone-tasks">
                    {list.map((t) => (
                      <div key={t.id} className="milestone-task">
                        <span className={`dot-status ${STATUS_DOT[t.status] || 'todo'}`} />
                        <span className="milestone-task-title">{t.title}</span>
                        <span className={`priority ${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="milestone-empty">No tasks assigned yet.</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!loading && unassigned.length > 0 && (
        <div className="milestone-unassigned">
          <div className="home-section-head">
            <h2>Unassigned tasks</h2>
            <button className="link-btn" onClick={onOpenTasks}>
              <Icon name="tasks" size={13} /> Open board
            </button>
          </div>
          <div className="milestone-tasks">
            {unassigned.map((t) => (
              <div key={t.id} className="milestone-task">
                <span className={`dot-status ${STATUS_DOT[t.status] || 'todo'}`} />
                <span className="milestone-task-title">{t.title}</span>
                <span className={`priority ${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {editor && (
        <MilestoneEditor
          projectId={projectId}
          milestone={editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            reopen()
          }}
        />
      )}
    </div>
  )
}

// ---------- chat ----------

// ---------- search ----------

function SearchView({ onOpenMemory, onOpenSession, onOpenFile }) {
  const [q, setQ] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const submit = (e) => {
    e.preventDefault()
    const query = q.trim()
    if (!query) return
    setLoading(true)
    setError(null)
    api
      .globalSearch(query)
      .then(setData)
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoading(false))
  }

  const total = data ? data.memories.length + data.files.length + data.sessions.length : 0

  return (
    <div className="center-col wide">
      <div className="page-head">
        <h2>Search</h2>
      </div>
      <form className="search-bar" onSubmit={submit}>
        <Icon name="search" size={16} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search memory, workspace files, and conversations across all projects"
          autoFocus
        />
        <button className="btn primary" disabled={!q.trim() || loading}>
          {loading ? <Spinner size={13} /> : 'Search'}
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
      {!data && !loading && (
        <SectionEmpty
          icon="search"
          title="Search everything"
          hint="Memory, workspace files, and conversations across all projects."
        />
      )}
      {data && !loading && total === 0 && (
        <SectionEmpty icon="search" title="No results" hint={`Nothing matches "${data.query}".`} />
      )}

      {data && data.memories.length > 0 && (
        <>
          <h3 className="result-heading">Memory · {data.memories.length}</h3>
          <div className="home-list">
            {data.memories.map((m) => (
              <button key={m.id} className="home-row" onClick={() => onOpenMemory(m.project_id)}>
                <span className="home-row-icon">
                  <Icon name="memory" size={15} />
                </span>
                <span className="home-row-main">
                  <span className="home-row-title">{m.title}</span>
                  <span className="home-row-sub">
                    {m.project} · {m.type} · {truncate(m.statement, 90)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {data && data.files.length > 0 && (
        <>
          <h3 className="result-heading">Workspace files · {data.files.length}</h3>
          <div className="home-list">
            {data.files.map((f) => (
              <button
                key={`${f.project_id}:${f.path}`}
                className="home-row"
                onClick={() => onOpenFile(f)}
              >
                <span className="home-row-icon">
                  <Icon name="files" size={15} />
                </span>
                <span className="home-row-main">
                  <span className="home-row-title">{f.path}</span>
                  <span className="home-row-sub">
                    {f.project}
                    {f.snippet ? ` · ${truncate(f.snippet, 90)}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {data && data.sessions.length > 0 && (
        <>
          <h3 className="result-heading">Conversations · {data.sessions.length}</h3>
          <div className="home-list">
            {data.sessions.map((s) => (
              <button
                key={s.id}
                className="home-row"
                onClick={() => onOpenSession(s.project_id, s.id)}
              >
                <span className="home-row-icon">
                  <Icon name="chat" size={15} />
                </span>
                <span className="home-row-main">
                  <span className="home-row-title">{s.title}</span>
                  <span className="home-row-sub">{s.project}</span>
                </span>
                <span className="home-row-time">{relDate(s.updated_at)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ---------- reminders ----------

function reminderDue(value) {
  const d = new Date(value)
  return isNaN(d) ? null : d
}

function RemindersView({ projects }) {
  const { data, error, loading, reload } = useAsync(() => api.listReminders(false), [])
  const reminders = data || []
  const [text, setText] = useState('')
  const [due, setDue] = useState('')
  const [recurrence, setRecurrence] = useState('none')
  const [projectId, setProjectId] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  const add = (e) => {
    e.preventDefault()
    if (!text.trim() || !due) return
    setSaving(true)
    setFormError(null)
    api
      .createReminder({
        text: text.trim(),
        due_at: new Date(due).toISOString(),
        recurrence,
        project_id: projectId ? Number(projectId) : null,
      })
      .then(() => {
        setText('')
        setDue('')
        setRecurrence('none')
        reload()
      })
      .catch((err) => setFormError(err.message || String(err)))
      .finally(() => setSaving(false))
  }

  const act = (fn) => {
    setFormError(null)
    fn().then(reload).catch((err) => setFormError(err.message || String(err)))
  }

  const now = Date.now()

  return (
    <div className="center-col wide">
      <div className="page-head">
        <h2>Reminders</h2>
        <span className="muted">notifications fire when due</span>
      </div>
      {error && <p className="error-text">{error}</p>}
      {formError && <p className="error-text">{formError}</p>}

      {loading ? (
        <div className="home-list">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="row-skeleton" />
          ))}
        </div>
      ) : reminders.length === 0 ? (
        <SectionEmpty
          icon="clock"
          title="No reminders"
          hint="Ask the agent to remind you, or add one below."
        />
      ) : (
        <div className="home-list">
          {reminders.map((r) => {
            const d = reminderDue(r.due_at)
            const overdue = d && d.getTime() < now
            return (
              <div key={r.id} className="reminder-row">
                <span className={`home-row-icon ${overdue ? 'overdue' : ''}`}>
                  <Icon name="clock" size={15} />
                </span>
                <span className="home-row-main">
                  <span className="home-row-title">{r.text}</span>
                  <span className="home-row-sub">
                    {d ? d.toLocaleString() : r.due_at}
                    {r.recurrence !== 'none' ? `, repeats ${r.recurrence}` : ''}
                    {r.project_id ? `, project #${r.project_id}` : ''}
                  </span>
                </span>
                <button className="btn" onClick={() => act(() => api.updateReminder(r.id, { snooze_minutes: 10 }))}>
                  +10m
                </button>
                <button className="btn" onClick={() => act(() => api.updateReminder(r.id, { snooze_minutes: 1440 }))}>
                  +1d
                </button>
                <button className="btn" onClick={() => act(() => api.updateReminder(r.id, { status: 'done' }))}>
                  <Icon name="check" size={13} />
                </button>
                <button className="btn danger" onClick={() => act(() => api.deleteReminder(r.id))}>
                  <Icon name="x" size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <form className="docs-card" onSubmit={add}>
        <div className="docs-head">
          <Icon name="plus" size={15} />
          <span>New reminder</span>
        </div>
        <div className="field-row">
          <label className="field">
            <span className="field-label">What</span>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Review the PR" />
          </label>
          <label className="field">
            <span className="field-label">When</span>
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Repeat</span>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
              <option value="none">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Project</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row" style={{ marginBottom: 0 }}>
          <button className="btn primary" disabled={saving || !text.trim() || !due}>
            {saving ? <Spinner size={13} /> : 'Add reminder'}
          </button>
        </div>
      </form>
    </div>
  )
}

function UpcomingReminders({ onNavigate }) {
  const { data } = useAsync(() => api.listReminders(false), [])
  const reminders = (data || []).slice(0, 3)
  if (reminders.length === 0) return null
  return (
    <section className="home-section">
      <div className="home-section-head">
        <h2>Upcoming reminders</h2>
        <button className="link-btn" onClick={() => onNavigate({ type: 'reminders' })}>
          <Icon name="clock" size={13} /> All reminders
        </button>
      </div>
      <div className="home-list">
        {reminders.map((r) => (
          <div key={r.id} className="home-row">
            <span className="home-row-icon">
              <Icon name="clock" size={15} />
            </span>
            <span className="home-row-main">
              <span className="home-row-title">{r.text}</span>
              <span className="home-row-sub">{reminderDue(r.due_at)?.toLocaleString() || r.due_at}</span>
            </span>
            <span className="home-row-time">{relDate(r.due_at)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------- watches ----------

const WATCH_KIND_LABEL = { page: 'Page', feed: 'Feed', condition: 'Condition' }

function WatchesView({ projects }) {
  const { data, error, loading, reload } = useAsync(api.listWatches, [])
  const watches = data || []
  const [kind, setKind] = useState('page')
  const [url, setUrl] = useState('')
  const [condition, setCondition] = useState('')
  const [notifyOn, setNotifyOn] = useState('change')
  const [interval, setIntervalMinutes] = useState(60)
  const [projectId, setProjectId] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const [checking, setChecking] = useState(null)

  const add = (e) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    api
      .createWatch({
        kind,
        url: kind === 'condition' && !url.trim() ? null : url.trim() || null,
        condition: condition.trim(),
        notify_on: notifyOn,
        interval_minutes: Number(interval),
        project_id: projectId ? Number(projectId) : null,
      })
      .then(() => {
        setUrl('')
        setCondition('')
        reload()
      })
      .catch((err) => setFormError(err.message || String(err)))
      .finally(() => setSaving(false))
  }

  const act = (fn) => {
    setFormError(null)
    fn().then(reload).catch((err) => setFormError(err.message || String(err)))
  }

  const runNow = (watch) => {
    setChecking(watch.id)
    setFormError(null)
    api
      .checkWatch(watch.id)
      .then(reload)
      .catch((err) => setFormError(err.message || String(err)))
      .finally(() => setChecking(null))
  }

  return (
    <div className="center-col wide">
      <div className="page-head">
        <h2>Watches</h2>
        <span className="muted">notify only when something happens</span>
      </div>
      {error && <p className="error-text">{error}</p>}
      {formError && <p className="error-text">{formError}</p>}

      {loading ? (
        <div className="home-list">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="row-skeleton" />
          ))}
        </div>
      ) : watches.length === 0 ? (
        <SectionEmpty
          icon="refresh"
          title="No watches"
          hint="Watch a page, an RSS feed, or a condition. Ask the agent, or add one below."
        />
      ) : (
        <div className="home-list">
          {watches.map((w) => (
            <div key={w.id} className="watch-row">
              <span className={`badge ${w.status === 'active' ? 'accent' : w.status === 'done' ? 'ok' : ''}`}>
                {WATCH_KIND_LABEL[w.kind] || w.kind}
              </span>
              <span className="home-row-main">
                <span className="home-row-title">{w.condition || w.url}</span>
                <span className="home-row-sub">
                  {w.condition && w.url ? `${w.url}, ` : ''}every {intervalLabel(w.interval_minutes)},{' '}
                  {w.status}
                  {w.last_checked_at ? `, checked ${relDate(w.last_checked_at)}` : ''}
                </span>
                {w.last_result && <span className="home-row-sub">{truncate(w.last_result, 140)}</span>}
              </span>
              <button className="btn" title="Check now" disabled={checking === w.id} onClick={() => runNow(w)}>
                {checking === w.id ? <Spinner size={13} /> : <Icon name="refresh" size={13} />}
              </button>
              <button
                className="btn"
                title={w.status === 'active' ? 'Pause' : 'Resume'}
                onClick={() =>
                  act(() =>
                    api.updateWatch(w.id, { status: w.status === 'active' ? 'paused' : 'active' })
                  )
                }
              >
                {w.status === 'active' ? 'Pause' : 'Resume'}
              </button>
              <button className="btn danger" title="Delete" onClick={() => act(() => api.deleteWatch(w.id))}>
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form className="docs-card" onSubmit={add}>
        <div className="docs-head">
          <Icon name="plus" size={15} />
          <span>New watch</span>
        </div>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="page">Page changed</option>
              <option value="feed">Feed: new items</option>
              <option value="condition">Condition check (agent)</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Every</span>
            <select value={interval} onChange={(e) => setIntervalMinutes(e.target.value)}>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={360}>6 hours</option>
              <option value={1440}>1 day</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span className="field-label">URL</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Condition or phrase</span>
            <input
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder={kind === 'condition' ? 'Is the v2 release published?' : 'In stock'}
            />
          </label>
          {kind === 'page' && (
            <label className="field">
              <span className="field-label">Notify on</span>
              <select value={notifyOn} onChange={(e) => setNotifyOn(e.target.value)}>
                <option value="change">Any change</option>
                <option value="appear">Phrase appears</option>
              </select>
            </label>
          )}
          <label className="field">
            <span className="field-label">Project</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row" style={{ marginBottom: 0 }}>
          <button
            className="btn primary"
            disabled={saving || (kind !== 'condition' && !url.trim()) || (kind === 'condition' && !condition.trim())}
          >
            {saving ? <Spinner size={13} /> : 'Add watch'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------- automations ----------

const SCHEDULE_ACTIONS = [
  'github-scan',
  'code-reviewer',
  'memory-keeper',
  'docs',
  'explore',
  'writer',
  'chat',
]

const SCHEDULE_INTERVALS = [
  { label: 'Every 6 hours', minutes: 360 },
  { label: 'Daily', minutes: 1440 },
  { label: 'Weekly', minutes: 10080 },
]

const SCHEDULE_EVENTS = [
  ['ci_failure', 'CI failure'],
  ['pr_opened', 'Pull request opened'],
  ['issue_opened', 'Issue opened'],
  ['watch_hit', 'Watch matched'],
  ['task_review', 'Task entered review'],
  ['task_done', 'Task completed'],
]

const SCHEDULE_PRESETS = [
  {
    label: 'Nightly repo digest',
    action: 'github-scan',
    interval_minutes: 1440,
    instruction:
      'Summarize what changed in this repository in the last 24 hours: commits, open pull requests, issues, and CI failures. Write the digest to the workspace at digests/{date}.md with workspace_write, then report the path and highlights.',
  },
  {
    label: 'Daily PR review',
    action: 'code-reviewer',
    interval_minutes: 1440,
    instruction:
      'Review the open pull requests on GitHub. For each, summarize the change and flag risks ordered by severity. Write the review to the workspace at reviews/{date}.md with workspace_write, then report.',
  },
  {
    label: 'Weekly memory curation',
    action: 'memory-keeper',
    interval_minutes: 10080,
    instruction:
      'Review Totem project memory: find stale or wrong entries, duplicates, and missing decisions worth recording. Fix what is clearly wrong and create what is missing, then report every change.',
  },
]

function intervalLabel(minutes) {
  if (minutes % 10080 === 0) return `${minutes / 10080}w`
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

function AutomationsView({ projectId }) {
  const { data, error, loading, reload } = useAsync(
    () => api.listSchedules(projectId),
    [projectId]
  )
  const schedules = data || []
  const [form, setForm] = useState({
    action: 'github-scan',
    interval_minutes: 1440,
    instruction: '',
    trigger: 'interval',
    event: 'ci_failure',
    event_filter: '',
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const [running, setRunning] = useState(null)
  const [actionError, setActionError] = useState(null)

  const add = (e) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    api
      .createSchedule(projectId, form)
      .then(() => {
        setForm({
          action: 'github-scan',
          interval_minutes: 1440,
          instruction: '',
          trigger: 'interval',
          event: 'ci_failure',
          event_filter: '',
        })
        reload()
      })
      .catch((err) => setFormError(err.message || String(err)))
      .finally(() => setSaving(false))
  }

  const act = (fn) => {
    setActionError(null)
    fn().then(reload).catch((err) => setActionError(err.message || String(err)))
  }

  const runNow = (schedule) => {
    setRunning(schedule.id)
    setActionError(null)
    api
      .runSchedule(schedule.id)
      .then(reload)
      .catch((err) => setActionError(err.message || String(err)))
      .finally(() => setRunning(null))
  }

  return (
    <div className="center-col wide">
      <div className="page-head">
        <h2>Automations</h2>
        <span className="muted">scheduled agent runs, checked every few minutes</span>
      </div>

      {error && <p className="error-text">{error}</p>}
      {actionError && <p className="error-text">{actionError}</p>}

      {loading ? (
        <div className="home-list">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="row-skeleton" />
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <SectionEmpty
          icon="clock"
          title="No automations yet"
          hint="Add a recurring agent run below, or start from a preset."
        />
      ) : (
        <div className="sched-list">
          {schedules.map((s) => (
            <div key={s.id} className={`sched-row ${s.enabled ? '' : 'off'}`}>
              <label className="sched-toggle" title={s.enabled ? 'Disable' : 'Enable'}>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={() => act(() => api.updateSchedule(s.id, { enabled: !s.enabled }))}
                />
              </label>
              <div className="sched-main">
                <div className="sched-title">
                  <span className="badge">{s.action}</span>
                  <span className="muted">
                    {s.trigger === 'event'
                      ? `when ${(SCHEDULE_EVENTS.find((e) => e[0] === s.event) || [null, s.event])[1]}`
                      : `every ${intervalLabel(s.interval_minutes)}`}
                  </span>
                  {s.last_status && (
                    <span className={`badge ${s.last_status === 'ok' ? 'ok' : 'err'}`}>
                      {s.last_status}
                    </span>
                  )}
                  {s.last_run_at && <span className="muted">last {relDate(s.last_run_at)}</span>}
                </div>
                <div className="sched-instruction">{s.instruction || '(no instruction)'}</div>
                {s.last_report && (
                  <details className="sched-report">
                    <summary>Last report</summary>
                    <pre>{s.last_report}</pre>
                  </details>
                )}
              </div>
              <button className="btn" disabled={running === s.id} onClick={() => runNow(s)}>
                {running === s.id ? (
                  <>
                    <Spinner size={13} /> Running
                  </>
                ) : (
                  <>
                    <Icon name="play" size={13} /> Run now
                  </>
                )}
              </button>
              <button
                className="btn danger"
                title="Delete"
                onClick={() => act(() => api.deleteSchedule(s.id))}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form className="docs-card" onSubmit={add}>
        <div className="docs-head">
          <Icon name="plus" size={15} />
          <span>New automation</span>
        </div>
        <div className="row">
          {SCHEDULE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="btn"
              onClick={() =>
                setForm({
                  action: p.action,
                  interval_minutes: p.interval_minutes,
                  instruction: p.instruction,
                  trigger: 'interval',
                  event: 'ci_failure',
                  event_filter: '',
                })
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Action</span>
            <select
              value={form.action}
              onChange={(e) => setForm({ ...form, action: e.target.value })}
            >
              {SCHEDULE_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Trigger</span>
            <select
              value={form.trigger}
              onChange={(e) => setForm({ ...form, trigger: e.target.value })}
            >
              <option value="interval">On a schedule</option>
              <option value="event">When an event happens</option>
            </select>
          </label>
        </div>
        {form.trigger === 'interval' ? (
          <label className="field">
            <span className="field-label">Interval</span>
            <select
              value={form.interval_minutes}
              onChange={(e) => setForm({ ...form, interval_minutes: Number(e.target.value) })}
            >
              {SCHEDULE_INTERVALS.map((i) => (
                <option key={i.minutes} value={i.minutes}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="field-row">
            <label className="field">
              <span className="field-label">Event</span>
              <select
                value={form.event}
                onChange={(e) => setForm({ ...form, event: e.target.value })}
              >
                {SCHEDULE_EVENTS.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Filter (optional)</span>
              <input
                value={form.event_filter}
                onChange={(e) => setForm({ ...form, event_filter: e.target.value })}
                placeholder="Substring the title or URL must contain"
              />
            </label>
          </div>
        )}
        <label className="field">
          <span className="field-label">Instruction</span>
          <textarea
            rows={3}
            value={form.instruction}
            onChange={(e) => setForm({ ...form, instruction: e.target.value })}
            placeholder="What should the agent do on each run? Use {date} for today's date."
          />
        </label>
        <div className="row" style={{ marginBottom: 0 }}>
          <button className="btn primary" disabled={saving || !form.instruction.trim()}>
            {saving ? (
              <>
                <Spinner size={13} /> Saving
              </>
            ) : (
              <>
                <Icon name="plus" size={13} /> Add automation
              </>
            )}
          </button>
        </div>
        {formError && <p className="error-text">{formError}</p>}
      </form>
    </div>
  )
}

// ---------- goals ----------

const GOAL_STATUS_LABEL = {
  drafting: 'Drafting',
  active: 'Active',
  done: 'Done',
  dropped: 'Dropped',
}

function GoalEditor({ goal, projectId, onClose, onSaved }) {
  const isNew = !goal.id
  const [title, setTitle] = useState(goal.title || '')
  const [description, setDescription] = useState(goal.description || '')
  const [criteria, setCriteria] = useState(goal.success_criteria || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const save = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    const body = {
      title: title.trim(),
      description,
      success_criteria: criteria,
    }
    const req = isNew ? api.createGoal(projectId, body) : api.updateGoal(goal.id, body)
    req
      .then(onSaved)
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setSaving(false))
  }

  return (
    <Modal title={isNew ? 'New goal' : 'Edit goal'} onClose={onClose}>
      <form className="agent-form" onSubmit={save}>
        <label className="field">
          <span className="field-label">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        </label>
        <label className="field">
          <span className="field-label">Description</span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What outcome do you want?"
          />
        </label>
        <label className="field">
          <span className="field-label">Success criteria</span>
          <textarea
            rows={2}
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            placeholder="How will you know it is done?"
          />
        </label>
        <div className="row" style={{ marginBottom: 0 }}>
          <button className="btn primary" disabled={saving || !title.trim()}>
            {saving ? (
              <>
                <Spinner size={14} /> Saving
              </>
            ) : isNew ? (
              'Create goal'
            ) : (
              'Save changes'
            )}
          </button>
        </div>
        {error && <div className="error-text">{error}</div>}
      </form>
    </Modal>
  )
}

function GoalsView({ projectId, onDiscuss, onOpenTasks, onOpenFile }) {
  const { data, error, loading, reload } = useAsync(() => api.listGoals(projectId), [projectId])
  const goals = data || []
  const [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [report, setReport] = useState(null)

  const act = (goal, kind) => {
    setBusy(goal.id)
    setActionError(null)
    const call = kind === 'plan' ? api.planGoal : api.convergeGoal
    call(goal.id)
      .then((r) => {
        setReport({ ...r, goal, kind })
        reload()
      })
      .catch((e) => setActionError(e.message || String(e)))
      .finally(() => setBusy(null))
  }

  const discuss = (goal) => {
    setActionError(null)
    api
      .discussGoal(goal.id)
      .then((r) => onDiscuss(r.session_id, r.seed))
      .catch((e) => setActionError(e.message || String(e)))
  }

  const setStatus = (goal, status) => {
    setActionError(null)
    api.updateGoal(goal.id, { status }).then(reload).catch((e) => setActionError(e.message))
  }

  const remove = (goal) => {
    if (!window.confirm(`Delete goal "${goal.title}"? Tasks and milestone stay on the board.`)) return
    api.deleteGoal(goal.id).then(reload).catch((e) => setActionError(e.message))
  }

  return (
    <div className="center-col wide">
      <div className="page-head">
        <h2>Goals</h2>
        <button className="btn primary" onClick={() => setEditor({})}>
          <Icon name="plus" size={14} /> New goal
        </button>
      </div>
      <p className="note">
        Discuss a goal with the agent, keep a spec in the workspace, then generate a milestone
        and an ordered task board from it.
      </p>

      {error && <p className="error-text">{error}</p>}
      {actionError && <p className="error-text">{actionError}</p>}
      {loading ? (
        <div className="home-list">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="row-skeleton" />
          ))}
        </div>
      ) : goals.length === 0 ? (
        <SectionEmpty
          icon="sparkles"
          title="No goals yet"
          hint="Create one, discuss it with the agent, then generate the board."
        />
      ) : (
        <div className="goal-list">
          {goals.map((goal) => (
            <div
              key={goal.id}
              className="goal-card clickable"
              {...clickable(() => setEditor(goal))}
            >
              <div className="goal-head">
                <span className="goal-title">{goal.title}</span>
                <select
                  className="goal-status"
                  value={goal.status}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setStatus(goal, e.target.value)}
                >
                  {Object.entries(GOAL_STATUS_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              {goal.description && <div className="goal-desc">{goal.description}</div>}
              {goal.success_criteria && (
                <div className="goal-criteria">
                  <strong>Success:</strong> {goal.success_criteria}
                </div>
              )}
              {goal.progress && goal.progress.total > 0 && (
                <div className="goal-progress">
                  <ProgressBar percent={goal.progress.percent} />
                  <span className="muted">
                    {goal.progress.done}/{goal.progress.total} tasks
                  </span>
                </div>
              )}
              <div className="row goal-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn" onClick={() => discuss(goal)}>
                  <Icon name="chat" size={13} /> Discuss
                </button>
                <button
                  className="btn primary"
                  disabled={busy === goal.id}
                  onClick={() => act(goal, 'plan')}
                >
                  {busy === goal.id ? (
                    <>
                      <Spinner size={13} /> Working
                    </>
                  ) : (
                    <>
                      <Icon name="tasks" size={13} /> Generate board
                    </>
                  )}
                </button>
                <button className="btn" disabled={busy === goal.id} onClick={() => act(goal, 'converge')}>
                  <Icon name="check" size={13} /> Converge
                </button>
                {goal.spec_path && (
                  <button
                    className="btn"
                    onClick={() => onOpenFile({ project_id: projectId, path: goal.spec_path })}
                  >
                    <Icon name="files" size={13} /> Spec
                  </button>
                )}
                {goal.milestone_id && (
                  <button className="btn" onClick={onOpenTasks}>
                    <Icon name="flag" size={13} /> Board
                  </button>
                )}
                <button className="btn" onClick={() => setEditor(goal)}>
                  Edit
                </button>
                <button className="btn danger" onClick={() => remove(goal)}>
                  <Icon name="x" size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editor && (
        <GoalEditor
          projectId={projectId}
          goal={editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            reload()
          }}
        />
      )}

      {report && (
        <Modal title={report.kind === 'plan' ? 'Board generated' : 'Converge report'} onClose={() => setReport(null)}>
          <div
            className="reader-body prose"
            dangerouslySetInnerHTML={{ __html: mdToHtml(report.report || '') }}
          />
          {report.spec_path && (
            <p className="note">
              Spec: <code>{report.spec_path}</code>
              {report.plan_path && (
                <>
                  {' '}· Plan: <code>{report.plan_path}</code>
                </>
              )}
            </p>
          )}
          <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
            <button
              className="btn"
              onClick={() => {
                setReport(null)
                if (onOpenTasks) onOpenTasks()
              }}
            >
              <Icon name="tasks" size={14} /> View board
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function ChatView({ projectId, sessionId, agentId, providerId, onSessionCreated, initialMessage, action }) {
  const sessionsReq = useAsync(() => api.listSessions(projectId), [projectId])
  const [messages, setMessages] = useState([])
  const [liveEvents, setLiveEvents] = useState([])
  const [pending, setPending] = useState(null) // 'working' | 'streaming' | null
  const [error, setError] = useState(null)
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [streamingText, setStreamingText] = useState('')
  const [rememberedId, setRememberedId] = useState(null)
  const sessionRef = useRef(sessionId)
  const busyRef = useRef(false)
  const initialSentRef = useRef(false)
  const scrollRef = useRef(null)

  const remember = (text, id) => {
    const trimmed = (text || '').trim()
    if (!trimmed) return
    api
      .addPreference(trimmed)
      .then(() => setRememberedId(id))
      .catch((e) => setError(e.message || String(e)))
  }

  useEffect(() => {
    sessionRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    setMessages([])
    setLiveEvents([])
    setError(null)
    setQuestions([])
    setAnswers({})
    setStreamingText('')
    if (sessionId) {
      api
        .listMessages(sessionId)
        .then(setMessages)
        .catch((e) => setError(e.message || String(e)))
      api.listQuestions(sessionId).then(setQuestions).catch(() => {})
    }
  }, [sessionId])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, liveEvents, pending, streamingText])

  const send = useCallback(
    (text) => {
      if (busyRef.current) return
      busyRef.current = true
      setError(null)
      setLiveEvents([])
      setPending('working')
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text }])
      api
        .chat(
          projectId,
          {
            message: text,
            session_id: sessionRef.current || undefined,
            action: action || undefined,
            ...(agentId ? { agent_id: agentId } : { provider_id: providerId || undefined }),
          },
          {
            onEvent: (evt) => {
              if (evt.event === 'session') {
                sessionRef.current = evt.session_id
                setStreamingText('')
                onSessionCreated(evt.session_id)
              } else if (evt.event === 'message') {
                setPending(null)
                setStreamingText('')
                if (evt.content && evt.content.trim()) {
                  setMessages((prev) => [
                    ...prev,
                    { id: `a-${Date.now()}`, role: 'assistant', content: evt.content },
                  ])
                }
              } else if (evt.event === 'error') {
                setPending(null)
                setStreamingText('')
                setError(evt.message || 'Chat error')
              } else if (evt.event === 'question') {
                setPending(null)
                setStreamingText('')
                setQuestions((prev) => [...prev, { ...evt, status: 'open' }])
              } else if (evt.event === 'token') {
                setPending('streaming')
                setStreamingText((prev) => prev + (evt.text || ''))
              } else {
                setPending('streaming')
                setLiveEvents((prev) => [...prev, evt])
              }
            },
          }
        )
        .catch((err) => {
          setError(err.message || String(err))
          const sid = sessionRef.current
          if (sid) {
            api.listMessages(sid).then(setMessages).catch(() => {})
          } else {
            setMessages((prev) => prev.filter((m) => !String(m.id).startsWith('u-')))
          }
        })
        .finally(() => {
          busyRef.current = false
          setPending(null)
          sessionsReq.reload()
          const sid = sessionRef.current
          if (sid) {
            api
              .listMessages(sid)
              .then((rows) => {
                setMessages(rows)
                setLiveEvents([])
              })
              .catch(() => {})
            api.listQuestions(sid).then(setQuestions).catch(() => {})
          }
        })
    },
    [projectId, agentId, providerId, onSessionCreated, action] // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    if (initialMessage && !initialSentRef.current) {
      initialSentRef.current = true
      send(initialMessage)
    }
  }, [initialMessage, send])

  const answerQuestion = (question, text) => {
    const value = (text || '').trim()
    if (!value) return
    setQuestions((prev) =>
      prev.map((q) => (q.id === question.id ? { ...q, status: 'answered', answer: value } : q))
    )
    send(value)
  }

  const skipQuestion = (question) => {
    api
      .dismissQuestion(question.id)
      .then(() => setQuestions((prev) => prev.filter((q) => q.id !== question.id)))
      .catch((e) => setError(e.message || String(e)))
  }

  return (
    <div className="chat">
      {action === 'goal' && (
        <div className="chat-banner">
          <Icon name="sparkles" size={14} /> Goal discussion: refine the outcome, then press
          "Generate board" on the Goals tab.
        </div>
      )}
      <div className="chat-scroll">
        <div className="chat-inner">
          {messageItems(messages).map((item) =>
            item.kind === 'user' ? (
              <div key={`u-${item.id}`} className="msg user">
                <div className="bubble">{item.content}</div>
              </div>
            ) : item.kind === 'notification' ? (
              <div key={`n-${item.id}`} className="msg notification">
                <div className="notification-banner">{item.content}</div>
              </div>
            ) : (
              <div key={`a-${item.id}`}>
                {item.content && (
                  <div className="msg assistant">
                    <div className="avatar">
                      <Icon name="sparkles" size={15} />
                    </div>
                    <div>
                      <div
                        className="msg-md prose"
                        dangerouslySetInnerHTML={{ __html: mdToHtml(item.content) }}
                      />
                      <button
                        type="button"
                        className="msg-remember"
                        onClick={() => remember(item.content, item.id)}
                      >
                        <Icon name="check" size={12} />
                        {rememberedId === item.id ? 'Saved as preference' : 'Remember this'}
                      </button>
                    </div>
                  </div>
                )}
                {item.runs.map((r, i) => (
                  <div key={i} className="tool-run-wrap">
                    <ToolRun name={r.name} args={r.args} result={r.result} />
                  </div>
                ))}
              </div>
            )
          )}
          {pairToolRuns(liveEvents).map((r, i) => (
            <div key={i} className="tool-run-wrap">
              <ToolRun name={r.name} args={r.args} result={r.result} />
            </div>
          ))}
          {streamingText && (
            <div className="msg assistant">
              <div className="avatar">
                <Icon name="sparkles" size={15} />
              </div>
              <div
                className="msg-md prose"
                dangerouslySetInnerHTML={{ __html: mdToHtml(streamingText) }}
              />
            </div>
          )}
          {pending && (
            <div className="working">
              <span className="pulse" />
              <span>{pending === 'working' ? 'Thinking' : 'Responding'}</span>
              <span className="working-dots">
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
          {questions
            .filter((q) => q.status === 'open')
            .map((q) => (
              <div key={q.id} className="question-card">
                <div className="question-head">
                  <Icon name={q.kind === 'approval' ? 'alert' : 'help'} size={14} />
                  {q.kind === 'approval' ? 'Approval needed' : 'The agent needs input'}
                </div>
                <div className="question-text">{q.question}</div>
                {q.options?.length > 0 && (
                  <div className="question-options">
                    {q.options.map((o) => (
                      <button key={o} className="btn" onClick={() => answerQuestion(q, o)}>
                        {o}
                      </button>
                    ))}
                  </div>
                )}
                <div className="row" style={{ marginBottom: 0 }}>
                  <input
                    value={answers[q.id] || ''}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        answerQuestion(q, answers[q.id])
                      }
                    }}
                    placeholder="Type your answer..."
                  />
                  <button
                    className="btn primary"
                    disabled={!(answers[q.id] || '').trim()}
                    onClick={() => answerQuestion(q, answers[q.id])}
                  >
                    Answer
                  </button>
                  <button className="btn" onClick={() => skipQuestion(q)}>
                    Skip
                  </button>
                </div>
              </div>
            ))}
          <div ref={scrollRef} />
        </div>
      </div>
      <div className="composer-wrap">
        {error && <div className="error-banner">{error}</div>}
        <Composer busy={!!pending} placeholder="Message..." onSend={send} />
      </div>
    </div>
  )
}

// ---------- app shell ----------

export default function App() {
  const projectsReq = useAsync(api.listProjects, [])
  const providersReq = useAsync(api.listProviders, [])
  const agentsReq = useAsync(api.listAgents, [])

  const projects = projectsReq.data || []
  const [projectId, setProjectId] = useState(null)
  // home | help | welcome(overview) | chat | tasks | github | activity | files | memory | about | agents | gallery
  const [view, setView] = useState({ type: 'home' })
  const [chatSessionId, setChatSessionId] = useState(null)
  const [initialMessage, setInitialMessage] = useState(null)
  const [chatKey, setChatKey] = useState(0)
  const [showAddProject, setShowAddProject] = useState(false)
  const [agentId, setAgentId] = useState('')
  const [providerId, setProviderId] = useState('')
  const [settingsTab, setSettingsTab] = useState('providers')
  const [landingFile, setLandingFile] = useState(null)
  const [prevOpenedAt, setPrevOpenedAt] = useState(undefined)
  const [authState, setAuthState] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    api
      .authStatus()
      .then(setAuthState)
      .catch(() => setAuthState({ enabled: false, authenticated: true, has_passkeys: false }))
  }, [])

  const [theme, setTheme] = useState(loadThemeState)

  useEffect(() => {
    applyThemeState(theme)
    saveThemeState(theme)
  }, [theme])

  useEffect(() => {
    if (theme.mode !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => applyThemeState(theme)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  useEffect(() => {
    const applyHash = () => {
      const parsed = parseHash(window.location.hash)
      if (!parsed) return
      if (parsed.projectId) {
        setProjectId(parsed.projectId)
        api
          .openProject(parsed.projectId)
          .then((p) => setPrevOpenedAt(p.previous_opened_at || null))
          .catch(() => setPrevOpenedAt(null))
      }
      if (parsed.view) {
        setView(parsed.view)
        if (parsed.view.type === 'chat' && !parsed.session) {
          setChatSessionId(null)
        }
      }
      if (parsed.session) setChatSessionId(parsed.session)
    }
    applyHash()
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [])

  const effectiveProjectId = projectId && projects.some((p) => p.id === projectId)
    ? projectId
    : projects[0]?.id || null

  useEffect(() => {
    if (effectiveProjectId && effectiveProjectId !== projectId) {
      setProjectId(effectiveProjectId)
    }
  }, [effectiveProjectId, projectId])

  useEffect(() => {
    const hash = viewHash(effectiveProjectId, view, chatSessionId)
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash)
    }
  }, [view, effectiveProjectId, chatSessionId])

  const sessionsReq = useAsync(
    () => (effectiveProjectId ? api.listSessions(effectiveProjectId) : Promise.resolve([])),
    [effectiveProjectId]
  )
  const sessions = sessionsReq.data || []

  const selectProject = (id) => {
    setProjectId(id)
    setView({ type: 'welcome' })
    setChatSessionId(null)
    setInitialMessage(null)
    setPrevOpenedAt(undefined)
    api
      .openProject(id)
      .then((p) => setPrevOpenedAt(p.previous_opened_at || null))
      .catch(() => setPrevOpenedAt(null))
  }

  const openChat = (sessionId) => {
    const session = sessions.find((s) => s.id === sessionId)
    setView({
      type: 'chat',
      action: session?.action && session.action !== 'chat' ? session.action : undefined,
    })
    setChatSessionId(sessionId)
    setInitialMessage(null)
  }

  const openSessionFromLanding = (pid, sessionId) => {
    setProjectId(pid)
    api.openProject(pid).catch(() => {})
    setView({ type: 'chat' })
    setChatSessionId(sessionId)
    setInitialMessage(null)
  }

  const openProjectView = (pid, type) => {
    setProjectId(pid)
    api.openProject(pid).catch(() => {})
    setView({ type })
    setChatSessionId(null)
    setInitialMessage(null)
  }

  const startNewChat = () => {
    setView({ type: 'chat' })
    setChatSessionId(null)
    setInitialMessage(null)
    setChatKey((k) => k + 1)
  }

  const startChatWith = (text) => {
    setView({ type: 'chat' })
    setChatSessionId(null)
    setInitialMessage(text)
    setChatKey((k) => k + 1)
  }

  const openGoalDiscussion = (sessionId, seed) => {
    setView({ type: 'chat', action: 'goal' })
    setChatSessionId(sessionId)
    setInitialMessage(seed)
    setChatKey((k) => k + 1)
  }

  const startProjectChat = (pid, text) => {
    setProjectId(pid)
    api.openProject(pid).catch(() => {})
    setView({ type: 'chat' })
    setChatSessionId(null)
    setInitialMessage(text)
    setChatKey((k) => k + 1)
  }

  const onSessionCreated = useCallback(
    (sid) => {
      setChatSessionId(sid)
      setInitialMessage(null)
      sessionsReq.reload()
    },
    [sessionsReq]
  )

  const agents = agentsReq.data || []
  const providers = providersReq.data || []
  const project = projects.find((p) => p.id === effectiveProjectId)
  const inProjectView = [
    'welcome',
    'chat',
    'goals',
    'tasks',
    'roadmap',
    'github',
    'activity',
    'automations',
    'files',
    'memory',
    'about',
  ].includes(view.type)

  if (authState === null) {
    return (
      <div className="login">
        <Spinner size={20} />
      </div>
    )
  }
  if (authState.enabled && !authState.authenticated) {
    return <LoginView status={authState} onAuthed={() => window.location.reload()} />
  }

  return (
    <div className="app">
      <aside
        className={`sidebar ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      >
        <button className="sidebar-brand" onClick={() => setView({ type: 'home' })}>
          <span className="logo">
            <Icon name="flame" size={15} />
          </span>
          <span className="brand-name">Hestia</span>
        </button>
        <div className="sidebar-scroll">
          <button
            className={`sidebar-item ${view.type === 'home' ? 'active' : ''}`}
            onClick={() => setView({ type: 'home' })}
          >
            <Icon name="home" size={16} className="si-icon" />
            Dashboard
          </button>
          <div className="sidebar-label">
            <span>Projects</span>
            <button title="Add project" onClick={() => setShowAddProject(true)}>
              <Icon name="plus" size={14} />
            </button>
          </div>
          {projects.map((p) => (
            <button
              key={p.id}
              className={`sidebar-item ${
                inProjectView && p.id === effectiveProjectId ? 'active' : ''
              }`}
              onClick={() => selectProject(p.id)}
            >
              <span className="proj-avatar">{p.name.slice(0, 1)}</span>
              <span
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}
              >
                {p.name}
              </span>
            </button>
          ))}
          {projectsReq.loading && <div className="meta">Loading...</div>}
          {!projectsReq.loading && projects.length === 0 && (
            <div className="meta">No projects yet, click + to add one.</div>
          )}

          {project && (
            <div className="sidebar-section">
              <div className="sidebar-label">
                <span>{project.name}</span>
                <button title="New chat" onClick={startNewChat}>
                  <Icon name="plus" size={14} />
                </button>
              </div>
              <button
                className={`sidebar-item ${
                  view.type === 'chat' && chatSessionId === null ? 'active' : ''
                }`}
                onClick={startNewChat}
              >
                <Icon name="plus" size={16} className="si-icon" />
                New chat
              </button>
              {[...sessions]
                .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
                .map((s) => (
                <button
                  key={s.id}
                  className={`sidebar-item ${
                    view.type === 'chat' && chatSessionId === s.id ? 'active' : ''
                  }`}
                  onClick={() => openChat(s.id)}
                >
                  <Icon name="chat" size={16} className="si-icon" />
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      flex: 1,
                      textAlign: 'left',
                    }}
                  >
                    {s.title || 'Untitled'}
                  </span>
                  <span className="sub">{relDate(s.created_at)}</span>
                </button>
              ))}
              <button
                className={`sidebar-item ${view.type === 'welcome' ? 'active' : ''}`}
                onClick={() => selectProject(project.id)}
              >
                <Icon name="home" size={16} className="si-icon" />
                Overview
              </button>
              <button
                className={`sidebar-item ${view.type === 'goals' ? 'active' : ''}`}
                onClick={() => setView({ type: 'goals' })}
              >
                <Icon name="sparkles" size={16} className="si-icon" />
                Goals
              </button>
              <button
                className={`sidebar-item ${view.type === 'tasks' ? 'active' : ''}`}
                onClick={() => setView({ type: 'tasks' })}
              >
                <Icon name="tasks" size={16} className="si-icon" />
                Tasks
              </button>
              <button
                className={`sidebar-item ${view.type === 'roadmap' ? 'active' : ''}`}
                onClick={() => setView({ type: 'roadmap' })}
              >
                <Icon name="flag" size={16} className="si-icon" />
                Roadmap
              </button>
              <button
                className={`sidebar-item ${view.type === 'github' ? 'active' : ''}`}
                onClick={() => setView({ type: 'github' })}
              >
                <Icon name="git" size={16} className="si-icon" />
                GitHub
              </button>
              <button
                className={`sidebar-item ${view.type === 'activity' ? 'active' : ''}`}
                onClick={() => setView({ type: 'activity' })}
              >
                <Icon name="clock" size={16} className="si-icon" />
                Activity
              </button>
              <button
                className={`sidebar-item ${view.type === 'automations' ? 'active' : ''}`}
                onClick={() => setView({ type: 'automations' })}
              >
                <Icon name="refresh" size={16} className="si-icon" />
                Automations
              </button>
              <button
                className={`sidebar-item ${view.type === 'files' ? 'active' : ''}`}
                onClick={() => setView({ type: 'files' })}
              >
                <Icon name="files" size={16} className="si-icon" />
                Files
              </button>
              <button
                className={`sidebar-item ${view.type === 'memory' ? 'active' : ''}`}
                onClick={() => setView({ type: 'memory' })}
              >
                <Icon name="memory" size={16} className="si-icon" />
                Memory
              </button>
              <button
                className={`sidebar-item ${view.type === 'background' ? 'active' : ''}`}
                onClick={() => setView({ type: 'background' })}
              >
                <Icon name="play" size={16} className="si-icon" />
                Background
              </button>
              <button
                className={`sidebar-item ${view.type === 'capture' ? 'active' : ''}`}
                onClick={() => setView({ type: 'capture' })}
              >
                <Icon name="plus" size={16} className="si-icon" />
                Capture
              </button>
              <button
                className={`sidebar-item ${view.type === 'about' ? 'active' : ''}`}
                onClick={() => setView({ type: 'about' })}
              >
                <Icon name="info" size={16} className="si-icon" />
                About
              </button>
            </div>
          )}

          <div className="sidebar-section">
            <div className="sidebar-label">
              <span>Global</span>
            </div>
            <button
              className={`sidebar-item ${view.type === 'search' ? 'active' : ''}`}
              onClick={() => setView({ type: 'search' })}
            >
              <Icon name="search" size={16} className="si-icon" />
              Search
            </button>
            <button
              className={`sidebar-item ${view.type === 'reminders' ? 'active' : ''}`}
              onClick={() => setView({ type: 'reminders' })}
            >
              <Icon name="clock" size={16} className="si-icon" />
              Reminders
            </button>
            <button
              className={`sidebar-item ${view.type === 'watches' ? 'active' : ''}`}
              onClick={() => setView({ type: 'watches' })}
            >
              <Icon name="refresh" size={16} className="si-icon" />
              Watches
            </button>
            <button
              className={`sidebar-item ${view.type === 'agents' ? 'active' : ''}`}
              onClick={() => setView({ type: 'agents' })}
            >
              <Icon name="agents" size={16} className="si-icon" />
              Agents
            </button>
            <button
              className={`sidebar-item ${view.type === 'skills' ? 'active' : ''}`}
              onClick={() => setView({ type: 'skills' })}
            >
              <Icon name="sparkles" size={16} className="si-icon" />
              Skills
            </button>
            <button
              className={`sidebar-item ${view.type === 'gallery' ? 'active' : ''}`}
              onClick={() => setView({ type: 'gallery' })}
            >
              <Icon name="gallery" size={16} className="si-icon" />
              Gallery
            </button>
            <button
              className={`sidebar-item ${view.type === 'help' ? 'active' : ''}`}
              onClick={() => setView({ type: 'help' })}
            >
              <Icon name="help" size={16} className="si-icon" />
              Help
            </button>
            <button
              className={`sidebar-item ${view.type === 'settings' ? 'active' : ''}`}
              onClick={() => setView({ type: 'settings' })}
            >
              <Icon name="settings" size={16} className="si-icon" />
              Settings
            </button>
          </div>

          {authState?.enabled && (
            <div className="sidebar-section">
              <button
                className="sidebar-item"
                onClick={() => api.authLogout().then(() => window.location.reload())}
              >
                <Icon name="x" size={16} className="si-icon" />
                Log out
              </button>
            </div>
          )}
        </div>
      </aside>

      <button
        className="mobile-nav-btn"
        title="Menu"
        onClick={() => setSidebarOpen((open) => !open)}
      >
        <Icon name="menu" size={18} />
      </button>
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="main">
        {project &&
          [
            'welcome',
            'chat',
            'goals',
            'tasks',
            'roadmap',
            'github',
            'activity',
            'automations',
            'files',
            'memory',
            'about',
          ].includes(view.type) && (
          <header className="topbar">
            <div className="topbar-title" title={project.repo_url}>
              <span className="proj-avatar">{project.name.slice(0, 1)}</span>
              <span className="name">{project.name}</span>
              {project.allow_git_writes && (
                <span className="badge err" title="Agent may modify the clone">
                  writes on
                </span>
              )}
            </div>
            <div className="topbar-right">
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Default agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {!agentId && (
                <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                  <option value="">Default provider</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.model})
                    </option>
                  ))}
                </select>
              )}
              <button
                className="icon-btn"
                title="Settings"
                onClick={() => setView({ type: 'settings' })}
              >
                <Icon name="settings" size={17} />
              </button>
            </div>
          </header>
        )}

        <div className="content">
          {view.type === 'home' && (
            <HomeView
              onNewProject={() => setShowAddProject(true)}
              onNavigate={setView}
              onOpenProject={(id) => selectProject(id)}
              onOpenSession={openSessionFromLanding}
              onOpenFile={(f) => setLandingFile(f)}
              onStartChat={startProjectChat}
            />
          )}
          {view.type === 'help' && <HelpView />}
          {view.type === 'search' && (
            <SearchView
              onOpenMemory={(pid) => openProjectView(pid, 'memory')}
              onOpenSession={openSessionFromLanding}
              onOpenFile={(f) => setLandingFile(f)}
            />
          )}
          {view.type === 'reminders' && <RemindersView projects={projects} />}
          {view.type === 'watches' && <WatchesView projects={projects} />}
          {!project &&
            !projectsReq.loading &&
            !['home', 'help', 'settings', 'skills'].includes(view.type) && (
              <div className="empty">
                No projects yet. Click + next to Projects to add one.
              </div>
            )}
          {project && view.type === 'welcome' && (
            <ProjectOverviewView
              project={project}
              since={prevOpenedAt}
              onStart={startChatWith}
              onNavigate={setView}
              onOpenSettings={(tab) => {
                setSettingsTab(tab || 'providers')
                setView({ type: 'settings' })
              }}
            />
          )}
          {project && view.type === 'chat' && (
            <ChatView
              key={`${project.id}:${chatSessionId ?? 'new'}:${chatKey}`}
              projectId={project.id}
              sessionId={chatSessionId}
              agentId={agentId}
              providerId={providerId}
              onSessionCreated={onSessionCreated}
              initialMessage={initialMessage}
              action={view.action}
            />
          )}
          {project && view.type === 'goals' && (
            <GoalsView
              projectId={project.id}
              onDiscuss={openGoalDiscussion}
              onOpenTasks={() => setView({ type: 'tasks' })}
              onOpenFile={(f) => setLandingFile(f)}
            />
          )}
          {project && view.type === 'tasks' && (
            <TasksView
              projectId={project.id}
              onImplement={startChatWith}
              gitWrites={project.allow_git_writes}
            />
          )}
          {project && view.type === 'roadmap' && (
            <RoadmapView
              projectId={project.id}
              onOpenTasks={() => setView({ type: 'tasks' })}
            />
          )}
          {project && view.type === 'github' && (
            <GithubView
              projectId={project.id}
              onSummarize={startChatWith}
              onOpenTasks={() => setView({ type: 'tasks' })}
            />
          )}
          {project && view.type === 'activity' && (
            <ActivityView
              projectId={project.id}
              onOpenSession={(sid) => openChat(sid)}
              onOpenFile={(item) =>
                setLandingFile({ project_id: project.id, path: item.path })
              }
            />
          )}
          {project && view.type === 'automations' && (
            <AutomationsView projectId={project.id} />
          )}
          {project && view.type === 'files' && <FilesView projectId={project.id} />}
          {project && view.type === 'memory' && (
            <MemoryView projectId={project.id} providerId={providerId} onStart={startChatWith} />
          )}
          {project && view.type === 'background' && (
            <BackgroundView projectId={project.id} />
          )}
          {project && view.type === 'capture' && <CaptureView projectId={project.id} />}
          {project && view.type === 'about' && (
            <AboutView
              projectId={project.id}
              onDeleted={() => {
                projectsReq.reload()
                setProjectId(null)
                setView({ type: 'home' })
              }}
            />
          )}
          {view.type === 'agents' && (
            <AgentsPage onOpenSettings={() => setView({ type: 'settings' })} />
          )}
          {view.type === 'skills' && <SkillsView />}
          {view.type === 'gallery' && <GalleryView />}
          {view.type === 'settings' && (
            <SettingsView
              tab={settingsTab}
              setTab={setSettingsTab}
              theme={theme}
              setTheme={setTheme}
            />
          )}
        </div>
      </div>

      {landingFile && (
        <Modal
          title={landingFile.path}
          onClose={() => setLandingFile(null)}
        >
          <FileReaderPane
            projectId={landingFile.project_id}
            path={landingFile.path}
            onClose={() => setLandingFile(null)}
          />
        </Modal>
      )}

      {showAddProject && (
        <AddProjectModal
          onClose={() => setShowAddProject(false)}
          onCreated={(p) => {
            setShowAddProject(false)
            projectsReq.reload()
            selectProject(p.id)
          }}
        />
      )}
    </div>
  )
}
