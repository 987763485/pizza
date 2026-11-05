# 验证报告：p0-capabilities-settings

- 日期：2026-11-04
- Change：`p0-capabilities-settings`
- 阶段：Verify（standard 审查深度）
- 任务：66/66 完成
- 需求/场景：19 个 Requirement，63 个 Scenario（7 份 delta specs）

## 1. 自动化检查

全部命令在当前工作区真实执行，结果以实际输出为准。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 打包元数据 | `npm run check:package` | 通过（v0.1.0 · build dev） |
| 类型检查 | `npm run typecheck` | 通过 |
| 单元/集成测试 | `npm test` | 26 个测试文件、121 个测试全部通过 |
| 生产构建 | `npm run build` | main、preload、renderer 均构建成功 |
| Electron E2E | `npm run test:e2e` | 5 通过、2 按设计跳过；顺序执行避免 Electron 并发启动抖动 |
| 完整验收入口 | `npm run verify` | 退出码 0 |
| Build Guard | `comet guard p0-capabilities-settings build --apply -- npm run verify` | `ALL CHECKS PASSED — phase=verify` |
| macOS 打包 | `npm run package:mac` | 通过；`release/Pizza-0.1.0-arm64.dmg` 与 `.zip`（未签名） |
| 打包产物启动 | `npx playwright test tests/e2e/packaged.spec.ts` | 通过；创建数据目录、打开主窗口、关于页版本一致 |
| 真实运行时 | `PIZZA_REAL_E2E=1 npx playwright test tests/e2e/packaged-real.spec.ts` | 通过；打包应用从首次启动引导接入真实 Claude Code，自动创建通用助手并返回 `pong` |

补充说明：

- `npm test` 覆盖迁移 1–7、设置 schema、数据目录迁移回退、Skill 导入/路径穿越/符号链接/ZIP 大小限制/冲突/物化失败、MCP 加密/整体替换/超时/连接测试/HTTP 与 stdio 连接器/审计、能力解析与三层来源、审批队列/超时/策略严格度/MCP 白名单、通知去重与免打扰、i18n 资源与 Intl 格式、打包元数据。
- `tests/e2e/capabilities.spec.ts` 覆盖首次启动、Skill 新建/启停/删除、MCP 配置、主题/密度/语言切换与刷新持久化。
- `tests/e2e/boot-error.spec.ts` 覆盖数据目录初始化失败时的路径与恢复提示。
- `tests/e2e/packaged.spec.ts` 覆盖安装产物启动与版本一致性；真实模型用例默认跳过，避免日常费用。
- `node:sqlite` 的 ExperimentalWarning 是 Node 22 的预期提示，不是失败。

## 2. 独立审查结论

按 standard 审查深度，由独立子代理阅读实现、测试与 delta specs，报告 10 条问题；均已在 Build 修复并补充回归测试：

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | 编辑 MCP 时旧凭据被保留，修改 URL 后可能发往新端点 | 改为整体替换；新增独立启停接口，避免启停清空凭据；更新测试与 UI 提示 |
| 2 | ACP 选项按子串匹配，「允许一次」可能选中 `allow_always` | 改为 kind 精确匹配；假 ACP 故意把 always 排在最前验证 |
| 3 | 运行准备失败时明文 MCP 配置残留；临时文件权限过宽 | 失败路径统一 cleanup；runDir/配置/socket 设 0700/0600；启动时清扫 runtime 目录 |
| 4 | 策略冲突未取更严格者；缺少禁止/询问配置入口；MCP 配置无审计 | 同时读取智能体与工作区策略，按 deny > ask > allow；MCP 工具详情可设三项策略；新增 `audit_log` 记录配置读写与测试 |
| 5 | 凭据解密失败被静默当作空凭据 | 抛出明确诊断并跳过该 Server，由解析器记录 |
| 6 | stdio MCP 继承应用完整环境变量 | 改用 SDK 安全环境白名单 + 用户显式变量 |
| 7 | Skill 物化失败只记诊断不阻止运行 | 物化失败抛错并清理，运行标记失败 |
| 8 | 团队成员只能增加 Skill/MCP，不能移除继承项 | 取消挂载写入 `enabled=false` 团队成员绑定，覆盖继承 |
| 9 | 修改 MCP 后仍显示旧工具清单 | 更新时清空 tools/测试时间，需重新测试 |
| 10 | ZIP 在限制检查前整体解压，存在压缩炸弹风险 | 解压前按条目数量/单文件/累计大小过滤，并限制压缩包大小 |

