# Design Brainstorm Summary

## 已确认事实

- 产品：Pizza，本地优先、以 `@` 为协作原语的多智能体工作台。
- 本 change：`p0-solo-vertical-slice`，单智能体纵向切片；依赖为空。
- 范围：桌面基础壳、本地存储、工作区、运行时注册与连接测试、智能体 CRUD、单智能体会话、历史/搜索/归档、附件、产出物、VS Code 打开。
- 非目标：团队协作、Skill/MCP、完整设置、主题/国际化、安装包、云同步。
- 产物语言：简体中文；生产代码使用 TypeScript。
- 技术基线：独立实现，不复制参考项目代码或品牌资产。
- 用户已确认 Open 产物；本阶段只确认技术设计与正式 Design Doc。

## 候选技术方案

- Electron + React + TypeScript + electron-vite。
- 主进程负责 SQLite、运行时子进程、文件监听和系统能力；preload 暴露窄 IPC；渲染层使用 React Router、Zustand 和 CSS Modules。
- SQLite（`better-sqlite3`）+ WAL + FTS5；数据库 `~/.pizza/pizza.db`，附件 `~/.pizza/attachments/`。
- 运行时适配器统一为 `test()` + `openSession()`；首批实现 ACP stdio 和 Claude Code CLI，其他预设只提供模板并标记实验性。
- 运行事件先落库再推送到渲染层；标准化事件包括文本增量、工具开始/更新/结束、用量、完成、失败和取消。
- 产出物使用运行期工作区监听 + 工具事件提示，忽略 `.git`、依赖和构建目录。
- 安全边界：`contextIsolation`、无 `nodeIntegration`、CSP、argv 启动、Zod 校验、`safeStorage` 保存运行时密钥。
- 测试：Vitest 单元/集成测试；Playwright Electron 冒烟；一次真实 Claude Code CLI 手工验收。

## 已知取舍

- 首批认证 ACP + Claude Code CLI，不承诺六种运行时全部可流式工作；其他预设标记实验性。
- 会话连续性依赖运行时 resume 能力；不支持时回退为新上下文并插入系统提示。
- PDF 预览、额外运行时认证、安装包属于后续变更或本 change 外。
- 使用 npm 作为包管理器并提交 lockfile；后续可评估 pnpm。

## Spec Patch

无。当前 OpenSpec proposal、specs 和 design 已覆盖上述方案；不需要修改 delta spec。

## 待后续处理

- 哪些额外运行时预设可在 M1 后认证。
- PDF 预览是否在本切片补充。
- 安装包、签名和自动更新由 `p0-capabilities-settings` 负责。
