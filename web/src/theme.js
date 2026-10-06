export const THEME_KEY = 'hestia-theme'

export const DEFAULT_THEME = {
  '--content-bg': '#262624',
  '--sidebar-bg': '#1f1e1d',
  '--surface': '#30302e',
  '--border': '#3d3d3a',
  '--fg': '#f5f4ef',
  '--muted': '#8f8d86',
  '--accent': '#d97757',
  '--ok': '#6a9955',
  '--err': '#e06c5a',
}

export const LIGHT_THEME = {
  '--content-bg': '#faf9f5',
  '--sidebar-bg': '#f0eee8',
  '--surface': '#ffffff',
  '--border': '#d9d4c9',
  '--fg': '#2b2a27',
  '--muted': '#6f6d66',
  '--accent': '#c96442',
  '--ok': '#4f7a3f',
  '--err': '#c0392b',
}

export const THEME_LABELS = {
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

export const THEME_MODES = [
  ['system', 'Follow system'],
  ['light', 'Light'],
  ['dark', 'Dark'],
]

export const THEME_PRESETS = {
  'titan-black': {
    '--content-bg': '#101018',
    '--sidebar-bg': '#0c0c14',
    '--surface': '#1b1b28',
    '--border': '#2a2a3c',
    '--fg': '#d4d4e0',
    '--muted': '#9a9aac',
    '--accent': '#6ab0cf',
    '--ok': '#70b090',
    '--err': '#d06060',
  },
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

export function mixColors(a, b, t) {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  if (!ca || !cb) return a
  return rgbToHex(ca.map((v, i) => v + (cb[i] - v) * t))
}

export function rgba(hex, alpha) {
  const rgb = hexToRgb(hex)
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : hex
}

export function luminance(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function readableOn(hex) {
  return luminance(hex) > 0.2 ? '#20130c' : '#ffffff'
}

export function systemMode() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function effectiveMode(state) {
  return state.mode === 'system' ? systemMode() : state.mode
}

export function defaultThemeState() {
  return { mode: 'system', themes: { dark: {}, light: {} } }
}

export function loadThemeState() {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (!raw) return defaultThemeState()
    const parsed = JSON.parse(raw)
    if (parsed && parsed.themes) {
      return {
        mode: THEME_MODES.some(([m]) => m === parsed.mode) ? parsed.mode : 'system',
        themes: { dark: parsed.themes.dark || {}, light: parsed.themes.light || {} },
      }
    }
    if (parsed && Object.keys(parsed).some((k) => k.startsWith('--'))) {
      // legacy single palette: keep it as dark-mode overrides
      return { mode: 'dark', themes: { dark: parsed, light: {} } }
    }
    return defaultThemeState()
  } catch (e) {
    return defaultThemeState()
  }
}

export function saveThemeState(state) {
  const themes = {}
  for (const mode of ['dark', 'light']) {
    const base = mode === 'light' ? LIGHT_THEME : DEFAULT_THEME
    const clean = Object.fromEntries(
      Object.entries(state.themes[mode] || {}).filter(
        ([k, v]) => base[k] && hexToRgb(v) && v !== base[k]
      )
    )
    if (Object.keys(clean).length) themes[mode] = clean
  }
  if (state.mode === 'system' && Object.keys(themes).length === 0) {
    localStorage.removeItem(THEME_KEY)
  } else {
    localStorage.setItem(THEME_KEY, JSON.stringify({ mode: state.mode, themes }))
  }
}

export function applyThemeState(state) {
  const mode = effectiveMode(state)
  const base = mode === 'light' ? LIGHT_THEME : DEFAULT_THEME
  const vars = { ...base, ...(state.themes[mode] || {}) }
  const root = document.documentElement.style
  root.setProperty('color-scheme', mode)
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v)

  const fg = vars['--fg']
  const contentBg = vars['--content-bg']
  const sidebarBg = vars['--sidebar-bg']
  const surface = vars['--surface']
  const border = vars['--border']
  const accent = vars['--accent']

  root.setProperty('--sidebar-bg-hover', mixColors(sidebarBg, fg, 0.06))
  root.setProperty('--sidebar-active', mixColors(sidebarBg, fg, 0.12))
  root.setProperty('--surface-2', mixColors(surface, fg, 0.05))
  root.setProperty('--surface-hover', mixColors(surface, fg, 0.09))
  root.setProperty('--border-soft', mixColors(border, contentBg, 0.45))
  root.setProperty('--fg-secondary', mixColors(fg, contentBg, 0.25))
  root.setProperty('--faint', mixColors(fg, contentBg, 0.5))
  root.setProperty('--accent-dim', mixColors(accent, '#000000', 0.18))
  root.setProperty(
    '--accent-hover',
    mode === 'light' ? mixColors(accent, '#000000', 0.08) : mixColors(accent, '#ffffff', 0.12)
  )
  root.setProperty('--accent-soft', rgba(accent, 0.14))
  root.setProperty('--ok-soft', rgba(vars['--ok'], 0.14))
  root.setProperty('--err-soft', rgba(vars['--err'], 0.14))
  root.setProperty('--on-accent', readableOn(accent))

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', contentBg)
}