审查后重新运行完整测试、构建、E2E 与 Build Guard，均通过。

## 3. 规格覆盖

- Skill：列表/搜索、创建与 frontmatter、目录/ZIP/Git 导入、路径与链接保护、编辑与删除影响、智能体与团队成员挂载、物化成功/失败、同名冲突、内置 Skill 与单次禁用均有实现与测试。
- MCP：列表与启停、stdio/SSE/HTTP 配置、凭据加密与整体替换、超时、连接测试与工具发现、挂载与工具白名单、运行时本地配置合并、CLI/ACP 注入、只写保护与审计均有实现与测试。
- 审批：ACP 权限请求与 Claude PreToolUse hook 共用服务；允许一次/总是允许/拒绝、危险默认询问、策略严格度、超时、FIFO、脱敏审计均有实现与测试。
- 设置：导航、个人资料、系统默认值、数据目录迁移与失败回退、归档会话、关于页、P1 占位、持久化与校验均有实现。
- 通知：提及记录、应用内与系统通知、点击定位、免打扰、去重、权限降级与偏好持久化均有实现与测试。
- 外观：浅色/深色/跟随系统、启动前恢复、字号/密度/减少动效、中英文切换、缺失键回退、Intl 格式均有实现与测试。
- 分发：六种运行时探测、无运行时进入首页、首次配置与自动创建通用助手、macOS dmg/zip、版本/构建号/第三方归属、数据目录初始化与失败提示均有实现与测试。

## 4. 可接受偏差与残余风险

1. **英文覆盖范围**：导航、设置中心、能力页面、通知与审批，以及智能体/团队/运行时编辑器、聊天与产出物面板、空状态和错误提示均已接入英文。渲染层以中文原文为键统一映射，英文缺失由测试阻止；主进程返回的中文错误在展示前按已知模式翻译，未命中时保留原文与诊断信息。默认中文界面仍与原型的文案一致。智能体生成的消息内容、运行时系统提示与既有数据不随界面语言改写。
2. **ACP 远程 MCP**：只有运行时声明 `remoteMcp` 能力时才注入 SSE/HTTP；否则跳过并写诊断。`session/new` 现已按 ACP 形状传递远程服务的 `type`/`url`/`headers`，并由夹具测试验证；stdio 在所有 ACP 运行时可用。
3. **Claude hook 版本差异**：`PreToolUse` hook 行为依赖 Claude Code 版本；无法连接、超时或返回非法内容时一律拒绝。已用真实 Claude Code 2.1.318 验证完整会话，但未覆盖所有历史版本。
4. **macOS 产物未签名**：系统可能要求手动允许打开；签名、公证与自动更新不在本 change 的实现范围，打包前的签名、公证与 Gatekeeper 校验步骤已写入 `docs/RELEASE.md`。
5. **真实模型成本**：真实 E2E 默认跳过，只记录一次性通过结果；模型服务波动不作为代码回归证据。

## 5. 结论

66/66 任务完成，所有确定性检查与 Build Guard 通过；独立审查发现的 10 项问题均已修复并回归。没有未处理的 CRITICAL 问题。上述偏差已在文档中说明，不阻塞归档；归档交付方式由用户决定。

## 6. 修复阶段补充（2026-11-04）

针对验证报告中的残余偏差，完成以下修复并回归：

- 英文覆盖扩展到全部渲染层界面文案，并增加 UI 映射无中文残留、插值占位符一致的测试；主进程常见错误在渲染层按模式翻译，未知错误保留原文。
- ACP 远程 MCP 映射补齐 `type`/`url`/`headers`，新增 `acp-approval` 夹具测试验证 `session/new` 的实际载荷。
- 新增 `docs/RELEASE.md`，记录签名、公证、Gatekeeper 校验与打包检查步骤，并从 `docs/USAGE.md` 链接。
- 回归：`npm run typecheck`、`npm test`（124/124）、`npm run build`、`npm run check:package`，以及 smoke/capabilities/team/boot-error E2E 全部通过。
