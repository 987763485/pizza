# mcp-management Specification

## Purpose
定义 MCP Server 如何被配置、测试、发现工具、挂载到智能体或团队成员，并在不泄露凭据的前提下注入运行时。

## Requirements

### Requirement: MCP Server 列表

本要求为强制要求（MUST）。

设置中的 MCP 列表必须展示名称、传输方式、状态、工具数和被引用次数，并支持启用、禁用和搜索。未通过连接测试的 Server 必须显示为未就绪。

#### Scenario: 禁用 MCP Server

- **WHEN** 用户禁用一个已挂载的 MCP Server
- **THEN** 列表状态变为已禁用
- **AND** 后续运行不再注入该 Server

### Requirement: stdio 配置

本要求为强制要求（MUST）。

用户必须能够创建 stdio MCP Server，填写命令、参数、环境变量和工作目录。环境变量值必须加密存储并以掩码展示；支持引用系统环境变量而不复制其明文。

#### Scenario: 保存 stdio 配置

- **WHEN** 用户填写命令、参数和一个密钥环境变量并保存
- **THEN** Server 记录保存成功且密钥字段显示为掩码
- **AND** 重启应用后仍可连接

#### Scenario: 缺少命令

- **WHEN** 用户未填写 stdio 启动命令
- **THEN** 表单阻止保存并说明必填项
- **AND** 不创建 Server 记录

### Requirement: SSE 与 HTTP 配置

本要求为强制要求（MUST）。

用户必须能够创建 SSE 或 HTTP MCP Server，填写 URL、Header 和超时。Header 中的密钥必须掩码显示，日志不得输出完整值。

#### Scenario: 保存 HTTP Header

- **WHEN** 用户添加一个包含 Authorization 的 Header
- **THEN** 列表和编辑页只显示掩码
- **AND** 连接测试可以使用原始值但日志不记录它

### Requirement: 连接测试与工具发现

本要求为强制要求（MUST）。

连接测试必须尝试建立连接并列出可用工具的名称、描述和参数 schema。失败时必须展示连接阶段、错误摘要和可操作建议，不得把失败显示为「无工具」。

#### Scenario: 测试成功

- **WHEN** 用户对有效 MCP Server 点击测试连接
- **THEN** 界面显示连接状态和工具清单
- **AND** 每个工具显示参数 schema

#### Scenario: 测试失败

- **WHEN** MCP Server 拒绝连接或超时
- **THEN** 界面显示失败阶段和脱敏错误
- **AND** Server 保持未就绪状态

### Requirement: 挂载与工具白名单

本要求为强制要求（MUST）。

用户必须能够把 MCP Server 挂载到智能体或团队成员，并按工具配置允许或拒绝。保存前必须预览最终工具清单；未挂载的工具不得出现在运行中。

#### Scenario: 限制工具

- **WHEN** 用户只允许某个 Server 的两个工具
- **THEN** 运行上下文只包含这两个工具
- **AND** 其他工具调用被拒绝并记录

### Requirement: 三层配置合并

本要求为强制要求（MUST）。

MCP 配置必须按「智能体自有 > 工作区库绑定 > 运行时本地配置」合并，并在智能体页展示最终结果。被覆盖项必须标注来源，冲突必须解释。

#### Scenario: 智能体覆盖工作区配置

- **WHEN** 智能体自有配置与工作区绑定同名 Server
- **THEN** 预览显示智能体配置生效
- **AND** 被覆盖的工作区项标注为已覆盖

### Requirement: 运行时注入

本要求为强制要求（MUST）。

运行开始前，系统必须把生效 MCP Server 转换为 ACP `mcpServers` 或运行时原生配置。注入失败时必须阻止运行或明确标记该 Server 不可用，不得静默跳过。

#### Scenario: 注入 ACP 配置

- **WHEN** 绑定的运行时支持 ACP MCP 配置
- **THEN** 运行请求包含生效 Server 列表
- **AND** 运行上下文中可以查看工具来源

#### Scenario: 注入失败

- **WHEN** 某个 MCP Server 配置无法转换或启动
- **THEN** 运行显示该 Server 不可用
- **AND** 其他有效 Server 不被误删

### Requirement: 只写配置保护

本要求为强制要求（MUST）。

MCP 配置保存后不得回显 URL、Header 或环境变量明文；修改必须整体替换配置。读取和修改操作必须写入审计，敏感值不得进入日志或导出。

#### Scenario: 查看已保存配置

- **WHEN** 用户重新打开一个已保存的 MCP Server
- **THEN** 敏感字段只显示掩码和是否已设置
- **AND** 不提供显示明文的操作

#### Scenario: 替换配置

- **WHEN** 用户选择替换配置
- **THEN** 应用要求重新输入完整敏感字段
- **AND** 旧值不会与新值混合保存
