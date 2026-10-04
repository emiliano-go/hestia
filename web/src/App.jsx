import { useCallback, useEffect, useRef, useState } from 'react'
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

// ---------- theme ----------

const THEME_KEY = 'home-theme'

const DEFAULT_THEME = {
  '--content-bg': '#0e1013',
  '--sidebar-bg': '#131518',
  '--surface': '#17191d',
  '--border': '#262a30',
  '--fg': '#e8eaec',
  '--muted': '#868d95',
  '--accent': '#d29a4b',
  '--ok': '#4fae7c',
  '--err': '#d9635c',
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
  let text = escapeHtml(md).replace(/```([\s\S]*?)```/g, (m, code) => {
    blocks.push('<pre><code>' + code.replace(/^\n/, '') + '</code></pre>')
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

function ToolChip({ name, args }) {
  return (
    <details className="tool-chip">
      <summary>
        <span className="tname">{name}</span>
        <span className="ttext">{truncate(JSON.stringify(args), 90)}</span>
      </summary>
      <div className="tool-body">{JSON.stringify(args, null, 2)}</div>
    </details>
  )
}

function ToolResultChip({ name, ok, preview }) {
  return (
    <details className={`tool-chip ${ok ? 'ok' : 'err'}`}>
      <summary>
        <span className="tname">{name}</span>
        <span className={ok ? 'badge ok' : 'badge err'}>{ok ? 'ok' : 'error'}</span>
        <span className="ttext">{truncate(preview, 90)}</span>
      </summary>
      <div className="tool-body">{String(preview ?? '')}</div>
    </details>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn modal-close" onClick={onClose}>
          x
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
        <button className="send-btn" onClick={submit} disabled={busy || !value.trim()}>
          Send
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

function AgentsPage() {
  const { data: agents, error, loading, reload } = useAsync(api.listAgents, [])
  const providersReq = useAsync(api.listProviders, [])
  const presetsReq = useAsync(api.listAgentPresets, [])
  const [form, setForm] = useState({
    name: '',
    provider_id: '',
    system_prompt: '',
    tools: '',
    max_turns: '',
  })
  const [presetKey, setPresetKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  const presets = presetsReq.data || {}
  const providers = providersReq.data || []

  const applyPreset = (key) => {
    setPresetKey(key)
    const p = presets[key]
    if (p) {
      setForm((f) => ({
        ...f,
        name: f.name || p.name || key,
        system_prompt: p.system_prompt || '',
        tools: Array.isArray(p.tools) ? p.tools.join(', ') : p.tools || '',
        max_turns: p.max_turns != null ? String(p.max_turns) : '',
      }))
    }
  }

  const submit = (e) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    const body = {
      name: form.name,
      provider_id: form.provider_id || undefined,
      system_prompt: form.system_prompt || undefined,
      tools: form.tools
        ? form.tools.split(',').map((t) => t.trim()).filter(Boolean)
        : undefined,
      max_turns: form.max_turns ? parseInt(form.max_turns, 10) : undefined,
    }
    api
      .createAgent(body)
      .then(() => {
        setForm({ name: '', provider_id: '', system_prompt: '', tools: '', max_turns: '' })
        setPresetKey('')
        reload()
      })
      .catch((err) => setFormError(err.message || String(err)))
      .finally(() => setSaving(false))
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const providerName = (id) => providers.find((p) => p.id === id)?.name || id || 'default'

  return (
    <div className="center-col">
      <div className="page-head">
        <h2>Agents</h2>
      </div>
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
        <select value={form.provider_id} onChange={set('provider_id')}>
          <option value="">Default provider</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.model})
            </option>
          ))}
        </select>
        <input
          placeholder="Tools (comma separated: repo, files, github, memory)"
          value={form.tools}
          onChange={set('tools')}
        />
        <input
          placeholder="Max turns"
          type="number"
          min="1"
          value={form.max_turns}
          onChange={set('max_turns')}
        />
        <textarea
          placeholder="System prompt"
          value={form.system_prompt}
          onChange={set('system_prompt')}
          rows={6}
        />
        <button className="btn primary" disabled={saving}>
          {saving ? 'Saving...' : 'Add agent'}
        </button>
        {formError && <div className="error-text">{formError}</div>}
      </form>
      {loading && <p className="note">Loading...</p>}
      {error && <p className="error-text">{error}</p>}
      {agents && agents.length === 0 && <p className="note">No agents configured.</p>}
      <div className="cards">
        {(agents || []).map((a) => (
          <div key={a.id} className="card">
            <h3>{a.name}</h3>
            <div className="meta">Provider: {providerName(a.provider_id)}</div>
            <div className="meta">Tools: {(a.tools || []).join(', ') || '(default)'}</div>
            <div className="meta">Max turns: {a.max_turns ?? '(default)'}</div>
            <div className="row" style={{ marginTop: 10, marginBottom: 0 }}>
              <button
                className="btn danger"
                onClick={() => api.deleteAgent(a.id).then(reload).catch((e) => alert(e.message))}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
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
          <div className="reader-body" dangerouslySetInnerHTML={{ __html: mdToHtml(content) }} />
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
          {loading ? 'Refreshing...' : 'Refresh'}
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
            {loading ? 'Refreshing...' : 'Refresh'}
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
            <div className="reader-body" dangerouslySetInnerHTML={{ __html: mdToHtml(fixReport) }} />
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
          {searching ? 'Searching...' : 'Search'}
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

// ---------- welcome ----------

function WelcomeView({ project, onStart }) {
  return (
    <div className="welcome">
      <h1>{project.name}</h1>
      <div className="repo">
        <code>{project.repo_url}</code>
      </div>
      <div className="welcome-prompt">
        <Composer
          busy={false}
          placeholder="What would you like to work on?"
          onSend={(msg) => onStart(msg)}
        />
      </div>
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
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              <div className="msg-role">{m.role === 'user' ? 'You' : 'Assistant'}</div>
              <div className="msg-content">{m.content}</div>
            </div>
          ))}
          {liveEvents.map((evt, i) =>
            evt.event === 'tool_call' ? (
              <ToolChip key={i} name={evt.name} args={evt.arguments} />
            ) : evt.event === 'tool_result' ? (
              <ToolResultChip key={i} name={evt.name} ok={evt.ok} preview={evt.preview} />
            ) : null
          )}
          {pending && (
            <div className="working">
              <span className="pulse" />
              {pending === 'working' ? 'Working...' : 'Responding...'}
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
  const [view, setView] = useState({ type: 'welcome' }) // welcome | chat | memory | about
  const [chatSessionId, setChatSessionId] = useState(null)
  const [initialMessage, setInitialMessage] = useState(null)
  const [showAddProject, setShowAddProject] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [agentId, setAgentId] = useState('')
  const [providerId, setProviderId] = useState('')
  const [settingsTab, setSettingsTab] = useState('providers')

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
  }

  const openChat = (sessionId) => {
    setView({ type: 'chat' })
    setChatSessionId(sessionId)
    setInitialMessage(null)
  }

  const startNewChat = () => {
    setView({ type: 'chat' })
    setChatSessionId(null)
    setInitialMessage(null)
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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">Home</div>
        <div className="sidebar-scroll">
          <div className="sidebar-label">
            Projects
            <button title="Add project" onClick={() => setShowAddProject(true)}>
              +
            </button>
          </div>
          {projects.map((p) => (
            <button
              key={p.id}
              className={`sidebar-item ${p.id === effectiveProjectId ? 'active' : ''}`}
              onClick={() => selectProject(p.id)}
            >
              <span className="dot" />
              {p.name}
            </button>
          ))}
          {projectsReq.loading && <div className="meta">Loading...</div>}
          {!projectsReq.loading && projects.length === 0 && (
            <div className="meta">No projects yet, click + to add one.</div>
          )}

          {project && (
            <div className="sidebar-section">
              <div className="sidebar-label">
                {project.name}
                <button title="New chat" onClick={startNewChat}>
                  +
                </button>
              </div>
              <button
                className={`sidebar-item ${
                  view.type === 'chat' && chatSessionId === null ? 'active' : ''
                }`}
                onClick={startNewChat}
              >
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
                className={`sidebar-item ${view.type === 'files' ? 'active' : ''}`}
                onClick={() => setView({ type: 'files' })}
              >
                Files
              </button>
              <button
                className={`sidebar-item ${view.type === 'memory' ? 'active' : ''}`}
                onClick={() => setView({ type: 'memory' })}
              >
                Memory
              </button>
              <button
                className={`sidebar-item ${view.type === 'about' ? 'active' : ''}`}
                onClick={() => setView({ type: 'about' })}
              >
                About
              </button>
            </div>
          )}

          <div className="sidebar-section">
            <div className="sidebar-label">Global</div>
            <button
              className={`sidebar-item ${view.type === 'agents' ? 'active' : ''}`}
              onClick={() => setView({ type: 'agents' })}
            >
              Agents
            </button>
            <button
              className={`sidebar-item ${view.type === 'gallery' ? 'active' : ''}`}
              onClick={() => setView({ type: 'gallery' })}
            >
              Gallery
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        {project && view.type !== 'agents' && view.type !== 'gallery' && (
          <header className="topbar">
            <div className="topbar-title">
              <span className="name">{project.name}</span>
              <span className="repo">{project.repo_url}</span>
            </div>
            <div className="topbar-right">
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Default (no profile)</option>
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
              <button className="icon-btn" title="Providers" onClick={() => setShowSettings(true)}>
                &#9881;
              </button>
            </div>
          </header>
        )}

        <div className="content">
          {!project && !projectsReq.loading && (
            <div className="empty">
              No projects yet. Click + next to Projects to add one.
            </div>
          )}
          {project && view.type === 'welcome' && (
            <WelcomeView
              project={project}
              onStart={(msg) => {
                setInitialMessage(msg)
                setView({ type: 'chat' })
                setChatSessionId(null)
              }}
            />
          )}
          {project && view.type === 'chat' && (
            <ChatView
              key={`${project.id}:${chatSessionId ?? 'new'}`}
              projectId={project.id}
              sessionId={chatSessionId}
              agentId={agentId}
              providerId={providerId}
              onSessionCreated={onSessionCreated}
              initialMessage={initialMessage}
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
                setView({ type: 'welcome' })
              }}
            />
          )}
          {view.type === 'agents' && <AgentsPage />}
          {view.type === 'gallery' && <GalleryView />}
        </div>
      </div>

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
