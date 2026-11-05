export const BUILTIN_SKILL_NAME = 'pizza-collaboration'

/**
 * 内置协作 Skill 只读随应用发布，不写入用户可编辑的 Skill 目录。
 * 物化时按需写入运行级临时目录，用户可在本次运行中禁用。
 */
export const BUILTIN_SKILL_CONTENT = `---
name: pizza-collaboration
description: Pizza 的团队协作约定：提及、交接、等待用户与收敛结果的统一写法。
version: 1.0.0
---

# Pizza 协作 Skill

在 Pizza 团队会话中，你与其他智能体按以下约定协作：

1. 需要某位成员处理任务时，用 \`[@名称](mention://agent/成员ID)\` 精确提及。
2. 把问题拆成可独立完成的片段，避免重复劳动；交接时写清目标、输入和完成标准。
3. 需要用户决定时，明确说明待决定的选项和影响，不要替用户做安全或范围决定。
4. 收敛时输出结构化结论：结论、关键依据、分歧与未决、建议下一步。
5. 不伪造数据、不声称执行了未执行的操作；无法验证时如实说明。
`
