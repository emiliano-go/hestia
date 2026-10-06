import { useState } from 'react'
import { api } from '../api.js'
import { Spinner } from '../components/primitives.jsx'
import { Icon } from '../icons.jsx'
import { useAsync } from '../lib/hooks.js'

export function GithubPanel() {
  const { data, loading, reload } = useAsync(api.githubStatus, [])
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

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
    </div>
  )
}
