import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../store'
import { Avatar } from './Avatar'
import { Icon, type IconName } from './Icon'

interface CommandPaletteProps {
  onClose: () => void
}

interface PaletteItem {
  id: string
  kind: 'command' | 'session'
  title: string
  hint?: string
  icon?: IconName
  target?: string
  agentName?: string | null
  agentAvatar?: string | null
  snippet?: string | null
}

// 把命中词包进 mark，结果列表不用打开会话也能判断为什么命中。
function highlightedSnippet(snippet: string, query: string) {
  const normalized = query.trim()
  if (!normalized) return snippet
  const index = snippet.toLowerCase().indexOf(normalized.toLowerCase())
  if (index < 0) return snippet
  return (
    <>
      {snippet.slice(0, index)}
      <mark>{snippet.slice(index, index + normalized.length)}</mark>
      {snippet.slice(index + normalized.length)}
    </>
  )
}

// 命令面板同时承担全局搜索与会话跳转，对应原型标题栏的搜索按钮。
export function CommandPalette({ onClose }: CommandPaletteProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const sessionsByWorkspace = useAppStore((state) => state.sessionsByWorkspace)
  const searchResults = useAppStore((state) => state.searchResults)
  const searchHitMessageIds = useAppStore((state) => state.searchHitMessageIds)
  const searchSnippets = useAppStore((state) => state.searchSnippets)
  const search = useAppStore((state) => state.search)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // 会话搜索走主进程的 SQLite/FTS，可命中标题、消息内容和智能体名称；
  // 输入防抖，避免每次按键都发起 IPC。
  useEffect(() => {
    const timer = setTimeout(() => {
      void search(query)
    }, 180)
    return () => clearTimeout(timer)
  }, [query, search])

  const items = useMemo<PaletteItem[]>(() => {
    const commands: PaletteItem[] = [
      {
        id: 'new-chat',
        kind: 'command',
        title: t('ui.新建对话'),
        hint: '⌘N',
        icon: 'plus',
        target: '/',
      },
      {
        id: 'agents',
        kind: 'command',
        title: t('ui.打开智能体设置'),
        hint: 'G A',
        icon: 'cpu',
        target: '/settings/agents',
      },
      {
        id: 'runtimes',
        kind: 'command',
        title: t('ui.打开运行时设置'),
        hint: 'G R',
        icon: 'box',
        target: '/settings/runtimes',
      },
      {
        id: 'appearance',
        kind: 'command',
        title: t('settings.nav.appearance'),
        hint: 'G T',
        icon: 'sun',
        target: '/settings/appearance',
      },
    ]
    const normalized = query.trim().toLowerCase()
    const source = normalized
      ? searchResults
      : Object.values(sessionsByWorkspace)
          .flat()
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const sessions = source.map<PaletteItem>((session) => ({
      id: session.id,
      kind: 'session',
      title: session.title,
      target: `/session/${session.id}${
        searchHitMessageIds[session.id]
          ? `?message=${encodeURIComponent(searchHitMessageIds[session.id])}`
          : ''
      }`,
      agentName: session.agentName,
      agentAvatar: session.agentAvatar,
      snippet: searchSnippets[session.id] ?? null,
    }))
    if (!normalized) return [...commands, ...sessions]
    return [
      ...commands.filter((item) =>
        `${item.title} ${item.agentName ?? ''}`.toLowerCase().includes(normalized),
      ),
      ...sessions,
    ]
  }, [query, searchHitMessageIds, searchResults, searchSnippets, sessionsByWorkspace, t])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (selected >= items.length) setSelected(Math.max(0, items.length - 1))
  }, [items.length, selected])

  function execute(item: PaletteItem | undefined) {
    if (!item?.target) return
    navigate(item.target)
    onClose()
  }

  const commandItems = items.filter((item) => item.kind === 'command')
  const sessionItems = items.filter((item) => item.kind === 'session')
  let index = 0

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label={t('ui.搜索与命令')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <Icon name="search" size={19} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onClose()
                return
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelected((current) => Math.min(items.length - 1, current + 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelected((current) => Math.max(0, current - 1))
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                execute(items[selected])
              }
            }}
            placeholder={t('commandPalette.placeholder')}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="palette-esc">Esc</span>
        </div>
        <div className="palette-list">
          {items.length === 0 ? (
            <div className="picker-empty">{t('ui.没有匹配项')}</div>
          ) : null}
          {commandItems.length ? (
            <div className="palette-group">{t('ui.新建')}</div>
          ) : null}
          {commandItems.map((item) => {
            const itemIndex = index++
            return (
              <button
                className={`palette-item ${itemIndex === selected ? 'active' : ''}`}
                key={item.id}
                onMouseEnter={() => setSelected(itemIndex)}
                onClick={() => execute(item)}
                role="option"
                aria-selected={itemIndex === selected}
              >
                <span className="palette-icon">
                  <Icon name={item.icon ?? 'command'} size={15} />
                </span>
                <span className="palette-title">{item.title}</span>
                {item.hint ? <span className="palette-kbd">{item.hint}</span> : null}
              </button>
            )
          })}
          {sessionItems.length ? (
            <div className="palette-group">{t('ui.最近')}</div>
          ) : null}
          {sessionItems.map((item) => {
            const itemIndex = index++
            return (
              <button
                className={`palette-item ${itemIndex === selected ? 'active' : ''}`}
                key={item.id}
                onMouseEnter={() => setSelected(itemIndex)}
                onClick={() => execute(item)}
                role="option"
                aria-selected={itemIndex === selected}
              >
                <Avatar
                  name={item.agentName ?? 'Conversation'}
                  src={item.agentAvatar}
                  size={26}
                />
                <span className="palette-title">{item.title}</span>
                <span
                  className="palette-label palette-snippet"
                  title={item.snippet ?? undefined}
                >
                  {item.snippet && query.trim()
                    ? highlightedSnippet(item.snippet, query)
                    : (item.agentName ?? t('ui.会话'))}
                </span>
              </button>
            )
          })}
        </div>
        <div className="palette-foot">
          <span className="pf">
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t('ui.选择')}
          </span>
          <span className="pf">
            <kbd>↵</kbd> {t('ui.执行')}
          </span>
          <span className="pf">
            <kbd>⌘</kbd>
            <kbd>↵</kbd> {t('ui.在新标签页打开')}
          </span>
          <span className="pf-right">
            <span className="pf">
              <kbd>&gt;</kbd> {t('ui.命令')}
            </span>
            <span className="pf">
              <kbd>#</kbd> {t('ui.会话')}
            </span>
            <span className="pf">
              <kbd>@</kbd> {t('ui.智能体')}
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
