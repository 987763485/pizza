/* 演示数据：智能体、团队、会话、消息、产物、能力。 */

const AGENTS = {
  host: {
    id: "host", name: "主持人", short: "主", role: "指挥者",
    desc: "拆解问题、组织辩论、收敛结论",
    color: "#D9482B", glyph: "star", runtime: "Claude Code", runtimeId: "claude",
    presence: "running", model: "Claude Sonnet 4.5", thinking: "高",
    skills: ["brainstorm", "code-review"], mcp: ["filesystem"],
  },
  pm: {
    id: "pm", name: "产品经理", short: "产", role: "成员",
    desc: "用户价值、场景取舍、优先级",
    color: "#D97706", glyph: "sun", runtime: "Claude Code", runtimeId: "claude",
    presence: "online", model: "Claude Sonnet 4.5", thinking: "中",
    skills: ["brainstorm"], mcp: ["filesystem"],
  },
  arch: {
    id: "arch", name: "架构师", short: "架", role: "成员",
    desc: "技术方案、成本、可演进性",
    color: "#2563EB", glyph: "hex", runtime: "Codex", runtimeId: "codex",
    presence: "running", model: "GPT-5.1 Codex", thinking: "高",
    skills: ["api-design", "code-review"], mcp: ["filesystem", "github"],
  },
  researcher: {
    id: "researcher", name: "用户研究员", short: "研", role: "成员",
    desc: "证据、访谈、反例与边界",
    color: "#16A34A", glyph: "leaf", runtime: "Claude Code", runtimeId: "claude",
    presence: "waiting", model: "Claude Sonnet 4.5", thinking: "中",
    skills: ["research"], mcp: ["filesystem"],
  },
  critic: {
    id: "critic", name: "唱反调者", short: "反", role: "成员",
    desc: "挑战共识、寻找失败路径",
    color: "#7C3AED", glyph: "bolt", runtime: "Pi", runtimeId: "pi",
    presence: "offline", model: "Pi 默认", thinking: "中",
    skills: ["brainstorm"], mcp: [],
  },
  builder: {
    id: "builder", name: "Builder", short: "B", role: "成员",
    desc: "后端工程师，把需求推进到可合并的改动",
    color: "#2563EB", glyph: "code", runtime: "Claude Code", runtimeId: "claude",
    presence: "online", model: "Claude Sonnet 4.5", thinking: "中",
    skills: ["code-review", "frontend-design"], mcp: ["filesystem", "github"],
  },
  reviewer: {
    id: "reviewer", name: "Reviewer", short: "R", role: "成员",
    desc: "代码评审、边界条件、测试覆盖",
    color: "#16A34A", glyph: "target", runtime: "Codex", runtimeId: "codex",
    presence: "online", model: "GPT-5.1 Codex", thinking: "中",
    skills: ["code-review"], mcp: ["github"],
  },
};

const TEAMS = {
  brainstorm: {
    id: "brainstorm", name: "头脑风暴队", short: "头",
    desc: "多角色发散、交叉辩论、由主持人收敛成文档",
    leader: "host",
    members: ["host", "pm", "arch", "researcher", "critic"],
    color: "#D9482B", last: "12 分钟前", snapshots: 2,
    fanout: "并发", maxRounds: 5,
  },
  dev: {
    id: "dev", name: "前后端开发队", short: "开",
    desc: "先定接口契约，再并行实现，最后交叉评审",
    leader: "builder",
    members: ["builder", "reviewer", "arch", "pm"],
    color: "#2563EB", last: "今天 09:18", snapshots: 1,
    fanout: "串行", maxRounds: 4,
  },
};

const WORKSPACES = [
  { id: "pizza", name: "Pizza 项目", path: "~/Pizza" },
  { id: "report", name: "report_test", path: "/Users/chunle/Downloads/report_test" },
  { id: "qoder", name: "qoder", path: "~/Documents/qoder", pinned: true },
  { id: "qodercn", name: "qodercn", path: "~/Documents/qodercn" },
];

