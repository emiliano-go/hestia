import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Icon } from '../icons.jsx'
import { fmtBytes } from '../lib/format.js'
import { useAsync } from '../lib/hooks.js'
import { mdToHtml } from '../lib/markdown.js'

export function FileReaderPane({ projectId, path, onClose }) {
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

export function FilesView({ projectId }) {
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

export function GalleryView() {
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
