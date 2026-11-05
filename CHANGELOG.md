# Changelog

## 1.0.0 — 2026-11-05

首个稳定版本。Pizza 从单 Agent 会话扩展为本地优先的多智能体协作工作台。

### 中文

- **双模式会话**：单智能体直接对话，或由指挥者组织多个 Agent 协作。
- **指挥者 @ 路由**：指挥者按能力目录分派单轮任务，成员结果回到指挥者；成员之间不直连，回合由指挥者决定继续或收敛。
- **动态角色指令**：智能体可选择自带 Prompt，或由指挥者在每次 `@` 时下发完整角色指令与约束。
- **运行时接入**：支持 Claude Code、Codex、Pi、Oh My Pi、DeepSeek Harness、Hermes、OpenCode、Qoder CN、Gemini CLI、Kimi Code、通用 ACP 与 Custom CLI。
- **首次启动**：自动检测本机运行时，支持多选后一键测试导入；补齐 macOS GUI 应用常见的 PATH 目录。
- **可靠执行**：流式输出、停止、重试、排队、并发上限、跳数保护与运行轨迹。
- **工作区产出物**：收敛结论自动写入 `.pizza/artifacts/`，支持 Markdown 与代码预览。
- **桌面体验**：macOS、Windows、Linux；浅色 / 深色主题、中英文界面与运行时品牌图标。
- **文档站**：英文优先的 GitHub Pages 产品文档，中文位于 `/zh/`。

### English

- **Two session modes**: talk to one agent, or let a leader orchestrate a team.
- **Leader @-routing**: the leader dispatches single-turn tasks by capability catalog; member results return to the leader, and the leader decides whether to continue or converge.
- **Dynamic role instructions**: agents can keep a saved prompt or receive the full role instruction from the leader on every `@`.
- **Runtime support**: Claude Code, Codex, Pi, Oh My Pi, DeepSeek Harness, Hermes, OpenCode, Qoder CN, Gemini CLI, Kimi Code, generic ACP, and Custom CLI.
- **First launch**: detects local runtimes, multi-select import with real connection tests, and PATH augmentation for GUI launches.
- **Reliable execution**: streaming, stop, retry, queueing, concurrency limits, hop guard, and run traces.
- **Workspace artifacts**: convergence summaries are written to `.pizza/artifacts/` with Markdown and code preview.
- **Desktop experience**: macOS, Windows, and Linux; light / dark themes, Chinese / English UI, and runtime brand icons.
- **Documentation**: English-first GitHub Pages docs with Chinese at `/zh/`.

### Fixes

- Qoder CN now uses its supported stream flags and `--reasoning-effort`.
- Agents referenced only by archived sessions can now be deleted.
- Dev and packaged builds detect the same runtimes regardless of launch PATH.
- English team runs write English artifact headings (`Team turn N`).

### Known limitations

- macOS / Windows builds are unsigned; code signing and notarization remain a release prerequisite for public distribution.
- Auto-update is not enabled yet.