const SESSIONS = [
  { id: "mobile", title: "移动端要不要做", mode: "team", target: "brainstorm", group: "置顶", status: "running", time: "刚刚", workspace: "pizza" },
  { id: "claude", title: "接入 Claude Code 运行时", mode: "solo", target: "builder", group: "今天", status: "done", time: "10:42", workspace: "pizza" },
  { id: "api", title: "评审 API 设计", mode: "team", target: "dev", group: "今天", status: "waiting", time: "09:18", workspace: "pizza" },
  { id: "settings", title: "重构设置页导航", mode: "solo", target: "builder", group: "昨天", status: "done", time: "昨天", workspace: "pizza" },
  { id: "interview", title: "移动端用户访谈摘要", mode: "solo", target: "researcher", group: "昨天", status: "done", time: "昨天", workspace: "pizza" },
  { id: "qoder-open", title: "制作适配任何 agent 的 Open...", mode: "solo", target: "builder", group: "昨天", status: "done", time: "昨天", workspace: "qoder" },
  { id: "qodercn-scan", title: "AI时代漏洞扫描系统分析", mode: "team", target: "brainstorm", group: "置顶", status: "done", time: "10 月 30 日", workspace: "qodercn" },
];

const ARTIFACTS = {
  team: [
    {
      id: "mobile-md", name: "移动端评估.md", path: "docs/移动端评估.md", status: "M", kind: "md", by: "主持人", meta: "刚刚 · 4.2 KB",
      content: `<h1>移动端评估</h1>
<p><strong>结论：</strong>建议在 6 个月内推出「移动指挥台」最小版本，而不是完整客户端。第一阶段只做查看、审批与轻回复；触发智能体仍需桌面在线。</p>
<h2>关键依据</h2>
<ul>
<li>12 位访谈用户中 9 位愿意在手机查看进展，只有 2 位愿意在手机配置智能体。</li>
<li>移动端最高频场景是「离开桌面后收到收敛结果并做一次审批」。</li>
<li>完整客户端需要复用 Go 服务、Postgres 与 daemon，直接移植成本高。</li>
</ul>
<h2>建议形态</h2>
<table><thead><tr><th>阶段</th><th>范围</th><th>依赖</th></tr></thead><tbody>
<tr><td>一期</td><td>通知、审批、轻回复、查看产出物</td><td>桌面端在线中继</td></tr>
<tr><td>二期</td><td>在手机上触发智能体</td><td>远程运行时或云端中继</td></tr>
</tbody></table>
<h2>分歧与未决问题</h2>
<ul>
<li>个人开发者在通勤时桌面通常关闭，这与「桌面在线」假设冲突。</li>
<li>目标用户是个人开发者还是 3–10 人团队，尚未确认；它会改变一期优先级。</li>
</ul>
<h2>下一步</h2>
<ol><li>确认目标用户与一期范围。</li><li>用 2 周做一个只读 + 审批的移动 Web 原型。</li><li>验证「离开桌面后收到结果」的真实使用频率。</li></ol>`,
    },
    { id: "interview-md", name: "访谈摘要.md", path: "docs/访谈摘要.md", status: "M", kind: "md", by: "用户研究员", meta: "12 分钟前 · 2.1 KB", content: `<h1>移动端用户访谈摘要</h1><p>样本：12 位用户，其中个人开发者 7 位，3–10 人团队 5 位。</p><h2>主要发现</h2><ul><li>查看进展与审批是最高频的移动需求。</li><li>配置智能体、编辑 Prompt 几乎无人愿意在手机上完成。</li><li>桌面关闭时，用户更倾向于「稍后处理」而不是在手机上重新发起任务。</li></ul>` },
    { id: "cost-md", name: "成本估算.md", path: "docs/成本估算.md", status: "M", kind: "md", by: "架构师", meta: "18 分钟前 · 1.4 KB", content: `<h1>移动端成本估算</h1><p>在复用现有渲染层与服务端的前提下，一期约 6–8 人周；完整客户端约 20+ 人周，且需要新增远程中继。</p>` },
    { id: "sketch-png", name: "移动端草图.png", path: "design/移动端草图.png", status: "A", kind: "image", by: "产品经理", meta: "20 分钟前 · 860 KB", content: `<h1>移动端草图</h1><p>一期：通知、审批、轻回复与产出物查看。触发智能体留到二期。</p>` },
    { id: "readme-team", name: "README.md", path: "README.md", status: "info", kind: "md", by: "主持人", meta: "本次会话 · 1.1 KB", content: `<h1>Pizza 工作区</h1><p>本目录是本次团队会话的工作区。产出物按 docs/ 与 design/ 组织。</p>` },
  ],
  solo: [
    { id: "archived-tsx", name: "archived-sessions-page.tsx", path: "src/archived-sessions-page.tsx", status: "A", kind: "code", by: "Builder", meta: "刚刚 · 1.8 KB", content: `<h1>archived-sessions-page.tsx</h1><pre><code>import { ChatThreadList } from "@/views/chat/components/chat-thread-list";

export function ArchivedSessionsPage() {
  return (
    &lt;div className="page-inner"&gt;
      &lt;h1&gt;已归档会话&lt;/h1&gt;
      &lt;ChatThreadList scope="archived" /&gt;
    &lt;/div&gt;
  );
}</code></pre>` },
    { id: "nav-test", name: "settings-navigation.test.ts", path: "src/settings-navigation.test.ts", status: "A", kind: "test", by: "Builder", meta: "刚刚 · 0.9 KB", content: `<h1>settings-navigation.test.ts</h1><pre><code>it("shows the archived sessions entry", () =&gt; {
  const group = getSettingsGroup("personal");
  expect(group.items).toContainEqual(
    expect.objectContaining({ id: "archived" })
  );
});</code></pre>` },
    { id: "change-md", name: "变更说明.md", path: "docs/变更说明.md", status: "M", kind: "md", by: "Builder", meta: "1 分钟前 · 0.6 KB", content: `<h1>变更说明</h1><ul><li>设置导航新增「已归档会话」。</li><li>新增归档会话页面，复用会话列表组件。</li><li>补充导航渲染测试。</li></ul>` },
    { id: "readme-solo", name: "README.md", path: "README.md", status: "info", kind: "md", by: "Builder", meta: "本次会话 · 0.8 KB", content: `<h1>Pizza 工作区</h1><p>设置页新增已归档会话入口。</p>` },
  ],
};

