import { useEffect, useState } from 'react'
import { DEFAULT_THEME, LIGHT_THEME, THEME_LABELS, THEME_MODES, THEME_PRESETS, defaultThemeState, effectiveMode, hexToRgb } from '../theme.js'

export function ColorField({ label, value, onChange }) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const commit = () => {
    if (hexToRgb(draft)) onChange(draft)
    else setDraft(value)
  }

  return (
    <div className="theme-row">
      <label>{label}</label>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
    </div>
  )
}

export function ThemePanel({ theme, setTheme }) {
  const [editMode, setEditMode] = useState(effectiveMode(theme))
  const base = editMode === 'light' ? LIGHT_THEME : DEFAULT_THEME
  const overrides = theme.themes[editMode] || {}
  const value = (key) => overrides[key] || base[key]

  const setColor = (key, raw) => {
    setTheme({
      ...theme,
      themes: { ...theme.themes, [editMode]: { ...overrides, [key]: raw } },
    })
  }

  return (
    <div className="theme-panel">
      <div className="field">
        <span className="field-label">Appearance</span>
        <div className="segmented">
          {THEME_MODES.map(([mode, label]) => (
            <button
              key={mode}
              className={theme.mode === mode ? 'on' : ''}
              onClick={() => setTheme({ ...theme, mode })}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="field-hint">
          Follow system switches automatically when your OS theme changes.
        </span>
      </div>

      <div className="field">
        <span className="field-label">Presets</span>
        <div className="row" style={{ marginBottom: 0 }}>
          <button
            className="btn"
            onClick={() => {
              setEditMode('dark')
              setTheme({ ...theme, themes: { ...theme.themes, dark: {} } })
            }}
          >
            Hestia (default)
          </button>
          <button
            className="btn"
            onClick={() => {
              setEditMode('dark')
              setTheme({
                ...theme,
                themes: { ...theme.themes, dark: { ...THEME_PRESETS['titan-black'] } },
              })
            }}
          >
            Titan Black
          </button>
        </div>
      </div>

      <div className="field">
        <span className="field-label">Customize palette</span>
        <div className="segmented">
          {['light', 'dark'].map((mode) => (
            <button
              key={mode}
              className={editMode === mode ? 'on' : ''}
              onClick={() => setEditMode(mode)}
            >
              {mode === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </div>

      <div className="theme-grid">
        {Object.entries(THEME_LABELS).map(([key, label]) => (
          <ColorField key={key} label={label} value={value(key)} onChange={(v) => setColor(key, v)} />
        ))}
      </div>

      <div className="row" style={{ marginBottom: 0 }}>
        <button
          className="btn"
          onClick={() =>
            setTheme({ ...theme, themes: { ...theme.themes, [editMode]: {} } })
          }
        >
          Reset {editMode} palette
        </button>
        <button className="btn" onClick={() => setTheme(defaultThemeState())}>
          Reset all
        </button>
      </div>
    </div>
  )
}
