# 能力、审批与产品化设置

本文件记录 `p0-capabilities-settings` 的实现口径：数据模型、Skill/MCP 注入、审批协议、设置与通知、首次启动和打包。文档与代码不一致时以代码和测试为准，并更新本文件。

## 1. 数据模型（迁移 5）

| 表 | 用途 |
| --- | --- |
| `skill` | Skill 元数据、来源、版本、标签、启用状态、内容目录与文件清单 |
| `skill_binding` | Skill 到工作区 / 智能体 / 团队成员的绑定 |
| `mcp_server` | MCP 名称、传输、命令/URL、加密凭据、状态与工具快照 |
| `mcp_binding` | MCP 到作用域的绑定与工具允许/拒绝清单 |
| `approval` | 每次审批的工具名、参数摘要、风险、策略来源与结果 |
| `approval_policy` | `always_allow` 持久化策略（工作区默认或智能体级） |
| `notification` | 指向用户的提及通知、会话/消息定位与已读状态 |
| `app_setting` | 既有键值设置；迁移 5 只补新增默认值，不覆盖用户值 |

现有单智能体、团队和消息数据不做回填；迁移在事务中执行，重复打开数据库保持幂等。

## 2. Skill

### 存储与校验

- 内容：`~/.pizza/skills/<skill-id>/<version>/`；数据库保存元数据与文件清单。
- 导入：本地目录、ZIP（`fflate`）与 Git（`git clone --depth 1`）。
- `SKILL.md` 必须包含 `name`、`description`，`name` 只能是小写字母、数字、连字符或下划线。
- 拒绝绝对路径、`..`、空字节和符号链接；限制文件数、单文件与总大小。
- ZIP 在解压前按中央目录条目检查数量、单文件与累计大小，并限制压缩包本体大小。
- 冲突策略：`stop`（默认）、`overwrite`（保留 ID 与绑定）、`rename`、`skip`。
- 删除前列出受影响的智能体与团队成员；确认后先解除绑定再删除，不静默破坏配置。
- 内置 `pizza-collaboration` 只读；允许启停，不允许改名或删除。

### 注入

1. 解析生效 Skill（见第 5 节）。
2. 运行前物化到 `~/.pizza/runtime/<run-id>/plugin/skills/<name>/`。
3. Claude CLI：以 `--plugin-dir <run-plugin>` 加载，插件目录包含 `.claude-plugin/plugin.json`。
4. ACP：不修改运行时安装目录；把 Skill 名称、描述与物化路径写入本轮上下文，运行时声明 `skills` 能力时可自行读取。
5. 运行结束删除 `<run-id>` 目录；失败只影响对应 Skill，并写入运行诊断。

## 3. MCP

### 配置与凭据

- 传输：stdio、SSE、Streamable HTTP；stdio 需要命令，远程需要 http(s) URL。
- 连接与工具发现超时按服务保存（1–300 秒，默认 20 秒）。
- `env`/`headers` 使用 Electron `safeStorage` 加密后写入 `mcp_server`；无系统密钥环时使用显式 `b64:` 回退，设置页提示环境限制。
- 读取模型只返回 `hasEnv`/`hasHeaders` 与掩码；导出白名单不包含密钥。
- 修改按整体替换处理：未提供敏感字段即清空，界面提示需要重新输入；启停是独立操作，不会清空凭据。
- 解密失败会抛出明确诊断并跳过该 Server，不会以空凭据继续运行。
- stdio 子进程只继承 SDK 的安全环境白名单与用户显式声明的变量，不透传应用完整环境。
- 连接测试：连接 → 握手 → `tools/list` → 关闭；保存工具 schema 快照，修改配置后清空旧工具，需重新测试。
- 配置创建、修改、启停、删除、读取和连接测试写入 `audit_log`，只记录字段名、状态与计数。

### 注入

- Claude CLI：生成运行级 `--mcp-config` 临时 JSON，并为 stdio/SSE/HTTP 写入对应 `type`；同时使用 `--strict-mcp-config` 避免用户全局 MCP 混入。
- ACP：在 `session/new` 的 `mcpServers` 传入 stdio 服务，远程服务按 ACP 形状传递 `type`/`url`/`headers`；运行时未声明远程 MCP 能力时跳过 SSE/HTTP 并写诊断，不影响其他服务。
- 单个服务转换或解密失败只跳过该服务。

## 4. 统一审批

### 入口

- ACP：`session/request_permission` 交给主进程 `ApprovalService`；没有处理器时返回 `cancelled`，不自动选择第一个选项。
- Claude CLI：运行级 `--settings` 注入 `PreToolUse` hook；hook 通过本地 socket 请求主进程决定，输出 `permissionDecision`。hook 不可连接、超时或返回非法内容时一律 deny。

### 规则

