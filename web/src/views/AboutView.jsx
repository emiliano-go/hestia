import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Spinner } from '../components/primitives.jsx'
import { Icon } from '../icons.jsx'
import { fmtDate, fmtTokens } from '../lib/format.js'
import { useAsync } from '../lib/hooks.js'

export function AboutView({ projectId, onDeleted }) {
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
