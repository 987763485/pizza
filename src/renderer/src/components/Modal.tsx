import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'

interface ModalProps {
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  width?: number
}

export function Modal({ title, children, onClose, footer, width = 440 }: ModalProps) {
  const { t } = useTranslation()
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal" style={{ width }}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button
            className="icon-btn"
            onClick={onClose}
            aria-label={t('ui.关闭')}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}
