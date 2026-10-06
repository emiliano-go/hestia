import { useMemo } from 'react'
import { api } from '../api.js'
import { SectionEmpty, Skeleton } from '../components/primitives.jsx'
import { Icon } from '../icons.jsx'
import { relDate, truncate } from '../lib/format.js'
import { useAsync } from '../lib/hooks.js'
import { clickable } from '../lib/ui.js'

export const ACTIVITY_META = {
  session: { icon: 'chat', label: 'Conversation' },
  memory: { icon: 'memory', label: 'Memory' },
  file: { icon: 'files', label: 'File' },
  commit: { icon: 'git', label: 'Commit' },
  pr: { icon: 'git', label: 'Pull request' },
  issue: { icon: 'chat', label: 'Issue' },
  run: { icon: 'play', label: 'CI run' },
}

export function dayLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const today = new Date()
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(today) - startOf(d)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ActivityView({ projectId, onOpenSession, onOpenFile }) {
  const { data, error, loading } = useAsync(() => api.projectActivity(projectId), [projectId])
  const items = (data && data.items) || []

  const groups = useMemo(() => {
    const out = []
    let current = null
    for (const item of items) {
      const label = dayLabel(item.timestamp)
      if (!current || current.label !== label) {
        current = { label, items: [] }
        out.push(current)
      }
      current.items.push(item)
    }
    return out
  }, [items])

  return (
    <div className="center-col">
      <div className="page-head">
        <h2>Activity</h2>
      </div>
      {error && <p className="error-text">{error}</p>}
      {loading && (
        <div className="gh-list">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="row-skeleton" />
          ))}
        </div>
      )}
      {!loading && items.length === 0 && (
        <SectionEmpty
          icon="clock"
          title="No activity yet"
          hint="Conversations, memory, files, commits, and GitHub events will appear here."
        />
      )}
      {groups.map((group) => (
        <div key={group.label} className="activity-group">
          <div className="activity-day">{group.label}</div>
          {group.items.map((item, i) => {
            const meta = ACTIVITY_META[item.kind] || { icon: 'clock' }
            const clickable = item.session_id || item.path
            return (
              <button
                key={`${item.kind}-${item.timestamp}-${i}`}
                className={`activity-row ${clickable ? 'clickable' : ''} ${item.url ? 'external' : ''}`}
                onClick={() => {
                  if (item.session_id) onOpenSession(item.session_id)
                  else if (item.path) onOpenFile(item)
                  else if (item.url) window.open(item.url, '_blank', 'noreferrer')
                }}
              >
                <span className={`activity-icon ${item.kind}`}>
                  <Icon name={meta.icon} size={14} />
                </span>
                <span className="activity-main">
                  <span className="activity-title">{truncate(item.title, 90)}</span>
                  <span className="activity-sub">{item.subtitle}</span>
                </span>
                <span className="activity-time">{relDate(item.timestamp)}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