const SKILLS = [
  { id: "brainstorm", name: "头脑风暴", cmd: "/brainstorm", desc: "发散、交叉质询、收敛为结构化文档", version: "1.3", source: "内置", usedBy: 2, enabled: true },
  { id: "code-review", name: "代码评审", cmd: "/code-review", desc: "按团队规范检查改动与边界条件", version: "1.2", source: "本地", usedBy: 4, enabled: true },
  { id: "frontend-design", name: "前端设计", cmd: "/frontend-design", desc: "界面结构、视觉层级与交互细节", version: "0.9", source: "Git", usedBy: 2, enabled: true },
  { id: "api-design", name: "API 设计", cmd: "/api-design", desc: "接口契约、错误语义与版本演进", version: "1.0", source: "本地", usedBy: 2, enabled: true },
  { id: "research", name: "用户研究", cmd: "/research", desc: "访谈提纲、证据整理与反例检查", version: "0.7", source: "本地", usedBy: 1, enabled: true },
];

const MCPS = [
  { id: "filesystem", name: "filesystem", transport: "stdio", desc: "读写工作区文件", tools: 14, usedBy: 3, status: "online" },
  { id: "github", name: "github", transport: "HTTP", desc: "仓库、PR、Issue 与检查状态", tools: 22, usedBy: 2, status: "online" },
  { id: "postgres", name: "postgres", transport: "stdio", desc: "只读查询本地开发数据库", tools: 6, usedBy: 1, status: "error" },
  { id: "playwright", name: "playwright", transport: "stdio", desc: "浏览器自动化与截图", tools: 11, usedBy: 1, status: "online" },
];

