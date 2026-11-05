# 验收记录

本文件记录 `p0-solo-vertical-slice`、`p0-team-orchestration` 与 `p0-capabilities-settings` 的实际验收结果。命令结果以执行时的真实输出为准。

## 1.0.0 发布验收（2026-11-05）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 打包元数据 | `PIZZA_BUILD_NUMBER=1 npm run check:package` | 通过；v1.0.0 · build 1 |
| 类型检查 | `npm run typecheck` | 通过 |
| 单元/集成测试 | `npm test` | 36 个测试文件、186 个测试全部通过 |
| 生产构建 | `npm run build` | main、preload、renderer 均构建成功 |
| Electron E2E | `npx playwright test` | 7 个通过、2 个按设计跳过 |
| macOS arm64 | `PIZZA_BUILD_NUMBER=1 npm run package:mac` | 通过；生成 dmg / zip（未签名） |
| macOS x64 | `PIZZA_BUILD_NUMBER=1 ./node_modules/.bin/electron-builder --mac dmg zip --x64 --publish never` | 通过；生成 dmg / zip（未签名） |
| Windows x64 | `PIZZA_BUILD_NUMBER=1 ./node_modules/.bin/electron-builder --win nsis zip --x64 --publish never` | 通过；生成 Setup exe / zip（未签名） |
| Linux x64 | `PIZZA_BUILD_NUMBER=1 ./node_modules/.bin/electron-builder --linux AppImage deb --x64 --publish never` | 通过；生成 AppImage / deb |
| 版本与构建号 | 启动 `release/mac-arm64/Pizza.app` 查询 `app.info()` | `version: 1.0.0`、`build: 1` |
| 产物校验 | `shasum -a 256` | 生成 `release/SHA256SUMS-1.0.0.txt` |

发布说明与完整变更记录见 `CHANGELOG.md`。1.0.0 的 macOS / Windows 包仍未签名；正式公开分发前仍需完成签名与公证。

## 1. 自动化验证

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | 通过 |
| 单元/集成测试 | `npm test` | 26 个测试文件、124 个测试全部通过 |
| 生产构建 | `npm run build` | main、preload、renderer 均构建成功 |
| Electron E2E | `npm run test:e2e` | 通过；覆盖单智能体、团队协作、首次启动、能力设置、主题/语言持久化、通知跳转、启动失败与打包产物启动 |
| 打包 | `npm run package:mac` | 通过；生成 `release/Pizza-0.1.0-arm64.dmg` 与 `.zip`（未签名） |
| 打包元数据 | `npm run check:package` | 通过 |
| 界面复查 | 1440×900 截图对比 | 标题栏、侧栏、首页、会话页、产出物面板、设置、智能体/运行时/团队编辑页与已确认原型结构一致；默认中文文案保持不变 |

自动化 E2E 使用 `tests/fixtures/fake-claude.cjs`，不依赖真实模型，因此可以在干净环境稳定重复。团队测试覆盖：从头脑风暴模板创建五名角色、发送任务、指挥者分派、成员回复、指挥者收敛、`team-turn-1.md` 出现在产出物面板、等待用户后继续当前回合。

## 2. 真实运行时验收

### 2.1 单智能体

- 运行时：本机 `claude`（Claude Code CLI）
- 验收方式：在图形界面注册运行时并完成连接测试，创建智能体，发送要求写入文件的编码任务。
- 结果：连接测试通过；任务完成后，产出文件出现在工作区并同步显示在右侧产出物面板；会话消息、运行记录与产出物在重启后仍然存在。

### 2.2 团队编排

- 运行时：本机 `claude`（Claude Code CLI，版本 2.1.318）
- 验收方式：`PIZZA_REAL_E2E=1 npx playwright test tests/e2e/team-real.spec.ts`
- 过程：注册真实运行时 → 从头脑风暴模板创建五名角色 → 发送团队议题 → 运行中插入“必须考虑本地优先与成本”的约束 → 指挥者追问时回复要求直接收敛。
- 结果：通过；四名成员分别产出观点，指挥者完成多轮收敛并生成 `.pizza/artifacts/team-turn-1.md`（5,407 字节），包含结论、关键依据、分歧与未决、建议下一步。
- 审查修复后的真实重跑在 600 秒超时，数据库未记录代码错误事件；该次不计为通过，真实模型运行时间仍需观察。
- 说明：真实测试默认跳过，避免日常检查和 CI 产生模型费用；确定性 E2E 始终运行。

### 2.3 能力设置与打包产物

- 运行时：本机 `claude`（Claude Code CLI，版本 2.1.318）
- 验收方式：`PIZZA_REAL_E2E=1 npx playwright test tests/e2e/packaged-real.spec.ts`
- 过程：启动 `release/mac-arm64/Pizza.app` → 在首次启动引导中选择检测到的 Claude Code → 注册并测试连接 → 点击「创建通用助手并开始」→ 发送“只回复一个单词：pong”。
- 结果：通过；打包应用在无终端环境下完成运行时接入与首个会话，智能体返回 `pong`，运行完成后正常退出。
- 说明：该用例默认跳过；真实模型调用产生费用，日常检查只运行确定性 E2E。

## 3. 环境

- 平台：macOS（darwin）
- Electron：45.x
- Node：22.23.3（Electron 内嵌 Node 24）
- 数据库：`node:sqlite`，WAL + 外键
- 数据目录：默认 `~/.pizza`，可由 `PIZZA_DATA_DIR` 覆盖

## 4. 修复阶段回归（2026-11-04）

- 英文覆盖：导航、设置、能力页面、智能体/团队/运行时编辑器、聊天与产出物面板、空状态和错误提示全部接入英文；新增测试阻止 UI 映射残留中文或插值占位符不一致。
- ACP 远程 MCP：`session/new` 的远程服务补齐 `type`/`url`/`headers`，新增夹具断言验证实际载荷。
- 发布说明：`docs/RELEASE.md` 记录签名、公证、Gatekeeper 校验与打包检查步骤。
- 回归命令：`npm run typecheck`、`npm test`（124/124）、`npm run build`、`npx playwright test tests/e2e/{smoke,capabilities,team,boot-error}.spec.ts` 全部通过。
