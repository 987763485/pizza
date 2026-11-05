import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  Agent,
  Skill,
  SkillConflictStrategy,
  SkillDetail,
} from '@shared/types'
import { useAppStore } from '../store'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { localizeError } from '../locales/errors'

const SOURCE_LABEL: Record<Skill['sourceType'], string> = {
  builtin: '内置',
  local: '本地',
  zip: 'ZIP',
  git: 'Git',
  manual: '手动创建',
}

interface ImportForm {
  sourceType: 'local' | 'zip' | 'git'
  sourcePath: string
  gitUrl: string
  tags: string
  conflict: SkillConflictStrategy
  enabled: boolean
}

const EMPTY_IMPORT: ImportForm = {
  sourceType: 'local',
  sourcePath: '',
  gitUrl: '',
  tags: '',
  conflict: 'stop',
  enabled: true,
}

export function SkillSettings() {
  const { t } = useTranslation()
  const workspaceId = useAppStore((state) => state.currentWorkspaceId)
  const agents = useAppStore((state) => state.agents)
  const [skills, setSkills] = useState<Skill[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SkillDetail | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SkillDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    if (!workspaceId) return
    try {
      setSkills(await window.pizza.skill.list(workspaceId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return skills
    return skills.filter((skill) =>
      `${skill.name} ${skill.description} ${skill.tags.join(' ')}`
        .toLowerCase()
        .includes(keyword),
    )
  }, [query, skills])

  async function openDetail(skill: Skill) {
    try {
      setSelected(await window.pizza.skill.get(skill.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function toggle(skill: Skill) {
    try {
      await window.pizza.skill.update(skill.id, { enabled: !skill.enabled })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function remove(skill: SkillDetail) {
    try {
      // 删除前明确解除所有绑定，避免静默破坏智能体或团队成员配置。
      for (const reference of skill.references) {
        await window.pizza.skill.removeBinding({
          skillId: skill.id,
          scopeType: reference.scopeType,
          scopeId: reference.scopeId,
        })
      }
      await window.pizza.skill.remove(skill.id)
      setDeleteTarget(null)
      setSelected(null)
      await refresh()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.replace('SKILL_IN_USE', t('ui.该 Skill 仍被引用，请先解除绑定：'))
          : String(cause),
      )
    }
  }

  return (
    <>
      <h1 className="settings-title">{t('skills.title')}</h1>
      <p className="settings-sub">{t('skills.sub')}</p>
      <div className="toolbar">
        <input
          className="input"
          style={{ width: 260 }}
          placeholder={t('skills.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setImportOpen(true)}>
          <Icon name="download" size={14} /> {t('skills.import')}
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-card">
          {filtered.length === 0 ? (
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-title">
                  {skills.length === 0 ? t('skills.empty') : t('skills.empty')}
                </div>
                <div className="settings-row-desc">{t('skills.emptyHint')}</div>
              </div>
            </div>
          ) : (
            filtered.map((skill) => (
              <div className="settings-row" key={skill.id}>
                <div className="settings-row-text">
                  <div className="settings-row-title">
                    {skill.name}
                    <span className="badge" style={{ marginLeft: 8 }}>
                      v{skill.version}
                    </span>
                    <span className="badge" style={{ marginLeft: 6 }}>
                      {t(`ui.${SOURCE_LABEL[skill.sourceType]}`)}
                    </span>
                  </div>
                  <div className="settings-row-desc">{skill.description}</div>
                </div>
                <div className="settings-row-control">
                  <span className="settings-row-desc">{t('ui.{{count}} 个文件', { count: skill.fileCount })}</span>
                  <button
                    className={`switch ${skill.enabled ? 'on' : ''}`}
                    onClick={() => void toggle(skill)}
                    aria-label={skill.enabled ? t('ui.停用 Skill') : t('ui.启用 Skill')}
                  />
                  <button className="btn btn-sm" onClick={() => void openDetail(skill)}>
                    {t('ui.详情')}
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={skill.builtin}
                    onClick={() => {
                      void window.pizza.skill
                        .get(skill.id)
                        .then((detail) => setDeleteTarget(detail))
                        .catch((cause: unknown) =>
                          setError(
                            cause instanceof Error ? cause.message : String(cause),
                          ),
                        )
                    }}
                  >
                    {t('ui.删除')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {error ? (
        <div className="inline-error" role="alert">
          {localizeError(error)}
          <button className="icon-btn" onClick={() => setError(null)} aria-label={t('ui.关闭')}>
            <Icon name="x" size={12} />
          </button>
        </div>
      ) : null}

      {selected ? (
        <SkillDetailModal
          skill={selected}
          agents={agents}
          onClose={() => setSelected(null)}
          onChanged={() => {
            void openDetail(selected)
            void refresh()
          }}
        />
      ) : null}

      {importOpen ? (
        <ImportSkillModal
          busy={busy}
          onClose={() => setImportOpen(false)}
          onSubmit={async (form) => {
            if (!workspaceId) return
            setBusy(true)
            try {
              await window.pizza.skill.import({
                workspaceId,
                sourceType: form.sourceType,
                sourcePath: form.sourceType === 'git' ? undefined : form.sourcePath,
                gitUrl: form.sourceType === 'git' ? form.gitUrl : undefined,
                tags: form.tags
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean),
                conflict: form.conflict,
                enabled: form.enabled,
              })
              setImportOpen(false)
              await refresh()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause))
            } finally {
              setBusy(false)
            }
          }}
        />
      ) : null}

      {deleteTarget ? (
        <Modal
          title={t('ui.删除 Skill')}
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleteTarget(null)}>
                {t('ui.取消')}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => void remove(deleteTarget)}
              >
                {deleteTarget.references.length > 0
                  ? t('ui.解除绑定并删除')
                  : t('ui.删除')}
              </button>
            </>
          }
        >
          <p className="modal-copy">
            {t('ui.删除「{{name}}」会移除本地文件与元数据。', { name: deleteTarget.name })}
          </p>
          {deleteTarget.references.length > 0 ? (
            <>
              <p className="modal-copy">
                {t('ui.以下智能体或团队成员正在使用它，删除前会先解除绑定：')}
              </p>
              <ul className="modal-list">
                {deleteTarget.references.map((reference) => (
                  <li key={`${reference.scopeType}:${reference.scopeId}`}>
                    {reference.name}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Modal>
      ) : null}
    </>
  )
}

function ImportSkillModal({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean
  onClose: () => void
  onSubmit: (form: ImportForm) => Promise<void>
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<ImportForm>(EMPTY_IMPORT)

  async function pick() {
    const path =
      form.sourceType === 'zip'
        ? await window.pizza.dialog.pickFile(['zip'])
        : await window.pizza.dialog.pickDirectory()
    if (path) setForm((current) => ({ ...current, sourcePath: path }))
  }

  const disabled =
    busy ||
    (form.sourceType === 'git' ? !form.gitUrl.trim() : !form.sourcePath.trim())

  return (
    <Modal
      title={t('ui.导入 Skill')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('ui.取消')}
          </button>
          <button
            className="btn btn-primary"
            disabled={disabled}
            onClick={() => void onSubmit(form)}
          >
            {t('ui.开始导入')}
          </button>
        </>
      }
    >
      <div className="form-row">
        <div className="field-label">{t('ui.来源')}</div>
        <div className="segmented">
          {(
            [
              ['local', '文件夹'],
              ['zip', 'ZIP'],
              ['git', 'Git URL'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={form.sourceType === value ? 'active' : ''}
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  sourceType: value,
                  sourcePath: '',
                }))
              }
            >
              {t(`ui.${label}`)}
            </button>
          ))}
        </div>
      </div>
      {form.sourceType === 'git' ? (
        <div className="form-row">
          <div className="field-label">{t('ui.仓库地址')}</div>
          <input
            className="input"
            placeholder="https://github.com/org/skill.git"
            value={form.gitUrl}
            onChange={(event) =>
              setForm((current) => ({ ...current, gitUrl: event.target.value }))
            }
          />
        </div>
      ) : (
        <div className="form-row">
          <div className="field-label">
            {form.sourceType === 'zip' ? t('ui.ZIP 文件') : t('ui.Skill 目录')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              readOnly
              placeholder={t('ui.选择本机路径')}
              value={form.sourcePath}
            />
            <button className="btn" onClick={() => void pick()}>
              {t('ui.选择…')}
            </button>
          </div>
        </div>
      )}
      <div className="form-row">
        <div className="field-label">{t('ui.标签')}</div>
        <input
          className="input"
          placeholder={t('ui.用逗号分隔，例如：写作, 评审')}
          value={form.tags}
          onChange={(event) =>
            setForm((current) => ({ ...current, tags: event.target.value }))
          }
        />
      </div>
      <div className="form-row">
        <div className="field-label">{t('ui.同名冲突')}</div>
        <select
          className="select"
          value={form.conflict}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              conflict: event.target.value as SkillConflictStrategy,
            }))
          }
        >
          <option value="stop">{t('ui.停止导入')}</option>
          <option value="overwrite">{t('ui.覆盖并保留绑定')}</option>
          <option value="rename">{t('ui.保留两份')}</option>
          <option value="skip">{t('ui.跳过')}</option>
        </select>
      </div>
      <div className="form-row">
        <div className="field-label">{t('ui.导入后启用')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className={`switch ${form.enabled ? 'on' : ''}`}
            role="switch"
            aria-checked={form.enabled}
            aria-label={t('ui.导入后启用')}
            onClick={() =>
              setForm((current) => ({ ...current, enabled: !current.enabled }))
            }
          />
          <span className="field-help" style={{ margin: 0 }}>
            {t('ui.关闭后保持停用，可稍后手动启用。')}
          </span>
        </div>
      </div>
      <p className="field-help">
        {t('ui.导入前会校验 SKILL.md、文件清单和路径；拒绝越界路径与符号链接。')}
      </p>
    </Modal>
  )
}


function SkillDetailModal({
  skill,
  agents,
  onClose,
  onChanged,
}: {
  skill: SkillDetail
  agents: Agent[]
  onClose: () => void
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const workspaceId = useAppStore((state) => state.currentWorkspaceId)
  const [file, setFile] = useState(skill.files[0] ?? 'SKILL.md')
  const [content, setContent] = useState('')
  const [boundAgents, setBoundAgents] = useState<Set<string>>(new Set())
  const [memberRows, setMemberRows] = useState<
    Array<{ memberId: string; label: string; bound: boolean }>
  >([])
  const [preview, setPreview] = useState<string | null>(null)
  const [name, setName] = useState(skill.name)
  const [description, setDescription] = useState(skill.description)
  const teams = useAppStore((state) => state.teams)

  useEffect(() => {
    void window.pizza.skill
      .readFile(skill.id, file)
      .then((result) => setContent(result.content))
      .catch((error: unknown) =>
        setContent(error instanceof Error ? error.message : String(error)),
      )
  }, [skill.id, file])

  useEffect(() => {
    void Promise.all(
      agents.map(async (agent) => {
        const bindings = await window.pizza.skill.bindings('agent', agent.id)
        return bindings.some((binding) => binding.targetId === skill.id)
          ? agent.id
          : null
      }),
    ).then((ids) => setBoundAgents(new Set(ids.filter(Boolean) as string[])))
  }, [agents, skill.id])

  useEffect(() => {
    void Promise.all(
      teams.map(async (team) => {
        const detail = await window.pizza.team.get(team.id)
        const rows = await Promise.all(
          detail.members.map(async (member) => {
            const agent = agents.find((item) => item.id === member.agentId)
            const bindings = await window.pizza.skill.bindings(
              'team_member',
              member.id,
            )
            return {
              memberId: member.id,
              label: `${detail.name} · ${agent?.name ?? member.agentId}`,
              bound: bindings.some((binding) => binding.targetId === skill.id),
            }
          }),
        )
        return rows
      }),
    ).then((groups) => setMemberRows(groups.flat()))
  }, [agents, teams, skill.id])

  async function toggleMember(memberId: string, bound: boolean) {
    try {
      // 团队成员取消挂载时写入 enabled=false，才能压住从工作区/智能体继承的 Skill。
      await window.pizza.skill.setBinding({
        skillId: skill.id,
        scopeType: 'team_member',
        scopeId: memberId,
        enabled: !bound,
      })
      setMemberRows((rows) =>
        rows.map((row) =>
          row.memberId === memberId ? { ...row, bound: !bound } : row,
        ),
      )
      onChanged()
    } catch {
      // 列表页会展示具体错误。
    }
  }

  async function saveBasics() {
    try {
      await window.pizza.skill.update(skill.id, {
        name: name.trim(),
        description: description.trim(),
      })
      onChanged()
    } catch {
      // 列表页会展示具体错误。
    }
  }

  async function toggleAgent(agent: Agent, bound: boolean) {
    try {
      if (bound) {
        await window.pizza.skill.removeBinding({
          skillId: skill.id,
          scopeType: 'agent',
          scopeId: agent.id,
        })
      } else {
        await window.pizza.skill.setBinding({
          skillId: skill.id,
          scopeType: 'agent',
          scopeId: agent.id,
        })
      }
      setBoundAgents((current) => {
        const next = new Set(current)
        if (bound) next.delete(agent.id)
        else next.add(agent.id)
        return next
      })
      if (workspaceId) {
        setPreview(null)
      }
      onChanged()
    } catch {
      // 错误由列表页统一展示。
    }
  }

  return (
    <Modal
      title={`Skill · ${skill.name}`}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          {t('ui.关闭')}
        </button>
      }
      width={760}
    >
      {skill.builtin ? null : (
        <div className="settings-section">
          <div className="settings-section-title">{t('ui.基本信息')}</div>
          <div className="settings-card" style={{ padding: 12 }}>
            <div className="form-row">
              <div className="field-label">{t('ui.名称')}</div>
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="form-row">
              <div className="field-label">{t('ui.描述')}</div>
              <input
                className="input"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <button
              className="btn btn-sm"
              disabled={
                !name.trim() ||
                (name === skill.name && description === skill.description)
              }
              onClick={() => void saveBasics()}
            >
              {t('ui.保存基本信息')}
            </button>
          </div>
        </div>
      )}
      <div className="skill-detail">
        <div className="skill-detail-files">
          <div className="settings-row-desc">{t('ui.文件')}</div>
          {skill.files.map((item) => (
            <button
              key={item}
              className={`palette-item ${file === item ? 'active' : ''}`}
              onClick={() => setFile(item)}
            >
              <Icon name="file" size={13} /> {item}
            </button>
          ))}
        </div>
        <div className="skill-detail-content">
          <pre className="code-preview">{content}</pre>
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-title">{t('ui.绑定智能体')}</div>
        <div className="settings-card">
          {agents.length === 0 ? (
            <div className="settings-row">
              <div className="settings-row-desc">{t('ui.还没有可绑定的智能体。')}</div>
            </div>
          ) : (
            agents.map((agent) => {
              const bound = boundAgents.has(agent.id)
              return (
                <div className="settings-row" key={agent.id}>
                  <div className="settings-row-text">
                    <div className="settings-row-title">{agent.name}</div>
                    <div className="settings-row-desc">{agent.description || t('ui.未填写描述')}</div>
                  </div>
                  <div className="settings-row-control">
                    <button
                      className={`switch ${bound ? 'on' : ''}`}
                      onClick={() => void toggleAgent(agent, bound)}
                      aria-label={`${bound ? t('ui.解绑') : t('ui.绑定')} ${agent.name}`}
                    />
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-title">{t('ui.绑定团队成员')}</div>
        <div className="settings-card">
          {memberRows.length === 0 ? (
            <div className="settings-row">
              <div className="settings-row-desc">{t('ui.还没有团队成员可绑定。')}</div>
            </div>
          ) : (
            memberRows.map((row) => (
              <div className="settings-row" key={row.memberId}>
                <div className="settings-row-text">
                  <div className="settings-row-title">{row.label}</div>
                  <div className="settings-row-desc">
                    {t('ui.团队成员级绑定优先于智能体与工作区默认。')}
                  </div>
                </div>
                <div className="settings-row-control">
                  <button
                    className={`switch ${row.bound ? 'on' : ''}`}
                    onClick={() => void toggleMember(row.memberId, row.bound)}
                    aria-label={`${row.bound ? t('ui.解绑') : t('ui.绑定')} ${row.label}`}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-title">{t('ui.最终注入清单')}</div>
        <div className="settings-card" style={{ padding: 12 }}>
          <button
            className="btn btn-sm"
            onClick={() => {
              const agent = agents[0]
              if (!agent || !workspaceId) return
              void window.pizza.skill
                .preview({ workspaceId, agentId: agent.id })
                .then((result) =>
                  setPreview(
                    result.skills
                      .map((item) => `${item.name} v${item.version} · ${item.path}`)
                      .join('\n') || t('ui.没有生效的 Skill'),
                  ),
                )
            }}
          >
            {t('ui.预览第一个智能体的生效清单')}
          </button>
          {preview ? <pre className="code-preview">{preview}</pre> : null}
        </div>
      </div>
    </Modal>
  )
}
