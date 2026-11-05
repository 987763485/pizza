import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  RUNTIME_PRESETS,
  type RuntimeAdapterId,
  type RuntimeDetection,
  type RuntimeInput,
} from '@shared/types'
import { useAppStore } from '../store'
import { BrandMark } from './Brand'
import { Icon } from './Icon'
import { RuntimeLogo } from './RuntimeLogo'

/**
 * 首次启动引导。
 *
 * 只有没有运行时或没有智能体时才出现；检测结果只用于展示，
 * 不执行未知脚本，也不强制用户先配置运行时才能进入首页。
 */
export function Onboarding() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const settings = useAppStore((state) => state.settings)
  const runtimes = useAppStore((state) => state.runtimes)
  const agents = useAppStore((state) => state.agents)
  const currentWorkspaceId = useAppStore((state) => state.currentWorkspaceId)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const refreshAgents = useAppStore((state) => state.refreshAgents)
  const refreshRuntimes = useAppStore((state) => state.refreshRuntimes)
  const createSession = useAppStore((state) => state.createSession)
  const [detections, setDetections] = useState<RuntimeDetection[]>([])
  const [selected, setSelected] = useState<RuntimeAdapterId[]>([])
  const [busy, setBusy] = useState(false)
  const [detected, setDetected] = useState(false)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 })
  const [importNote, setImportNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(
    null,
  )
  const [hidden, setHidden] = useState(false)

  const visible =
    !hidden &&
    settings !== null &&
    !settings.onboardingCompleted &&
    (runtimes.length === 0 || agents.length === 0)

  // 从运行时接入页返回首页后，重新展示「创建通用助手」步骤。
  useEffect(() => {
    if (location.pathname === '/' && settings && !settings.onboardingCompleted) {
      setHidden(false)
    }
  }, [location.pathname, settings])

  async function detect() {
    setBusy(true)
    try {
      const found = await window.pizza.onboarding.detect()
      const imported = new Set(runtimes.map((runtime) => runtime.adapter))
      setDetections(found)
      setSelected(
        found
          .filter(
            (item) => item.installed && !item.needsLogin && !imported.has(item.adapter),
          )
          .map((item) => item.adapter),
      )
      setImportNote(null)
      setDetected(true)
    } finally {
      setBusy(false)
    }
  }

  function toggleSelected(adapter: RuntimeAdapterId) {
    setSelected((current) =>
      current.includes(adapter)
        ? current.filter((item) => item !== adapter)
        : [...current, adapter],
    )
    setImportNote(null)
  }

  async function importSelected() {
    const imported = new Set(runtimes.map((runtime) => runtime.adapter))
    const candidates = selected
      .map((adapter) => detections.find((item) => item.adapter === adapter))
      .filter(
        (item): item is RuntimeDetection =>
          Boolean(item?.installed && item.path && !imported.has(item.adapter)),
      )

    if (candidates.length === 0) return
    setImporting(true)
    setImportNote(null)
    setImportProgress({ done: 0, total: candidates.length })

    const failed: RuntimeAdapterId[] = []
    let succeeded = 0
    for (const [index, item] of candidates.entries()) {
      setImportProgress({ done: index, total: candidates.length })
      const preset = RUNTIME_PRESETS.find((entry) => entry.adapter === item.adapter)
      if (!preset) {
        failed.push(item.adapter)
        continue
      }
      const input: RuntimeInput = {
        name: preset.name,
        adapter: preset.adapter,
        protocol: preset.protocol,
        transport: preset.transport,
        command: item.path ?? preset.command,
        args: preset.args,
        env: {},
        timeoutMs: 30_000,
        autoReconnect: true,
      }
      try {
        const tested = await window.pizza.runtime.test(input)
        if (!tested.ok) {
          failed.push(item.adapter)
          continue
        }
        await window.pizza.runtime.create(input)
        succeeded += 1
      } catch {
        failed.push(item.adapter)
      }
    }

    setImportProgress({ done: candidates.length, total: candidates.length })
    await refreshRuntimes()
    setSelected(failed)
    setImporting(false)
    setImportNote({
      tone: failed.length ? 'error' : 'ok',
      text: failed.length
        ? t('onboarding.importPartial', { ok: succeeded, failed: failed.length })
        : t('onboarding.importDone', { count: succeeded }),
    })
  }

  async function finish(then?: () => void) {
    await updateSettings({ onboardingCompleted: true })
    setHidden(true)
    then?.()
  }

  async function createAssistant() {
    if (!currentWorkspaceId || runtimes.length === 0) return
    setCreating(true)
    try {
      const agent = await window.pizza.agent.create({
        name: t('ui.通用助手'),
        description: t('ui.由首次启动引导创建的默认智能体'),
        runtimeId: runtimes[0].id,
        prompt: t('ui.你是一个通用助手。先确认目标与约束，再给出可执行的步骤和结果。'),
      })
      await refreshAgents()
      await updateSettings({ onboardingCompleted: true })
      setHidden(true)
      const session = await createSession(agent.id)
      if (session) navigate(`/session/${session.id}`)
    } finally {
      setCreating(false)
    }
  }

  if (!visible) return null

  const installed = detections.filter((item) => item.installed)
  const importedAdapters = new Set(runtimes.map((runtime) => runtime.adapter))
  const selectableCount = detections.filter(
    (item) => item.installed && !importedAdapters.has(item.adapter),
  ).length

  return (
    <div className="onboarding-backdrop">
      <div className="onboarding-card">
        <div className="onboarding-head">
          <span className="onboarding-mark">
            <BrandMark size={26} />
          </span>
          <div>
            <h1>{t('onboarding.title')}</h1>
            <p>{t('onboarding.sub')}</p>
          </div>
        </div>

        <div className="onboarding-detection">
          <div className="onboarding-detection-copy">
            <div className="onboarding-detection-title">{t('onboarding.runtimeTitle')}</div>
            <p className="onboarding-detection-desc">
              {busy
                ? t('onboarding.scanningHint')
                : detected
                  ? t('onboarding.detected', { count: installed.length })
                  : t('ui.点击开始检测本机已安装的运行时。')}
            </p>
          </div>
          <button
            className={`btn ${detected ? '' : 'btn-primary'}`}
            disabled={busy}
            onClick={() => void detect()}
          >
            <Icon name={busy ? 'loader' : detected ? 'refresh' : 'search'} size={14} />
            {busy
              ? t('onboarding.detecting')
              : detected
                ? t('onboarding.redetect')
                : t('ui.开始检测')}
          </button>
        </div>

        {detected ? (
          <div className="onboarding-runtimes">
            {detections.map((item) => {
              const isImported = importedAdapters.has(item.adapter)
              const isSelected = selected.includes(item.adapter)
              return (
                <label
                  key={item.adapter}
                  className={`onboarding-runtime ${item.installed ? 'installed' : ''} ${
                    isSelected ? 'selected' : ''
                  } ${isImported ? 'imported' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="onboarding-runtime-check"
                    checked={isImported || isSelected}
                    disabled={!item.installed || isImported || importing}
                    onChange={() => toggleSelected(item.adapter)}
                  />
                  <span className="onboarding-runtime-logo">
                    <RuntimeLogo adapter={item.adapter} size={18} />
                  </span>
                  <span className="onboarding-runtime-name">{item.name}</span>
                  <span className="settings-row-desc">
                    {isImported
                      ? t('onboarding.imported')
                      : item.installed
                        ? item.needsLogin
                          ? t('onboarding.needsLogin')
                          : item.version?.slice(0, 32)
                        : t('onboarding.notInstalled')}
                  </span>
                </label>
              )
            })}
          </div>
        ) : null}

        {importNote ? (
          <div className={`onboarding-import-note ${importNote.tone}`} role="status">
            {importNote.text}
          </div>
        ) : null}

        {runtimes.length > 0 && agents.length === 0 ? (
          <div className="onboarding-section">
            <div className="settings-row-desc">
              {t('ui.运行时已接入。创建「通用助手」智能体并进入首个会话：')}
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: 8 }}
              disabled={creating}
              onClick={() => void createAssistant()}
            >
              {creating ? t('ui.正在创建…') : t('ui.创建通用助手并开始')}
            </button>
          </div>
        ) : null}

        <div className="onboarding-actions">
          <span className="onboarding-actions-note">{t('onboarding.laterHint')}</span>
          {detected && selectableCount > 0 && selected.length > 0 ? (
            <button
              className="btn btn-primary"
              disabled={importing}
              onClick={() => void importSelected()}
            >
              <Icon name={importing ? 'loader' : 'download'} size={14} />
              {importing
                ? t('onboarding.importing', importProgress)
                : t('onboarding.importSelected', { count: selected.length })}
            </button>
          ) : null}
          <button className="btn" onClick={() => void finish(() => navigate('/'))}>
            {t('onboarding.enter')}
          </button>
        </div>
      </div>
    </div>
  )
}