const RUNTIMES = [
  { id: "claude", name: "Claude Code", adapter: "Claude Code", protocol: "CLI · stream-json", status: "online", caps: ["流式", "MCP", "Skill", "插话"], models: 5, agents: 4, last: "刚刚", icon: "sparkle" },
  { id: "codex", name: "Codex", adapter: "Codex", protocol: "CLI · app-server", status: "online", caps: ["流式", "MCP", "Skill"], models: 3, agents: 2, last: "2 分钟前", icon: "terminal" },
  { id: "hermes", name: "Hermes", adapter: "Hermes", protocol: "ACP · stdio", status: "online", caps: ["流式", "MCP", "Skill", "插话"], models: 4, agents: 1, last: "5 分钟前", icon: "plug" },
  { id: "pi", name: "Pi", adapter: "Pi", protocol: "CLI · 会话文件", status: "offline", caps: ["流式", "MCP", "Skill"], models: 2, agents: 1, last: "昨天", icon: "box" },
  { id: "dsh", name: "DeepSeek Harness", adapter: "DeepSeek Harness", protocol: "CLI · dsh", status: "online", caps: ["流式", "MCP", "Skill"], models: 3, agents: 0, last: "1 小时前", icon: "layers" },
  { id: "omp", name: "Oh My Pi", adapter: "Oh My Pi", protocol: "CLI · Pi 协议族", status: "offline", caps: ["流式", "MCP"], models: 2, agents: 0, last: "3 天前", icon: "zap" },
];

const TOKEN_USAGE = {
  team: [
    { id: "host", input: 18200, output: 10200, cost: 0.42 },
    { id: "pm", input: 8100, output: 4500, cost: 0.18 },
    { id: "arch", input: 10400, output: 5900, cost: 0.24 },
    { id: "researcher", input: 6500, output: 3300, cost: 0.14 },
    { id: "critic", input: 0, output: 0, cost: 0 },
  ],
  solo: [{ id: "builder", input: 12400, output: 6800, cost: 0.31 }],
};

const TEAM_TRAJECTORY = [
  { time: "10:02", kind: "dispatch", text: "指挥者分派 → 产品经理、架构师、用户研究员" },
  { time: "10:07", kind: "round", text: "第 2 轮 · 交叉辩论" },
  { time: "10:10", kind: "interject", text: "用户插话：先不考虑成本" },
  { time: "10:12", kind: "ask", text: "用户研究员 @你 提问" },
];

const SOLO_TRAJECTORY = [
  { time: "10:42", kind: "dispatch", text: "读取设置页导航结构" },
  { time: "10:43", kind: "round", text: "修改 3 个文件" },
  { time: "10:44", kind: "converge", text: "输出变更说明与测试结果" },
];

const MEMORY = [
  { id: "m1", scope: "工作区", text: "Pizza 使用暖中性色与番茄红作为品牌点缀；主操作使用黑白体系。", updated: "今天" },
  { id: "m2", scope: "工作区", text: "所有面向用户的文案默认中文，保留英文结构。", updated: "今天" },
  { id: "m3", scope: "用户", text: "偏好先看结论，再看依据；不喜欢过长的开场白。", updated: "昨天" },
  { id: "m4", scope: "用户", text: "评审时优先指出可复现的失败路径，而不是风格问题。", updated: "3 天前" },
];

const ARCHIVED = [
  { id: "a1", title: "旧版设置页梳理", mode: "solo", target: "builder", time: "10 月 28 日" },
  { id: "a2", title: "Q3 路线图讨论", mode: "team", target: "brainstorm", time: "10 月 21 日" },
];

