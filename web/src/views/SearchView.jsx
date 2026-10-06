import { useState } from 'react'
import { api } from '../api.js'
import { SectionEmpty, Spinner } from '../components/primitives.jsx'
import { Icon } from '../icons.jsx'
import { relDate, truncate } from '../lib/format.js'

export function SearchView({ onOpenMemory, onOpenSession, onOpenFile }) {
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