- 决定：`allow_once`、`always_allow`、`deny`。
- 超时：默认 120 秒，按拒绝处理并记录 `timeout`。
- 队列：多个待处理请求按创建顺序展示，不覆盖；运行结束或取消时未决请求统一按拒绝处理。
- 策略优先级：MCP 工具允许/拒绝清单先于策略；策略同时读取智能体级与工作区级，冲突按 `deny > ask > allow` 取更严格者；都没有时默认询问。
- 用户可在 MCP 工具详情中把单个工具设为「询问 / 允许 / 禁止」，写为工作区级策略。
- 风险：`Bash`/`Shell`/删除类工具为 high，`Write`/`Edit` 等为 medium，其余 low。
- 审计：保存工具名、脱敏后的参数摘要、风险与策略来源；不保存完整凭据。

## 5. 能力解析

`CapabilityResolver` 按「运行时本地配置 → 工作区默认 → 智能体 → 团队成员」解析，越靠后优先级越高：
- 同一 Skill/MCP 在更具体作用域禁用时，会覆盖工作区默认；团队成员取消挂载会写入 `enabled=false` 的绑定，压住继承项。
- 团队成员 `capability_json` 可额外引用 Skill/MCP。
- Claude Code 的 `~/.claude.json` `mcpServers` 作为最底层来源读取；只读取配置，不执行其中的命令。
- 结果中的 MCP `source` 标注 `runtime`、`workspace`、`agent` 或 `team_member`，供预览解释来源。
- 内置协作 Skill 默认生效，可通过单次禁用清单排除。
- 诊断包含缺失内容目录、缺失服务、ACP 远程 MCP 不支持等原因。

## 6. 设置与数据目录

- 设置保存在 `app_setting`，新增主题、语言、字号、密度、减少动效、个人资料、通知偏好、日志级别、自动更新、匿名统计和引导状态。
- 设置变化广播到渲染层；主题、语言、字号和密度立即生效，启动时通过主进程启动参数与 `theme-bootstrap.js` 在 React 前应用。
- 数据目录：配置保存在 Electron userData 的 `data-dir.json`；切换流程为「确认 → 下次启动复制 → 数据库完整性校验 → 切换 → 保留旧目录」。失败保留旧目录并在设置页显示路径与原因。
- `PIZZA_DATA_DIR` 覆盖时禁止在设置页切换。

## 7. 通知

- 团队消息提及用户时，编排器先写入 `message_mention`，再调用通知服务。
- 同一会话同一消息只创建一条通知；免打扰只抑制系统通知，不抑制应用内未读标记。
- 系统通知权限不可用时降级为应用内通知；点击通知聚焦窗口、打开会话并定位消息。
- 通知偏好：启用、系统通知、免打扰；重启后保持。

## 8. 主题、国际化与可访问性

- `data-theme` 支持浅色/深色/跟随系统；系统主题变化实时更新。
- `data-font-size`、`data-density` 与 `data-reduced-motion` 作用于根节点；减少动效默认跟随系统偏好。
- i18next + react-i18next，简中与英文资源键集合一致；渲染层中文原文通过 `ui` 命名空间映射为英文，主进程常见错误在展示前翻译。缺失键回退中文并显示可读标签，不显示原始键名。
- 日期与数字使用 `Intl`；代码与路径使用等宽字体。

## 9. 首次启动与打包

- 运行时探测在用户点击「开始检测」后执行，只运行 `which`/`where` 与 `<command> --version`，分类已安装、未安装、需要登录/初始化；检测完成前不自动扫描。
- 检测结果支持多选；点击「导入所选运行时」会按预设逐个执行连接测试，成功的运行时直接注册，无需再进入添加页。需要调整命令或参数时仍可在「设置 → 运行时」中手动添加。
- 没有运行时或没有智能体时显示引导；用户可跳过并直接进入首页。
- `electron-builder` 生成 macOS 13+ 未签名 dmg/zip；版本来自 `package.json`，构建号来自 `PIZZA_BUILD_NUMBER`（开发为 `dev`）。
- `npm run check:package` 校验版本、构建号、图标与第三方归属；`npm run package:mac` 先生成 zip，再生成 dmg。
- 不捆绑模型运行时；签名、公证和自动更新不在本 change 范围。

## 10. 已知限制

- ACP 的远程 MCP 支持取决于运行时能力声明；未声明时只注入 stdio。
- Claude CLI 的 hook 行为可能随版本变化；hook 不可用时安全拒绝，需要以真实运行时冒烟复核。
- 当前 macOS 产物未签名；系统可能要求手动允许打开。签名、公证与 Gatekeeper 校验步骤见 `docs/RELEASE.md`。
- 自动更新、Windows/Linux 安装包、完整记忆与统计仍属后续范围。
