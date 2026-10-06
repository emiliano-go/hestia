import { createPortal } from 'react-dom'
import { Icon } from '../icons.jsx'

export function Modal({ title, onClose, children }) {
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn modal-close" onClick={onClose} title="Close">
          <Icon name="x" size={16} />
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>,
    document.body
  )
}
