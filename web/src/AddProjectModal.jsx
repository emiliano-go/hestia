import { useState } from 'react'
import { api } from './api.js'
import { Modal } from './components/Modal.jsx'
import { Spinner } from './components/primitives.jsx'

export function AddProjectModal({ onClose, onCreated }) {
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