/* —— 团队会话：完整的头脑风暴回合 —— */
const TEAM_THREAD = [
  { type: "round", text: "第 1 轮 · 指挥者分派任务" },
  { type: "user", id: "u1", text: "我们要不要给 Pizza 加一个移动端？请评估。" },
  {
    type: "agent", id: "a1", agent: "host", role: "指挥者", time: "10:02",
    text: "目标：判断 Pizza 是否应该在 6 个月内推出移动端，以及最小可行形态。\n\n@产品经理 评估用户价值与场景；@架构师 评估技术成本与复用度；@用户研究员 给出证据与反例。请并行给出初稿，不要互相等待。",
  },
  {
    type: "agent", id: "a2", agent: "pm", role: "成员", time: "10:03",
    text: "**用户价值：中高。**\n- 移动端最可能的使用场景是「随时 @ 一下团队」，而不是完整开发。\n- 现有用户在通勤、会议间隙有碎片化协作需求。\n- 但完整的代码工程与 Git 面板不适合手机，应定位为「查看 + 指挥 + 轻回复」。\n\n建议先做**移动指挥台**，而不是完整客户端。",
  },
  {
    type: "agent", id: "a3", agent: "arch", role: "成员", time: "10:04",
    text: "**技术成本：高，但可分期。**\n- 现有渲染层可以复用设计系统与部分页面。\n- 桌面核心依赖本地 Go 服务、Postgres 与 daemon，移动端无法直接复用。\n- 需要新增远程中继，或让手机只作为桌面客户端的只读视图。\n\n| 方案 | 成本 | 风险 |\n| --- | --- | --- |\n| 手机连接桌面 | 中 | 离线不可用 |\n| 独立移动端 + 云端 | 高 | 架构分叉 |",
  },
  {
    type: "agent", id: "a4", agent: "researcher", role: "成员", time: "10:05",
    text: "**证据：需求存在，但优先级存疑。**\n- 访谈的 12 位用户中，9 位表示「愿意在手机上看进展」，只有 2 位愿意在手机上配置智能体。\n- 竞品移动端的使用集中在通知、审批和简短回复。\n- 反例：重度用户更希望桌面端稳定，而不是多一个客户端。",
  },
  { type: "round", text: "第 2 轮 · 交叉辩论" },
  {
    type: "agent", id: "a5", agent: "host", role: "指挥者", time: "10:07",
    text: "@架构师 请回应产品经理的「指挥台」定位：如果只做查看与轻回复，能否绕开 Postgres 依赖？\n\n@产品经理 请回应架构师的「手机连接桌面」方案：用户是否接受必须保持桌面在线？",
  },
  {
    type: "agent", id: "a6", agent: "arch", role: "成员", time: "10:08",
    text: "「指挥台」可以绕开一部分依赖，但无法完全绕开运行时。\n- 查看与轻回复可以走只读 API + 消息队列。\n- 一旦要在手机上触发智能体，就必须有可用的运行时。\n- 最务实的路径是「手机 → 桌面中继」，并把离线场景明确为不可用。",
  },
  {
    type: "agent", id: "a7", agent: "pm", role: "成员", time: "10:09",
    text: "用户能接受「桌面在线」作为早期限制，但需要明确提示。\n- 对 3–10 人团队，桌面通常是常开的。\n- 对个人用户，通勤场景恰好是桌面关闭的时候，这是最大冲突。\n\n建议先做「通知 + 审批 + 轻回复」，把触发智能体留到第二阶段。",
  },
  { type: "user", id: "u2", text: "先不考虑成本，重点看体验。", interjection: true },
  { type: "system", text: "用户插话 · 已送达指挥者" },
  {
    type: "agent", id: "a8", agent: "host", role: "指挥者", time: "10:11",
    text: "收到，更新约束：成本降为次要因素，优先判断体验价值。\n\n@用户研究员 如果不受成本限制，移动端最值得做的体验是什么？请给一个具体场景。",
  },
  {
    type: "agent", id: "a9", agent: "researcher", role: "成员", time: "10:12",
    text: "最值得做的是「在离开桌面前，把任务交给团队，然后在手机上收到收敛结果并做一次审批」。\n\n@我 目标用户是个人开发者，还是 3–10 人团队？这会改变优先级。",
  },
  {
    type: "waiting", id: "w1", agent: "researcher",
    text: "研究员问了一个会影响结论的问题。回复后，指挥者会继续收敛并生成最终文档。",
  },
];

