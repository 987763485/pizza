import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AttachmentInput, TeamParticipant } from '@shared/types'
import { serializeMention } from '@shared/mentions'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

interface ComposerProps {
  agentName: string
  workspaceName: string
  running?: boolean
  disabled?: boolean
  autoFocus?: boolean
  participants?: TeamParticipant[]
  onSend: (content: string, attachments: AttachmentInput[]) => Promise<void> | void
  onStop?: () => void
  onQueueHint?: () => void
}

const MAX_BYTES = 20 * 1024 * 1024

// 会话输入区严格沿用原型结构：发送对象行、排队模式、附件、
// 工具栏与工作区快捷入口；停止按钮复用同一个发送键。
export function Composer({
  agentName,
  workspaceName,
  running,
  disabled,
  autoFocus,
  participants = [],
  onSend,
  onStop,
  onQueueHint,
}: ComposerProps) {
  const { t } = useTranslation()
  const isTeam = participants.length > 0
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<AttachmentInput[]>([])
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [interjectionNotice, setInterjectionNotice] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)

  function readEditor(): string {
    const editor = editorRef.current
    if (!editor) return ''
    let output = ''
    for (const node of Array.from(editor.childNodes)) {
      if (node instanceof HTMLElement && node.dataset.mention) {
        output += node.dataset.mention
      } else if (node.nodeName === 'BR') {
        output += '\n'
      } else {
        output += node.textContent ?? ''
      }
    }
    return output
  }

  function insertMention(serialized: string, label: string) {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    const selection = window.getSelection()
    const chip = document.createElement('span')
    chip.className = 'mention-chip'
    chip.contentEditable = 'false'
    chip.dataset.mention = serialized
    chip.textContent = `@${label}`

    if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0)
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        const content = range.startContainer.textContent ?? ''
        if (content.slice(0, range.startOffset).endsWith('@')) {
          range.setStart(range.startContainer, range.startOffset - 1)
          range.deleteContents()
        }
      }
      range.insertNode(chip)
      const space = document.createTextNode(' ')
      chip.after(space)
      range.setStartAfter(space)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    } else {
      editor.append(chip, document.createTextNode(' '))
    }
    setText(readEditor())
    setMentionOpen(false)
  }

  useEffect(() => {
    const quote = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      if (!detail) return
      if (isTeam) {
        const editor = editorRef.current
        if (editor) {
          editor.append(document.createTextNode(`> ${detail.replace(/\n/g, '\n> ')}\n\n`))
          setText(readEditor())
          requestAnimationFrame(() => editor.focus())
        }
        return
      }
      setText((current) => `${current}${current ? '\n\n' : ''}> ${detail.replace(/\n/g, '\n> ')}\n\n`)
      requestAnimationFrame(() => textRef.current?.focus())
    }
    window.addEventListener('pizza:quote', quote)
    return () => window.removeEventListener('pizza:quote', quote)
  }, [isTeam])

  useEffect(() => {
    const element = textRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`
  }, [text])

  async function addFiles(files: FileList | File[]) {
    setError(null)
    const next: AttachmentInput[] = []
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        setError(t('ui.「{{name}}」超过 20 MB，未添加', { name: file.name }))
        continue
      }
      const buffer = await file.arrayBuffer()
      next.push({
        name: file.name,
        mime: file.type || 'application/octet-stream',
        data: new Uint8Array(buffer),
      })
    }
    if (next.length) setAttachments((current) => [...current, ...next])
  }

  async function submit() {
    const content = text.trim()
    if (!content || disabled) return
    try {
      await onSend(content, attachments)
      setText('')
      setAttachments([])
      setError(null)
      if (editorRef.current) editorRef.current.innerHTML = ''
      textRef.current?.focus()
    } catch {
      // 发送失败时保留草稿和附件，让用户可以直接重试。
    }
  }

  return (
    <div className="composer-wrap">
      <div
        className={`composer ${dragging ? 'dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files)
        }}
      >
        <div className="composer-route">
          <Icon name="at" size={12} /> {t('ui.发送给')} <strong>@{agentName}</strong>
          {isTeam ? <span className="badge" style={{ height: 17, fontSize: 9 }}>{t('ui.团队')}</span> : null}
          <span className="route-mode">
            <button
              className="route-mode-btn active"
              onClick={() => {
                setInterjectionNotice(null)
                onQueueHint?.()
              }}
            >
              {t('ui.排队')}
            </button>
            <button
              className="route-mode-btn"
              onClick={() => {
                setInterjectionNotice(
                  t('ui.当前运行时未声明追加输入能力，已自动降级为排队；消息会在当前运行结束后送达。'),
                )
                onQueueHint?.()
              }}
              title={t('ui.立即插话需要运行时支持；不支持时会降级为排队')}
            >
              {t('ui.插话')}
            </button>
          </span>
        </div>

        {interjectionNotice ? (
          <div className="composer-notice">
            <Icon name="alert" size={12} /> {interjectionNotice}
          </div>
        ) : null}

        {attachments.length ? (
          <div className="composer-chips">
            {attachments.map((attachment, index) => (
              <span className="composer-chip" key={`${attachment.name}-${index}`}>
                <Icon name="file" size={11} />
                {attachment.name}
                <button
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  aria-label={t('ui.移除 {{name}}', { name: attachment.name })}
                >
                  <Icon name="x" size={10} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {isTeam ? (
          <div className="mention-editor-wrap" style={{ position: 'relative' }}>
            <div
              ref={editorRef}
              className="mention-editor"
              contentEditable={!disabled}
              suppressContentEditableWarning
              data-placeholder={t('chat.placeholder')}
              autoFocus={autoFocus}
              onInput={() => {
                const next = readEditor()
                setText(next)
                setMentionOpen(next.trimEnd().endsWith('@'))
              }}
              onPaste={(event) => {
                if (event.clipboardData.files.length) {
                  event.preventDefault()
                  void addFiles(event.clipboardData.files)
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit()
                }
                if (event.key === 'Escape') setMentionOpen(false)
              }}
            />
            {mentionOpen ? (
              <div className="mention-picker" role="listbox" aria-label={t('ui.选择提及对象')}>
                {participants.map((participant) => (
                  <button
                    type="button"
                    className="pm-item"
                    role="option"
                    key={participant.agent.id}
                    onClick={() =>
                      insertMention(
                        serializeMention(participant.agent),
                        participant.agent.name,
                      )
                    }
                  >
                    <Avatar
                      name={participant.agent.name}
                      src={participant.agent.avatar}
                      size={24}
                    />
                    <span className="pm-name">{participant.agent.name}</span>
                    {participant.role === 'leader' ? (
                      <span className="pm-role leader">{t('ui.指挥者')}</span>
                    ) : participant.roleDescription ? (
                      <span className="pm-role">{participant.roleDescription}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <textarea
            ref={textRef}
            autoFocus={autoFocus}
            rows={1}
            value={text}
            placeholder={t('chat.placeholder')}
            onChange={(event) => setText(event.target.value)}
            onPaste={(event) => {
              if (event.clipboardData.files.length) {
                void addFiles(event.clipboardData.files)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
          />
        )}

        {error ? <div className="composer-error">{error}</div> : null}

        <div className="composer-toolbar">
          <button
            className="tool-btn"
            onClick={() => inputRef.current?.click()}
            aria-label={t('ui.添加附件')}
            title={t('ui.添加文件、Skill 或上下文')}
          >
            <Icon name="plus" size={17} />
          </button>
          <button
            className="tool-btn"
            onClick={() => {
              if (isTeam) {
                editorRef.current?.focus()
                setMentionOpen((open) => !open)
                return
              }
              setText((current) => `${current}@`)
              textRef.current?.focus()
            }}
            aria-label={t('ui.@ 指定成员')}
            title={t('ui.@ 指定成员')}
          >
            <Icon name="at" size={17} />
          </button>
          <button
            className="tool-btn"
            onClick={() => {
              if (isTeam) {
                const editor = editorRef.current
                if (editor) {
                  editor.append(document.createTextNode('/'))
                  setText(readEditor())
                  editor.focus()
                }
                return
              }
              setText((current) => `${current}/`)
              textRef.current?.focus()
            }}
            aria-label={t('ui./ 引用 Skill')}
            title={t('ui./ 引用 Skill')}
          >
            <Icon name="slash" size={17} />
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept="image/*,.txt,.md,.json,.ts,.tsx,.js,.jsx,.css,.html,.py,.go,.rs,.yaml,.yml,.toml,.csv,.pdf"
            onChange={(event) => {
              if (event.target.files) void addFiles(event.target.files)
              event.target.value = ''
            }}
          />
          <span className="workspace-chip" title={t('ui.当前工作区')}>
            <Icon name="folder" size={14} />
            <span className="workspace-chip-name">{workspaceName}</span>
          </span>
          <span className="composer-spacer" />
          {running && onStop ? (
            <button className="send-btn stop" onClick={onStop} title={t('ui.停止')} aria-label={t('ui.停止运行')}>
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={() => void submit()}
              title={t('ui.发送')}
              aria-label={t('ui.发送')}
            >
              <Icon name="arrow-up" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
