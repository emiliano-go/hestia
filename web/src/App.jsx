import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'

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
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l3 2',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  tasks: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  chevronDown: 'M6 9l6 6 6-6',
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

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mixWithBlack(hex, amount) {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const c = rgb.map((v) => Math.round(v * (1 - amount)))
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

function loadStoredTheme() {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch (e) {
    return {}
  }
}

function applyTheme(theme) {
  const root = document.documentElement.style
  const vars = { ...DEFAULT_THEME, ...theme }
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v)
  root.setProperty('--accent-dim', mixWithBlack(vars['--accent'], 0.18))
  root.setProperty('--accent-soft', vars['--accent'] + '1f')
}

function resetTheme() {
  localStorage.removeItem(THEME_KEY)
  applyTheme({})
}

function saveTheme(theme) {
  const clean = Object.fromEntries(
    Object.entries(theme).filter(([k, v]) => DEFAULT_THEME[k] && v !== DEFAULT_THEME[k])
  )
  if (Object.keys(clean).length === 0) {
    localStorage.removeItem(THEME_KEY)
  } else {
    localStorage.setItem(THEME_KEY, JSON.stringify(clean))
  }
}

// ---------- tiny markdown ----------

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inlineMd(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
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

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn modal-close" onClick={onClose} title="Close">
          <Icon name="x" size={16} />
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
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

  const submit = (e) => {
    e.preventDefault()
    setCreating(true)
    setError(null)
    api
      .createProject({ name, repo_url: repoUrl })
      .then((p) => {
        onCreated(p)
      })
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
          {creating ? 'Cloning repository, this may take a while...' : 'Add project'}
        </button>
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

function ThemePanel() {
  const [theme, setTheme] = useState(() => ({ ...DEFAULT_THEME, ...loadStoredTheme() }))

  const set = (k) => (e) => {
    const v = e.target.value
    setTheme((t) => {
      const next = { ...t, [k]: v }
      applyTheme(next)
      saveTheme(next)
      return next
    })
  }

  return (
    <div>
      <div className="theme-grid">
        {Object.entries(THEME_LABELS).map(([k, label]) => (
          <div key={k} className="theme-row">
            <label>{label}</label>
            <input type="color" value={theme[k]} onChange={set(k)} />
            <input type="text" value={theme[k]} onChange={set(k)} />
          </div>
        ))}
      </div>
      <button
        className="btn"
        onClick={() => {
          resetTheme()
          setTheme({ ...DEFAULT_THEME })
        }}
      >
        Reset to defaults
      </button>
    </div>
  )
}

// ---------- memory ----------

function MemoryView({ projectId, providerId }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState(null)
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
          <div key={m.id} className="card">
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
    </div>
  )
}

// ---------- about ----------

function AboutView({ projectId, onDeleted }) {
  const { data: project, error, loading, reload } = useAsync(
    () => api.getProject(projectId),
    [projectId]
  )
  const [pulling, setPulling] = useState(false)
  const [pullOutput, setPullOutput] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

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
        AGENTS.md
      </h3>
      <pre>{project.agents_md || '(empty)'}</pre>
    </div>
  )
}

// ---------- landing / home ----------

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
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

