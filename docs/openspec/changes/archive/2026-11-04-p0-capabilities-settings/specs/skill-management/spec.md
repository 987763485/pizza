# Spec Delta

## Purpose

定义 Skill 如何被创建、导入、校验、挂载到智能体或团队成员，并在运行时安全物化，使用户能够复用能力包而不修改运行时安装目录。

## ADDED Requirements

### Requirement: Skill 列表与搜索

本要求为强制要求（MUST）。

设置中的 Skill 列表必须展示名称、描述、版本、来源、被引用次数和启用状态，并支持按名称搜索和按标签筛选。

#### Scenario: 搜索 Skill

- **WHEN** 用户在 Skill 搜索框输入名称片段
- **THEN** 列表只显示名称或描述匹配的 Skill
- **AND** 清空搜索后恢复完整列表

### Requirement: 创建与 frontmatter 校验

本要求为强制要求（MUST）。

用户必须能够创建包含 `SKILL.md` 和资源文件的 Skill。保存前必须校验 frontmatter 的必填字段；缺少名称、描述或版本时不得保存，并定位到具体字段。

#### Scenario: frontmatter 缺少名称

- **WHEN** 用户保存一个 `SKILL.md` 缺少名称字段的 Skill
- **THEN** 表单显示名称字段错误
- **AND** Skill 不被保存

### Requirement: 从本地目录、ZIP 和 Git 导入

本要求为强制要求（MUST）。

用户必须能够从本地文件夹、ZIP 或 Git 仓库导入 Skill。导入前必须展示文件清单、来源和冲突项；导入后必须保留来源信息，便于后续更新。

#### Scenario: 从 ZIP 导入

- **WHEN** 用户选择一个包含 `SKILL.md` 的 ZIP 文件
- **THEN** 应用展示文件清单和校验结果
- **AND** 用户确认后 Skill 出现在列表中

#### Scenario: 导入路径越界

- **WHEN** 导入包包含指向 Skill 目录之外的路径
- **THEN** 应用拒绝导入并说明越界文件
- **AND** 不写入任何文件到数据目录

### Requirement: 编辑与删除影响提示

本要求为强制要求（MUST）。

用户必须能够编辑和删除 Skill。删除前列出受影响的智能体和团队成员；被引用时必须要求用户确认或先解绑，不得静默破坏现有配置。

#### Scenario: 删除被引用的 Skill

- **WHEN** 用户删除一个被智能体挂载的 Skill
- **THEN** 应用展示受影响智能体列表
- **AND** 用户取消时不删除 Skill 或绑定

### Requirement: 挂载到智能体与团队成员

本要求为强制要求（MUST）。

用户必须能够把启用的 Skill 挂载到智能体或团队成员，并在保存前预览最终生效清单。团队成员级覆盖可以增加或移除 Skill；冲突时以团队覆盖为准。

#### Scenario: 预览生效清单

- **WHEN** 用户为团队成员增加一个 Skill 并移除另一个
- **THEN** 预览显示最终挂载清单
- **AND** 被移除项不再出现在运行上下文

### Requirement: 运行时物化

本要求为强制要求（MUST）。

运行开始前，系统必须把生效 Skill 物化到运行时能够读取的临时或工作目录，并把 Skill 名称和描述写入运行上下文。物化失败时必须给出可诊断错误，不得假装 Skill 已生效。

#### Scenario: 成功物化

- **WHEN** 一次运行挂载了两个有效 Skill
- **THEN** 运行时目录中存在对应 `SKILL.md` 和资源
- **AND** 运行上下文列出两个 Skill 的名称和描述

#### Scenario: 物化失败

- **WHEN** Skill 文件在运行前被删除或不可读
- **THEN** 运行标记为失败并指出缺失的 Skill
- **AND** 用户可以在设置中修复或解绑

### Requirement: 同名冲突处理

本要求为强制要求（MUST）。

导入或物化同名 Skill 时必须支持停止、覆盖、重命名和跳过四种策略。默认策略为停止；覆盖必须保留原标识和已有绑定，并把操作写入审计。

#### Scenario: 默认停止冲突

- **WHEN** 导入的 Skill 与已有 Skill 同名且用户未选择策略
- **THEN** 导入停止并展示冲突详情
- **AND** 已有 Skill 和绑定保持不变

#### Scenario: 覆盖同名 Skill

- **WHEN** 用户选择覆盖并确认
- **THEN** 新内容替换旧内容且保留原标识
- **AND** 已有智能体绑定继续指向该 Skill

### Requirement: 内置协作 Skill

本要求为强制要求（MUST）。

系统必须提供一个内置 Pizza 协作 Skill，说明 `@` 语法、团队角色和产出规范。所有智能体默认获得该 Skill；用户可以为单次注入禁用它，但不得删除其内置定义。

#### Scenario: 默认注入协作 Skill

- **WHEN** 用户创建一个新智能体并开始会话
- **THEN** 运行上下文包含 Pizza 协作 Skill
- **AND** 用户可以在设置中查看其内容

#### Scenario: 单次禁用

- **WHEN** 用户为某次运行禁用内置协作 Skill
- **THEN** 该次运行上下文不包含它
- **AND** 其他运行仍默认注入
