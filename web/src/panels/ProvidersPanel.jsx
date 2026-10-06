import { useState } from 'react'
import { api } from '../api.js'
import { Spinner } from '../components/primitives.jsx'
import { useAsync } from '../lib/hooks.js'

export function ProvidersPanel() {
  const { data: providers, error, loading, reload } = useAsync(api.listProviders, [])
  const presetsReq = useAsync(api.listPresets, [])
  const [form, setForm] = useState({
    name: '',
    base_url: '',
    api_key: '',
    api_key_env: '',
    model: '',
  })
  const [presetKey, setPresetKey] = useState('')
  const [models, setModels] = useState([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const [testResults, setTestResults] = useState({})

  const presets = presetsReq.data || {}

  const applyPreset = (key) => {
    setPresetKey(key)
    const p = presets[key]
    if (p) {
      setForm((f) => ({
        ...f,
        name: p.name || key,
        base_url: p.base_url || '',
        api_key_env: p.api_key_env || '',
        model: p.model || '',
      }))
    }
  }

  const loadModels = () => {
    if (!form.base_url.trim()) return
    setLoadingModels(true)
    setFormError(null)
    api
      .listProviderModels({
        base_url: form.base_url,
        api_key: form.api_key,
        api_key_env: form.api_key_env,
      })
      .then((r) => {
        const list = r.models || []
        setModels(list)
        if (!form.model && list.length) setForm((f) => ({ ...f, model: list[0] }))
        if (!list.length) setFormError('No models returned for that key.')
      })
      .catch((err) => setFormError(err.message || String(err)))
      .finally(() => setLoadingModels(false))
  }

  const submit = (e) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    api
      .createProvider(form)
      .then(() => {
        setForm({ name: '', base_url: '', api_key: '', api_key_env: '', model: '' })
        setPresetKey('')
        setModels([])
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
          type="password"
          placeholder="API key (stored) — optional"
          value={form.api_key}
          onChange={set('api_key')}
        />
        <input
          placeholder="API key env var (optional)"
          value={form.api_key_env}
          onChange={set('api_key_env')}
        />
        <div className="row" style={{ marginBottom: 0 }}>
          <input
            list="provider-model-options"
            placeholder="Model"
            value={form.model}
            onChange={set('model')}
          />
          <button
            type="button"
            className="btn"
            onClick={loadModels}
            disabled={loadingModels || !form.base_url.trim()}
          >
            {loadingModels ? <Spinner size={13} /> : 'Load models'}
          </button>
        </div>
        <datalist id="provider-model-options">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
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
                {p.model} (
                {p.has_key ? 'key stored' : p.api_key_env ? `env: ${p.api_key_env}` : 'no key'})
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