function HomeView({ onOpenProject, onOpenSession, onOpenFile, onNewProject, onNavigate }) {
  const { data, error, loading } = useAsync(api.activity, [])
  const counts = (data && data.counts) || { projects: 0, sessions: 0, files: 0 }
  const projects = (data && data.projects) || []
  const sessions = (data && data.sessions) || []
  const files = (data && data.files) || []

  return (
    <div className="home">
      <header className="home-hero">
        <div>
          <h1>{greeting()}</h1>
          <p>Your projects, recent conversations, and agent-generated files in one place.</p>
        </div>
        <button className="btn primary" onClick={onNewProject}>
          <Icon name="plus" size={15} /> New project
        </button>
      </header>

      {error && <p className="error-text">{error}</p>}

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
        <a href="#providers">Providers</a>
        <a href="#agents">Agents &amp; actions</a>
        <a href="#chat">Chat &amp; tools</a>
        <a href="#memory">Memory</a>
        <a href="#files">Files &amp; gallery</a>
        <a href="#settings">Settings &amp; theme</a>
        <a href="#tips">Tips &amp; troubleshooting</a>
      </nav>

      <Doc id="overview" title="Overview">
        <p>
          <strong>Home</strong> is a self-hosted cockpit for software projects. Each project is a
          persistent, agent-aware workspace linked to a Git repository. An agent reads the repo,
          answers questions, and writes what it learns into <strong>Totem</strong>, a durable
          project memory that every future conversation starts from.
        </p>
        <p>
          The <strong>Home</strong> page (the one you land on) shows your most recently opened
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
            <strong>Configure a provider.</strong> Open <em>Settings</em> (gear icon) and pick a
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
          A project is a Git repository plus a workspace. Home never modifies your code: the agent
          can read files and git history, and write files to a separate workspace, but not change
          the repository.
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
            them on GitHub, or hit <em>Summarize</em> to hand one to the agent in a new chat.
          </li>
          <li>
            <strong>Activity</strong>: a chronological timeline of conversations, memory writes,
            generated files, commits, and GitHub events for the project.
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
            <strong>Click a card</strong> to edit its title, description, column, priority, and
            milestone, or delete it.
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
        </ul>
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

      <Doc id="settings" title="Settings &amp; theme">
        <p>
          Open <em>Settings</em> from the gear icon in the top bar.
        </p>
        <ul>
          <li>
            <strong>Providers</strong>: add, test, and delete model endpoints.
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
            <strong>“No provider configured”</strong> — add one in Settings and make sure the named
            environment variable is set where Home runs.
          </li>
          <li>
            <strong>Test fails</strong> — check the base URL (include the <code>/v1</code>) and that
            the model id is valid for that endpoint.
          </li>
          <li>
            <strong>Agent ignores your request</strong> — project code is read-only by design. Ask
            it to explain a change instead, or have it write a plan to the workspace.
          </li>
          <li>
            <strong>Pick a role model</strong> — advanced mode lets a cheap model explore and a
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

function Stat({ icon, label, value, hint, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <div className="stat-top">
        <Icon name={icon} size={14} className="stat-icon" />
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
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

function ProjectOverviewView({ project, since, onStart, onNavigate }) {
  const ready = since !== undefined
  const { data, error, loading } = useAsync(
    () => (ready ? api.projectStatus(project.id, since || undefined) : Promise.resolve(null)),
    [project.id, since]
  )
  const firstVisit = since === null
  const git = data?.git
  const github = data?.github
  const tasks = data?.tasks
  const changes = data?.changes

  const runTone = (run) => {
    if (!run) return ''
    if (run.conclusion === 'success') return 'ok'
    if (run.conclusion === 'failure') return 'err'
    return ''
  }

  return (
    <div className="overview">
      {!firstVisit && changes && changes.total > 0 && (
        <div className="digest">
          <div className="digest-head">
            <Icon name="sparkles" size={16} />
            <span>Since your last visit</span>
          </div>
          <div className="digest-chips">
            {CHANGE_FIELDS.filter((f) => changes.counts[f.key] > 0).map((f) => (
              <span key={f.key} className="digest-chip">
                <Icon name={f.icon} size={12} />
                {changes.counts[f.key]} {f.label}
              </span>
            ))}
          </div>
        </div>
      )}
      {!firstVisit && changes && changes.total === 0 && (
        <div className="digest caught-up">
          <Icon name="check" size={15} /> You are all caught up since your last visit.
        </div>
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
            hint={git?.head ? `at ${git.head}` : null}
          />
          <Stat
            icon="git"
            label="Last commit"
            value={truncate(git?.last_commit?.subject, 42) || 'none'}
            hint={git?.last_commit ? `${git.last_commit.short} · ${relDate(git.last_commit.date)}` : null}
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
            hint={git?.dirty ? 'uncommitted changes' : null}
          />
          <Stat
            icon="tasks"
            label="Open tasks"
            value={tasks ? tasks.open : '—'}
            hint={tasks && tasks.total ? `${tasks.total} total` : 'board is empty'}
          />
          {github?.available ? (
            <>
              <Stat icon="git" label="Open PRs" value={github.open_prs} />
              <Stat icon="chat" label="Open issues" value={github.open_issues} />
              <Stat
                icon="alert"
                label="Failing runs"
                value={github.failing_runs}
                tone={github.failing_runs ? 'err' : ''}
              />
              <Stat
                icon="play"
                label="Latest CI"
                value={
                  github.latest_run
                    ? github.latest_run.conclusion || github.latest_run.status
                    : 'none'
                }
                hint={github.latest_run?.name}
                tone={runTone(github.latest_run)}
              />
            </>
          ) : (
            <Stat
              icon="alert"
              label="GitHub"
              value="Not connected"
              hint={github?.reason || 'add a GitHub token or use a GitHub remote'}
            />
          )}
        </div>
      )}

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

function GithubView({ projectId, onSummarize, onOpenTasks }) {
  const [kind, setKind] = useState('prs')
  const [state, setState] = useState('open')
  const [triaging, setTriaging] = useState(null)
  const [triageReport, setTriageReport] = useState(null)
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
          <div key={it.number ?? it.id} className="gh-row">
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
        ))}
      </div>

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

function TaskEditor({ task, projectId, onClose, onSaved }) {
  const isNew = !task.id
  const [title, setTitle] = useState(task.title || '')
  const [description, setDescription] = useState(task.description || '')
  const [status, setStatus] = useState(task.status || 'backlog')
  const [priority, setPriority] = useState(task.priority || 'medium')
  const [milestoneId, setMilestoneId] = useState(task.milestone_id || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const milestonesReq = useAsync(() => api.listMilestones(projectId), [projectId])
  const milestones = milestonesReq.data || []

  const save = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    const body = {
      title: title.trim(),
      description,
      status,
      priority,
      milestone_id: milestoneId ? parseInt(milestoneId, 10) : 0,
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
            placeholder="Optional detail, acceptance criteria, links..."
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

function TasksView({ projectId }) {
  const { data, error, loading, reload } = useAsync(() => api.listTasks(projectId), [projectId])
  const [tasks, setTasks] = useState([])
  const [dragId, setDragId] = useState(null)
  const [editor, setEditor] = useState(null)

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
        <button className="btn primary" onClick={() => setEditor({ status: 'backlog' })}>
          <Icon name="plus" size={14} /> New task
        </button>
      </div>
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
                    {t.description && (
                      <div className="kanban-card-desc">{truncate(t.description, 120)}</div>
                    )}
                    <div className="kanban-card-foot">
                      <span className={`priority ${t.priority}`}>
                        {PRIORITY_LABEL[t.priority]}
                      </span>
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
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            reload()
          }}
        />
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
  const d = new Date(value)
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
              <div key={m.id} className={`milestone ${m.status}`}>
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
                  <button className="icon-btn small" onClick={() => setEditor(m)} title="Edit">
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

function ChatView({ projectId, sessionId, agentId, providerId, onSessionCreated, initialMessage }) {
  const sessionsReq = useAsync(() => api.listSessions(projectId), [projectId])
  const [messages, setMessages] = useState([])
  const [liveEvents, setLiveEvents] = useState([])
  const [pending, setPending] = useState(null) // 'working' | 'streaming' | null
  const [error, setError] = useState(null)
  const sessionRef = useRef(sessionId)
  const busyRef = useRef(false)
  const initialSentRef = useRef(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    sessionRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    setMessages([])
    setLiveEvents([])
    setError(null)
    if (sessionId) {
      api
        .listMessages(sessionId)
        .then(setMessages)
        .catch((e) => setError(e.message || String(e)))
    }
  }, [sessionId])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, liveEvents, pending])

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
            ...(agentId ? { agent_id: agentId } : { provider_id: providerId || undefined }),
          },
          {
            onEvent: (evt) => {
              if (evt.event === 'session') {
                sessionRef.current = evt.session_id
                onSessionCreated(evt.session_id)
              } else if (evt.event === 'message') {
                setPending(null)
                setMessages((prev) => [
                  ...prev,
                  { id: `a-${Date.now()}`, role: 'assistant', content: evt.content },
                ])
              } else if (evt.event === 'error') {
                setPending(null)
                setError(evt.message || 'Chat error')
              } else if (evt.event === 'token') {
                setPending('streaming')
              } else {
                setPending('streaming')
                setLiveEvents((prev) => [...prev, evt])
              }
            },
          }
        )
        .catch((err) => setError(err.message || String(err)))
        .finally(() => {
          busyRef.current = false
          setPending(null)
          sessionsReq.reload()
          const sid = sessionRef.current
          if (sid) {
            api
              .listMessages(sid)
              .then(setMessages)
              .catch(() => {})
          }
        })
    },
    [projectId, agentId, providerId, onSessionCreated] // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    if (initialMessage && !initialSentRef.current) {
      initialSentRef.current = true
      send(initialMessage)
    }
  }, [initialMessage, send])

  return (
    <div className="chat">
      <div className="chat-scroll">
        <div className="chat-inner">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="msg user">
                <div className="bubble">{m.content}</div>
              </div>
            ) : (
              <div key={m.id} className="msg assistant">
                <div className="avatar">
                  <Icon name="sparkles" size={15} />
                </div>
                <div
                  className="msg-md prose"
                  dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) }}
                />
              </div>
            )
          )}
          {pairToolRuns(liveEvents).map((r, i) => (
            <div key={i} className="tool-run-wrap">
              <ToolRun name={r.name} args={r.args} result={r.result} />
            </div>
          ))}
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
  const [showSettings, setShowSettings] = useState(false)
  const [agentId, setAgentId] = useState('')
  const [providerId, setProviderId] = useState('')
  const [settingsTab, setSettingsTab] = useState('providers')
  const [landingFile, setLandingFile] = useState(null)
  const [prevOpenedAt, setPrevOpenedAt] = useState(undefined)

  useEffect(() => {
    applyTheme(loadStoredTheme())
  }, [])

  const effectiveProjectId = projectId && projects.some((p) => p.id === projectId)
    ? projectId
    : projects[0]?.id || null

  useEffect(() => {
    if (effectiveProjectId && effectiveProjectId !== projectId) {
      setProjectId(effectiveProjectId)
    }
  }, [effectiveProjectId, projectId])

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
    setView({ type: 'chat' })
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

  const onSessionCreated = useCallback(
    (sid) => {
      setChatSessionId(sid)
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
    'tasks',
    'roadmap',
    'github',
    'activity',
    'files',
    'memory',
    'about',
  ].includes(view.type)

  return (
    <div className="app">
      <aside className="sidebar">
        <button className="sidebar-brand" onClick={() => setView({ type: 'home' })}>
          <span className="logo">
            <Icon name="home" size={15} />
          </span>
          <span className="brand-name">Home</span>
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
              {sessions.map((s) => (
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
              className={`sidebar-item ${view.type === 'agents' ? 'active' : ''}`}
              onClick={() => setView({ type: 'agents' })}
            >
              <Icon name="agents" size={16} className="si-icon" />
              Agents
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
          </div>
        </div>
      </aside>

      <div className="main">
        {project &&
          [
            'welcome',
            'chat',
            'tasks',
            'roadmap',
            'github',
            'activity',
            'files',
            'memory',
            'about',
          ].includes(view.type) && (
          <header className="topbar">
            <div className="topbar-title">
              <span className="name">{project.name}</span>
              <span className="repo">
                <Icon name="git" size={12} />
                {project.repo_url}
              </span>
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
                onClick={() => setShowSettings(true)}
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
            />
          )}
          {view.type === 'help' && <HelpView />}
          {!project && !projectsReq.loading && view.type !== 'home' && view.type !== 'help' && (
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
            />
          )}
          {project && view.type === 'tasks' && <TasksView projectId={project.id} />}
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
          {project && view.type === 'files' && <FilesView projectId={project.id} />}
          {project && view.type === 'memory' && (
            <MemoryView projectId={project.id} providerId={providerId} />
          )}
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
            <AgentsPage onOpenSettings={() => setShowSettings(true)} />
          )}
          {view.type === 'gallery' && <GalleryView />}
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
      {showSettings && (
        <Modal title="Settings" onClose={() => setShowSettings(false)}>
          <div className="modal-tabs">
            <button
              className={settingsTab === 'providers' ? 'active' : ''}
              onClick={() => setSettingsTab('providers')}
            >
              Providers
            </button>
            <button
              className={settingsTab === 'theme' ? 'active' : ''}
              onClick={() => setSettingsTab('theme')}
            >
              Theme
            </button>
          </div>
          {settingsTab === 'providers' ? <ProvidersPanel /> : <ThemePanel />}
        </Modal>
      )}
    </div>
  )
}
