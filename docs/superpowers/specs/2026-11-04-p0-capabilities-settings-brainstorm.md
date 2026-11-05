# P0 能力设置设计摘要（候选）

- Change：`p0-capabilities-settings`
- 日期：2026-11-04
- 状态：候选，待用户确认
- 依赖：已归档的 `p0-solo-vertical-slice`、`p0-team-orchestration`

## 1. 目标与边界

把 Pizza 从可运行切片推进到可安装、可配置的产品：Skill/MCP 管理、统一工具审批、设置中心、通知、主题与中英文、首次启动引导和 macOS 安装包。不包含自动更新、签名公证、Windows/Linux 包、团队快照和完整 P1 统计/记忆。

## 2. 关键技术方案

### 2.1 能力解析与注入

`CapabilityResolver` 在每次运行前按「智能体配置 → 团队成员覆盖 → 全局默认」解析最终 Skill/MCP 清单，写入运行快照；`InjectionPipeline` 将快照转换成运行时格式。解析、校验、物化、注入、失败诊断分离，任何能力失败只影响该能力并写运行事件。

### 2.2 Skill

- 存储：`~/.pizza/skills/<skill-id>/<version>/`，SQLite 保存元数据、来源、文件清单和绑定。
- 导入：本地目录、ZIP、Git；解压到临时目录，拒绝绝对路径、`..`、符号链接越界；确认后原子移入。
- 冲突：停止/覆盖/重命名/跳过，默认停止；覆盖保留原 ID 与绑定。
- 注入：Claude CLI 生成运行级 plugin 目录（`.claude-plugin/plugin.json` + `skills/<name>/`），通过 `--plugin-dir` 加载；ACP 在声明 `skills` 能力时通过系统上下文注入清单与路径，不修改运行时安装目录。
- 内置 Pizza 协作 Skill 作为只读资源随包发布，可单次禁用。

### 2.3 MCP

- 使用 `@modelcontextprotocol/sdk` 的 TypeScript 客户端；支持 stdio、SSE、HTTP。
- 配置保存在 SQLite，env/Header 使用 `safeStorage` 加密；IPC 只返回掩码和 `hasSecret`，导出默认去除密钥。
- 连接测试：启动/连接 → 握手 → `tools/list` → 关闭，保存工具 schema 快照。
- 注入：Claude CLI 写临时 `--mcp-config` JSON；ACP 以 stdio `mcpServers` 传入 `session/new`，SSE/HTTP 在 ACP 未声明支持时标记不可用并写诊断，不影响其他 Server。
- 三层合并：智能体 > 团队成员覆盖 > 工作区默认；工具允许/拒绝按更严格者生效。

### 2.4 工具审批

统一 `ApprovalService`：

- ACP：接管 `session/request_permission`，不再自动选择第一个选项。
- Claude CLI：通过 `--settings` 注入 PreToolUse hook，运行级 hook 脚本连接主进程本地 socket，展示同一审批对话框并等待决定；hook 输出 `permissionDecision`。若 hook 不可用，按拒绝处理并写诊断。
- 决定：允许一次、总是允许（按智能体+工具+范围持久化）、拒绝；超时 120 秒默认拒绝；FIFO 队列。
- 危险工具默认询问；禁止策略直接拒绝且不弹窗；审计保存参数摘要和策略来源，不保存完整密钥。

### 2.5 设置中心

扩展现有设置外壳：个人资料、语言与外观、系统默认值（工作区/运行时/并发/数据目录/日志级别/自动更新/匿名统计）、已归档会话、关于、通知偏好。设置存于 `app_setting`，Zod 校验；启动前读取主题/语言，避免首屏闪烁。

数据目录变更采用「确认 → 复制 → 校验 → 切换 → 保留原目录」；失败保留原目录并显示路径与修复建议。

### 2.6 通知

团队/单智能体消息精确提及用户时写 `notification` 记录、标记会话，并发送 Electron Notification + 托盘提示；点击聚焦窗口、打开会话并定位消息。免打扰只抑制系统通知；同一请求去重；权限拒绝时降级为应用内通知。

### 2.7 外观与本地化

主题（浅色/深色/跟随系统）通过根属性与 CSS 变量；字号、密度、减少动效为根属性；i18next + react-i18next，中英文资源按命名空间组织，缺失键回退另一语言；日期/数字使用 `Intl`；启动前读取语言避免闪烁。

### 2.8 首次启动与打包

首次启动用 `which`/预设命令探测六种运行时并读取版本，分类已安装/未安装/需登录；引导完成选择运行时、测试、注册、创建智能体和首个会话，无运行时也可进入首页。

`electron-builder` 生成 macOS 13+ 未签名 zip/dmg，版本/构建号来自 `package.json` 并在构建前校验；包含图标、许可和第三方归属；不打包任何模型运行时。自动更新和签名公证留给后续。

### 2.9 测试

- Vitest：能力解析、Skill 路径校验、MCP 合并、审批策略、设置 schema、i18n 回退。
- 假 MCP stdio/HTTP Server；假 ACP/CLI 运行时验证审批队列、允许/拒绝/超时。
- Playwright：主题/语言切换、通知跳转、首次启动引导与设置持久化。
- 打包冒烟：安装产物启动、版本与关于页一致。

## 3. 需要确认的取舍

1. **CLI 审批实现**：采用 PreToolUse hook + 本地 socket 回传主进程，而不是依赖 CLI 的交互式 permission prompt（当前 `-p` 模式无法可靠弹窗）。
2. **ACP 远程 MCP**：P0 只保证 ACP stdio MCP；SSE/HTTP 在 ACP 不声明支持时标记不可用，Claude CLI 完整支持三种传输。
3. **Skill 注入**：Claude 使用运行级 `--plugin-dir`；ACP 以清单/路径写入上下文，不修改运行时安装目录。
4. **数据目录迁移**：复制并验证后切换，不自动删除旧目录；失败回退旧目录。
5. **打包范围**：只交付未签名 macOS 包，不做自动更新/公证。

## 4. 风险

- 真实 CLI 的 hook 行为随版本变化 → 以假 CLI 夹具和真实 Claude 冒烟双重验证，hook 不可用时安全拒绝。
- MCP 凭据泄漏 → 加密、只写字段、掩码、导出白名单、日志脱敏。
- 审批阻塞运行 → 超时拒绝、会话可见状态、FIFO 不覆盖。
- i18n 文案遗漏 → 资源集中与键名扫描测试。
- 打包环境/签名限制 → 未签名产物验收，记录平台限制。

## 5. 不在本 change 中

自动更新、代码签名/公证、Windows/Linux 安装包、团队快照、完整记忆/统计、云端同步、插件市场。
