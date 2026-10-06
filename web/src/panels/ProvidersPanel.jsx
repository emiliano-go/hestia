import { useState } from 'react'
import { api } from '../api.js'
import { Spinner } from '../components/primitives.jsx'
import { useAsync } from '../lib/hooks.js'

const EMPTY = { name: '', base_url: '', api_key: '', model: '' }
const STEPS = ['Provider', 'API key', 'Model']

export function ProvidersPanel() {
  const { data: providers, error, loading, reload } = useAsync(api.listProviders, [])
  const presetsReq = useAsync(api.listPresets, [])
  const [step, setStep] = useState(0)
  const [presetKey, setPresetKey] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [models, setModels] = useState([])
  const [customModel, setCustomModel] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const [testResults, setTestResults] = useState({})

  const presets = presetsReq.data || {}
  const isCustom = presetKey === 'custom'

  const reset = () => {
    setStep(0)
    setPresetKey('')
    setForm(EMPTY)
    setModels([])
    setCustomModel(false)
    setFormError(null)
  }

  const choosePreset = (key) => {
    const p = presets[key] || {}
    setPresetKey(key)
    setForm({
      name: p.name || key,
      base_url: p.base_url || '',
      api_key: '',
      model: p.model || '',
    })
    setModels([])
    setCustomModel(false)
    setFormError(null)
    setStep(1)
  }

  const loadModels = (advance) => {
    if (!form.base_url.trim()) {
      setFormError('Base URL is required.')
      return
    }
    setLoadingModels(true)
    setFormError(null)
    api
      .listProviderModels({ base_url: form.base_url, api_key: form.api_key })
      .then((r) => {
        const list = r.models || []
        setModels(list)
        if (!form.model && list.length) setForm((f) => ({ ...f, model: list[0] }))
        if (!list.length) setFormError('No models returned for that key.')
        if (advance) setStep(2)
      })
      .catch((err) => {
        setFormError(err.message || String(err))
        if (advance) setStep(2)
      })
      .finally(() => setLoadingModels(false))
  }

  const submit = (e) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    api
      .createProvider(form)
      .then(() => {
        reset()
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
      <div className="wizard">
        <div className="wizard-steps">
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={`wizard-step ${step === i ? 'active' : ''} ${step > i ? 'done' : ''}`}
            >
              <span className="wizard-dot">{step > i ? '✓' : i + 1}</span>
              <span className="wizard-label">{label}</span>
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="wizard-body">
            <p className="note">Pick a provider to register.</p>
            <div className="preset-grid">
              {Object.entries(presets).map(([k, p]) => (
                <button key={k} type="button" className="preset-card" onClick={() => choosePreset(k)}>
                  <span className="preset-name">{p.name || k}</span>
                  <span className="preset-url">{p.base_url}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <form
            className="wizard-body"
            onSubmit={(e) => {
              e.preventDefault()
              loadModels(true)
            }}
          >
            <p className="note">
              {form.name} · <code>{form.base_url}</code>
            </p>
            {isCustom && (
              <label className="field">
                <span className="field-label">Base URL</span>
                <input
                  value={form.base_url}
                  onChange={set('base_url')}
                  placeholder="https://api.example.com"
                  required
                />
              </label>
            )}
            <label className="field">
              <span className="field-label">API key</span>
              <input
                type="password"
                value={form.api_key}
                onChange={set('api_key')}
                placeholder="Paste your API key (blank for local endpoints)"
                autoFocus
              />
            </label>
            {formError && <div className="error-text">{formError}</div>}
            <div className="row" style={{ marginBottom: 0 }}>
              <button type="button" className="btn" onClick={() => setStep(0)}>
                Back
              </button>
              <button
                className="btn primary"
                disabled={loadingModels || !form.base_url.trim()}
              >
                {loadingModels ? (
                  <>
                    <Spinner size={13} /> Loading models
                  </>
                ) : (
                  'Continue'
                )}
              </button>
            </div>
          </form>
        )}

        {step === 2 && (
          <form className="wizard-body" onSubmit={submit}>
            <label className="field">
              <span className="field-label">Model</span>
              {models.length > 0 && !customModel ? (
                <div className="row" style={{ marginBottom: 0 }}>
                  <select
                    value={form.model}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setCustomModel(true)
                        setForm((f) => ({ ...f, model: '' }))
                      } else {
                        setForm((f) => ({ ...f, model: e.target.value }))
                      }
                    }}
                    required
                  >
                    <option value="">Choose a model...</option>
                    {form.model && !models.includes(form.model) && (
                      <option value={form.model}>{form.model}</option>
                    )}
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    <option value="__custom__">Custom…</option>
                  </select>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => loadModels(false)}
                    disabled={loadingModels}
                  >
                    {loadingModels ? <Spinner size={13} /> : 'Reload'}
                  </button>
                </div>
              ) : (
                <div className="row" style={{ marginBottom: 0 }}>
                  <input
                    value={form.model}
                    onChange={set('model')}
                    placeholder="model id"
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => loadModels(false)}
                    disabled={loadingModels}
                  >
                    {loadingModels ? <Spinner size={13} /> : 'Load models'}
                  </button>
                </div>
              )}
              {models.length > 0 && (
                <span className="field-hint">{models.length} models available</span>
              )}
            </label>
            <label className="field">
              <span className="field-label">Name</span>
              <input value={form.name} onChange={set('name')} placeholder="e.g. OpenCode Go" required />
            </label>
            {formError && <div className="error-text">{formError}</div>}
            <div className="row" style={{ marginBottom: 0 }}>
              <button type="button" className="btn" onClick={() => setStep(1)}>
                Back
              </button>
              <button
                className="btn primary"
                disabled={saving || !form.name.trim() || !form.model.trim()}
              >
                {saving ? 'Saving...' : 'Add provider'}
              </button>
            </div>
          </form>
        )}
      </div>

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
                {p.model} ({p.has_key ? 'key stored' : 'no key'})
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
