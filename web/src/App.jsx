import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d) ? String(s) : d.toLocaleString()
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
  return { data, error, loading, reload, setData }
}

function truncate(s, n = 300) {
  if (!s) return ''
  s = String(s)
  return s.length > n ? s.slice(0, n) + '...' : s
}

// ---------- Projects page ----------

function ProjectsPage({ onOpen }) {
  const { data: projects, error, loading, reload } = useAsync(api.listProjects, [])
  const [name, setName] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  const submit = (e) => {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    api
      .createProject({ name, repo_url: repoUrl })
      .then(() => {
        setName('')
        setRepoUrl('')
        reload()
      })
      .catch((err) => setCreateError(err.message || String(err)))
      .finally(() => setCreating(false))
  }

  return (
    <div>
      <h2>Projects</h2>
      <form className="inline-form" onSubmit={submit}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          placeholder="Git URL"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          required
        />
        <button className="btn" disabled={creating}>
          {creating ? 'Cloning repository, this may take a while...' : 'Add project'}
        </button>
        {createError && <div className="error-text">{createError}</div>}
      </form>
      {loading && <p className="note">Loading...</p>}
      {error && <p className="error-text">{error}</p>}
      {projects && projects.length === 0 && <p className="note">No projects yet.</p>}
      <div className="cards">
        {(projects || []).map((p) => (
          <div key={p.id} className="card" onClick={() => onOpen(p.id)}>
            <h3>{p.name}</h3>
            <div className="meta">{p.repo_url}</div>
            <div className="meta">{fmtDate(p.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- Chat tab ----------

function ToolCallRow({ name, args }) {
  return (
    <details className="tool-row">
      <summary>
        tool_call: {name}({truncate(JSON.stringify(args), 80)})
      </summary>
      <div className="body">{JSON.stringify(args, null, 2)}</div>
    </details>
  )
}

function ToolResultRow({ name, ok, preview }) {
  return (
    <div className="tool-row tool-result">
      tool_result: {name}{' '}
      <span className={ok ? 'ok' : 'err'}>{ok ? 'ok' : 'error'}</span>:{' '}
      {truncate(preview, 200)}
    </div>
  )
}

function ChatTab({ projectId }) {
  const sessionsReq = useAsync(() => api.listSessions(projectId), [projectId])
  const providersReq = useAsync(api.listProviders, [])
  const agentsReq = useAsync(api.listAgents, [])
  const [sessionChoice, setSessionChoice] = useState('new')
  const [providerId, setProviderId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [messages, setMessages] = useState(null)
  const [streamEvents, setStreamEvents] = useState([])
  const [finalMessage, setFinalMessage] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const activeSessionRef = useRef(null)
  const bottomRef = useRef(null)

  const sessions = sessionsReq.data || []
  const activeSessionId =
    sessionChoice === 'new' ? activeSessionRef.current : sessionChoice

  useEffect(() => {
    if (activeSessionId) {
      api
        .listMessages(activeSessionId)
        .then(setMessages)
        .catch((e) => setError(e.message || String(e)))
    } else {
      setMessages(null)
    }
  }, [activeSessionId, sessionsReq.data])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamEvents, finalMessage])

  const send = (e) => {
    e.preventDefault()
    const message = input.trim()
    if (!message || busy) return
    setInput('')
    setBusy(true)
    setError(null)
    setStreamEvents([])
    setFinalMessage(null)
    const shownSession = activeSessionId
    api
      .chat(
        projectId,
        {
          message,
          session_id: shownSession || undefined,
          ...(agentId
            ? { agent_id: agentId }
            : { provider_id: providerId || undefined }),
        },
        {
          onEvent: (evt) => {
            if (evt.event === 'session') {
              activeSessionRef.current = evt.session_id
              setSessionChoice(evt.session_id)
            } else if (evt.event === 'message') {
              setFinalMessage(evt)
            } else if (evt.event === 'error') {
              setError(evt.message || 'Chat error')
            } else {
              setStreamEvents((prev) => [...prev, evt])
            }
          },
        }
      )
      .catch((err) => setError(err.message || String(err)))
      .finally(() => {
        setBusy(false)
        sessionsReq.reload()
        const sid = activeSessionRef.current
        if (sid) {
          api
            .listMessages(sid)
            .then(setMessages)
            .catch(() => {})
        }
      })
  }

  const providers = providersReq.data || []
  const agents = agentsReq.data || []

  return (
    <div>
      <div className="chat-controls">
        <select value={sessionChoice} onChange={(e) => setSessionChoice(e.target.value)}>
          <option value="new">New session</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title || s.id} ({fmtDate(s.created_at)})
            </option>
          ))}
        </select>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">Default (no profile)</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {!agentId &&
          (providers.length > 0 ? (
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">Default provider</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.model})
                </option>
              ))}
            </select>
          ) : (
            <span className="note">
              No providers configured, see <a href="#/providers">Providers</a>.
            </span>
          ))}
      </div>
      <div className="messages">
        {(messages || []).map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="role">{m.role}</div>
            <div className="content">{m.content}</div>
          </div>
        ))}
        {streamEvents.map((evt, i) =>
          evt.event === 'tool_call' ? (
            <ToolCallRow key={i} name={evt.name} args={evt.arguments} />
          ) : evt.event === 'tool_result' ? (
            <ToolResultRow key={i} name={evt.name} ok={evt.ok} preview={evt.preview} />
          ) : null
        )}
        {finalMessage && (
          <div className="msg assistant">
            <div className="role">assistant</div>
            <div className="content">{finalMessage.content}</div>
          </div>
        )}
        {busy && !finalMessage && <p className="note">Thinking...</p>}
        {!busy && !messages?.length && !finalMessage && (
          <p className="note">No messages yet, send one below.</p>
        )}
        <div ref={bottomRef} />
      </div>
      {error && <p className="error-text">{error}</p>}
      <form className="chat-input" onSubmit={send}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e)
          }}
        />
        <button className="btn" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}

