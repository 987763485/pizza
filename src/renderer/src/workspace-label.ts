import type { TFunction } from 'i18next'
import type { Workspace } from '@shared/types'

/** 默认工作区使用本地化显示名，其他工作区沿用目录名。 */
export function workspaceLabel(
  workspace: Pick<Workspace, 'name' | 'isDefault'> | null | undefined,
  t: TFunction,
): string {
  if (!workspace) return t('ui.工作区')
  return workspace.isDefault ? t('ui.默认工作区') : workspace.name
}