/* —— 单智能体会话 —— */
const SOLO_THREAD = [
  { type: "user", id: "s1", text: "帮我给设置页加一个「已归档会话」入口，并补测试。" },
  {
    type: "agent", id: "s2", agent: "builder", role: "成员", time: "10:42",
    text: "我先看一下现有设置页的结构和导航注册方式。",
  },
  {
    type: "agent", id: "s3", agent: "builder", role: "成员", time: "10:42",
    text: "设置页的导航是集中注册的，我会新增一个 `archived` 分组，并复用现有的会话列表组件。计划：\n1. 新增 `/settings/archived` 页面\n2. 在设置导航加入口\n3. 复用 `ChatThreadList` 的归档视图\n4. 补一条导航渲染测试",
    tools: [
      { name: "Read", target: "packages/views/settings/components/settings-page.tsx", status: "ok", time: "1.2s", input: "{ path: \"settings-page.tsx\" }", output: "已读取 245 行，找到 entry() 注册点。" },
      { name: "Grep", target: "archived-sessions", status: "ok", time: "0.4s", input: "{ pattern: \"archived\", path: \"packages/views\" }", output: "3 个匹配：chat-thread-list.tsx、chat-session-header.tsx、settings-navigation.ts" },
      { name: "Edit", target: "settings-navigation.ts", status: "ok", time: "0.8s", input: "+ { id: \"archived\", label: \"已归档会话\", href: \"/settings/archived\" }", output: "已更新 1 处。" },
      { name: "Write", target: "archived-sessions-page.tsx", status: "ok", time: "0.6s", input: "{ lines: 18 }", output: "已创建页面组件。" },
      { name: "Bash", target: "pnpm test settings-navigation", status: "ok", time: "2.4s", input: "{ command: \"pnpm test settings-navigation\" }", output: "PASS  1 passed (1)\n  ✓ shows the archived sessions entry" },
    ],
  },
  {
    type: "agent", id: "s4", agent: "builder", role: "成员", time: "10:44",
    text: "已完成，变更如下：\n- `settings-navigation.ts` 新增「已归档会话」入口\n- `archived-sessions-page.tsx` 新页面\n- `settings-navigation.test.ts` 覆盖入口可见性\n\n右侧产出物里可以看到改动文件。需要我继续补一个空状态吗？",
  },
  { type: "artifact", id: "art-solo", artifact: "change-md", text: "变更说明.md", meta: "3 个文件 · 刚刚" },
];

const TEAM_SNAPSHOTS = [
  {
    id: "snap-2", name: "头脑风暴队 · v2", time: "今天 10:20", note: "加入「唱反调者」并收紧收敛条件",
    config: { name: "头脑风暴队", desc: "多角色发散、交叉辩论、由主持人收敛成文档", leader: "host", members: ["host", "pm", "arch", "researcher", "critic"], fanout: "并发", maxRounds: 5 },
  },
  {
    id: "snap-1", name: "头脑风暴队 · v1", time: "10 月 30 日", note: "初始配置：4 名成员，5 轮上限",
    config: { name: "头脑风暴队", desc: "多角色发散、交叉辩论、由主持人收敛成文档", leader: "host", members: ["host", "pm", "arch", "researcher"], fanout: "并发", maxRounds: 5 },
  },
];

const TEAM_TEMPLATES = [
  {
    id: "tpl-brainstorm", name: "头脑风暴队 · 新", desc: "多角色发散、交叉辩论、由主持人收敛成文档",
    leader: "host", members: ["host", "pm", "arch", "researcher", "critic"], fanout: "并发", maxRounds: 5, color: "#D9482B",
  },
  {
    id: "tpl-dev", name: "前后端开发队 · 新", desc: "先定接口契约，再并行实现，最后交叉评审",
    leader: "builder", members: ["builder", "reviewer", "arch", "pm"], fanout: "串行", maxRounds: 4, color: "#2563EB",
  },
  {
    id: "tpl-review", name: "评审队", desc: "多视角独立评审，汇总冲突后逐条裁决",
    leader: "reviewer", members: ["reviewer", "arch", "builder", "pm"], fanout: "并发", maxRounds: 3, color: "#16A34A",
  },
];

const QUICK_PROMPTS = [
  { icon: "users", title: "让团队评审这段代码", sub: "指挥者会分派给评审与测试角色" },
  { icon: "sparkle", title: "创建一个头脑风暴队", sub: "产品、架构、研究与反方" },
  { icon: "plug", title: "接入 Claude Code", sub: "检测本机 CLI 并测试连接" },
  { icon: "folder", title: "总结这个仓库", sub: "从 README 与目录结构开始" },
];