// ---------- Memory tab ----------

function MemoryTab({ projectId }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [searching, setSearching] = useState(false)

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

  return (
    <div>
      <form className="chat-input" onSubmit={search}>
        <input
          style={{ flex: 1 }}
          placeholder="Search memory..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn" disabled={searching}>
          {searching ? 'Searching...' : 'Search'}
        </button>
      </form>
      <div style={{ height: 12 }} />
      {error && <p className="error-text">{error}</p>}
      {items && items.length === 0 && <p className="note">No memory items found.</p>}
      <div className="cards">
        {(items || []).map((m) => (
          <div key={m.id} className="card" style={{ cursor: 'default' }}>
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
              ))}
              {fmtDate(m.updatedAt || m.updated_at)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- About tab ----------

function AboutTab({ project, onPulled }) {
  const [pulling, setPulling] = useState(false)
  const [pullOutput, setPullOutput] = useState(null)
  const [error, setError] = useState(null)

  const pull = () => {
    setPulling(true)
    setError(null)
    setPullOutput(null)
    api
      .pullProject(project.id)
      .then((r) => {
        setPullOutput(r.output || '')
        onPulled()
      })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setPulling(false))
  }

  const status = project.status || {}
  return (
    <div>
      <div className="row">
        <span className="muted">Repo:</span>
        <a href={project.repo_url} target="_blank" rel="noreferrer">
          {project.repo_url}
        </a>
      </div>
      <div className="row">
        <span className="muted">Local path:</span>
        <span>{project.local_path}</span>
      </div>
      <div className="row">
        <span className="muted">Branch:</span>
        <span>{status.branch || 'unknown'}</span>
      </div>
      <div className="row">
        <span className="muted">Head:</span>
        <span>{status.head || 'unknown'}</span>
      </div>
      <button className="btn" onClick={pull} disabled={pulling}>
        {pulling ? 'Pulling...' : 'Pull'}
      </button>
      {error && <p className="error-text">{error}</p>}
      {pullOutput !== null && <pre>{pullOutput || '(no output)'}</pre>}
      <h3>AGENTS.md</h3>
      <pre>{project.agents_md || '(empty)'}</pre>
    </div>
  )
}

// ---------- Project view ----------

function ProjectView({ projectId, onDeleted }) {
  const { data: project, error, loading, reload } = useAsync(
    () => api.getProject(projectId),
    [projectId]
  )
  const [tab, setTab] = useState('chat')
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (loading) return <p className="note">Loading...</p>
  if (error) return <p className="error-text">{error}</p>
  if (!project) return null

  return (
    <div>
      <div className="row">
        <h2 style={{ margin: 0 }}>{project.name}</h2>
        {confirmDelete ? (
          <>
            <button
              className="btn danger"
              onClick={() =>
                api.deleteProject(project.id).then(onDeleted).catch((e) => alert(e.message))
              }
            >
              Confirm delete
            </button>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn danger" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </div>
      <div className="tabs">
        {['chat', 'memory', 'about'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'chat' && <ChatTab projectId={projectId} />}
      {tab === 'memory' && <MemoryTab projectId={projectId} />}
      {tab === 'about' && <AboutTab project={project} onPulled={reload} />}
    </div>
  )
}

// ---------- Providers page ----------

function ProvidersPage() {
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
      setForm({ name: p.name || key, base_url: p.base_url || '', api_key_env: p.api_key_env || '', model: p.model || '' })
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
      <h2>Providers</h2>
      <form className="inline-form" onSubmit={submit}>
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
        <button className="btn" disabled={saving}>
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
            <div key={p.id} className="card" style={{ cursor: 'default' }}>
              <h3>
                {p.name}{' '}
                {tr &&
                  !tr.testing &&
                  (tr.ok ? (
                    <span className="badge ok">ok: {tr.model || p.model}</span>
                  ) : (
                    <span className="badge err">error</span>
                  ))}
              </h3>
              <div className="meta">{p.base_url}</div>
              <div className="meta">
                {p.model} (key: {p.api_key_env})
              </div>
              {tr && !tr.testing && !tr.ok && tr.error && (
                <div className="meta error-text">{tr.error}</div>
              )}
              <div className="row" style={{ marginTop: 8, marginBottom: 0 }}>
                <button className="btn" onClick={() => test(p.id)} disabled={tr?.testing}>
                  {tr?.testing ? 'Testing...' : 'Test'}
                </button>
                <button
                  className="btn danger"
                  onClick={() => api.deleteProvider(p.id).then(reload).catch((e) => alert(e.message))}
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

// ---------- Agents page ----------

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
    <div>
      <h2>Agents</h2>
      <form className="inline-form" onSubmit={submit}>
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
        <button className="btn" disabled={saving}>
          {saving ? 'Saving...' : 'Add agent'}
        </button>
        {formError && <div className="error-text">{formError}</div>}
      </form>
      {loading && <p className="note">Loading...</p>}
      {error && <p className="error-text">{error}</p>}
      {agents && agents.length === 0 && <p className="note">No agents configured.</p>}
      <div className="cards">
        {(agents || []).map((a) => (
          <div key={a.id} className="card" style={{ cursor: 'default' }}>
            <h3>{a.name}</h3>
            <div className="meta">Provider: {providerName(a.provider_id)}</div>
            <div className="meta">Tools: {(a.tools || []).join(', ') || '(default)'}</div>
            <div className="meta">Max turns: {a.max_turns ?? '(default)'}</div>
            <div className="row" style={{ marginTop: 8, marginBottom: 0 }}>
              <button
                className="btn danger"
                onClick={() =>
                  api.deleteAgent(a.id).then(reload).catch((e) => alert(e.message))
                }
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

// ---------- App shell ----------

export default function App() {
  // view: {page: 'projects'} | {page: 'providers'} | {page: 'project', id}
  const [view, setView] = useState({ page: 'projects' })

  return (
    <div>
      <nav className="topnav">
        <span className="brand" onClick={() => setView({ page: 'projects' })}>
          Home
        </span>
        <button
          className={view.page === 'projects' ? 'active' : ''}
          onClick={() => setView({ page: 'projects' })}
        >
          Projects
        </button>
        <button
          className={view.page === 'providers' ? 'active' : ''}
          onClick={() => setView({ page: 'providers' })}
        >
          Providers
        </button>
        <button
          className={view.page === 'agents' ? 'active' : ''}
          onClick={() => setView({ page: 'agents' })}
        >
          Agents
        </button>
      </nav>
      <main>
        {view.page === 'projects' && (
          <ProjectsPage onOpen={(id) => setView({ page: 'project', id })} />
        )}
        {view.page === 'providers' && <ProvidersPage />}
        {view.page === 'agents' && <AgentsPage />}
        {view.page === 'project' && (
          <ProjectView projectId={view.id} onDeleted={() => setView({ page: 'projects' })} />
        )}
      </main>
    </div>
  )
}
