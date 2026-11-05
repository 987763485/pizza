import { useTranslation } from 'react-i18next'
import { useAppStore } from '../store'
import { Icon } from './Icon'

/**
 * 统一审批对话框。审批由主进程排队；这里只展示队首请求，
 * 决定通过 IPC 回传，渲染层无法直接放行工具。
 */
export function ApprovalDialog() {
  const { t } = useTranslation()
  const approvals = useAppStore((state) => state.approvals)
  const decideApproval = useAppStore((state) => state.decideApproval)
  const current = approvals[0]

  if (!current) return null

  return (
    <div className="modal-backdrop approval-backdrop">
      <div className="modal approval-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">
            <Icon name="shield" size={16} /> {t('approval.title')}
          </div>
          {approvals.length > 1 ? (
            <span className="badge">
              {t('approval.pending', { count: approvals.length - 1 })}
            </span>
          ) : null}
        </div>
        <div className="modal-body">
          <div className="approval-meta">
            <span className={`badge risk-${current.risk}`}>{t(`approval.${current.risk}`)}</span>
            <span className="settings-row-desc">
              {current.agentName ?? t('ui.智能体')} · {current.policySource}
            </span>
          </div>
          <div className="approval-tool">{current.toolName}</div>
          <pre className="code-preview compact">{current.toolInputSummary || t('ui.（无参数）')}</pre>
          <p className="field-help">{t('approval.note')}</p>
        </div>
        <div className="modal-foot">
          <button
            className="btn btn-danger"
            onClick={() => void decideApproval(current.id, 'deny')}
          >
            {t('approval.deny')}
          </button>
          <span style={{ flex: 1 }} />
          <button
            className="btn"
            onClick={() => void decideApproval(current.id, 'always_allow')}
          >
            {t('approval.alwaysAllow')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void decideApproval(current.id, 'allow_once')}
          >
            {t('approval.allowOnce')}
          </button>
        </div>
      </div>
    </div>
  )
}
