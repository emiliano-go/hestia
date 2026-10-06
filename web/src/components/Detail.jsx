import { Icon } from '../icons.jsx'

export function DetailRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  )
}

export function DetailItem({ title, sub, onChat, url, chatLabel = 'Chat' }) {
  return (
    <div className="detail-item">
      <div className="detail-item-main">
        <span className="detail-item-title">{title}</span>
        {sub && <span className="detail-item-sub">{sub}</span>}
      </div>
      <div className="detail-item-actions">
        {url && (
          <a className="btn" href={url} target="_blank" rel="noreferrer">
            Open
          </a>
        )}
        {onChat && (
          <button className="btn" onClick={onChat}>
            <Icon name="chat" size={13} /> {chatLabel}
          </button>
        )}
      </div>
    </div>
  )
}
