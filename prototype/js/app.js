/* Pizza UI 原型：无构建、无依赖，使用 hash 路由与演示数据。 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = (v) => JSON.parse(JSON.stringify(v));
const nowTime = () => new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
let seq = 0;
const uid = () => `m${++seq}`;

const state = {
  route: "home",
  theme: "light",
  themeChoice: "light",
  sidebarCollapsed: false,
  rightOpen: true,
  rpTab: "trajectory",
  homeMode: "team",
  homeTarget: { team: "brainstorm", agent: "builder" },
  agentTab: "basic",
  previewTab: "prompt",
  teamTab: "members",
  settingsTab: "profile",
  selectedAgent: "host",
  selectedTeam: "brainstorm",
  selectedRuntime: "claude",
  draft: { team: "", solo: "", home: "" },
  pending: { team: [], solo: [], home: [] },
  threads: { team: clone(TEAM_THREAD), solo: clone(SOLO_THREAD) },
  picker: null,
  plusAnchor: null,
  runtimeTest: { status: "idle", step: 0, adapter: "claude", icon: "sparkle", avatar: "", transport: "stdio", url: "" },
  testTimer: null,
  streaming: { timer: null, key: null, id: null },
  teamConverged: false,
  preferredEditor: "vscode",
  lastRoute: null,
  accountAnchor: null,
  accountSubmenu: null,
  language: "简体中文",
  workspace: "pizza",
  defaultWorkspacePath: "~/Pizza",
  defaultRuntime: "pi",
  profileAvatar: "",
  activeSessionId: "mobile",
  commandPalette: { open: false, query: "", selected: 0 },
  artifactFilter: "",
  statsRange: "7d",
  openFolders: { docs: true },
  agentQuery: "",
  teamQuery: "",
  snapshots: clone(TEAM_SNAPSHOTS),
  toastTimer: null,
};

/* ---------- 基础渲染工具 ---------- */

function resolveTheme(choice) {
  if (choice === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return choice === "dark" ? "dark" : "light";
}

function applyTheme() {
  state.theme = resolveTheme(state.themeChoice);
  document.documentElement.dataset.theme = state.theme;
  try { localStorage.setItem("pizza-theme-choice", state.themeChoice); } catch (_) {}
  const btn = $("#themeBtn");
  if (btn) btn.innerHTML = icon(state.theme === "dark" ? "sun" : "moon", 16);
}

const AVATAR_RANDOM_COLORS = ["#D9482B", "#D97706", "#16A34A", "#2563EB", "#7C3AED", "#0EA5E9", "#DB2777"];

function randomAvatarDataUrl() {
  const color = AVATAR_RANDOM_COLORS[Math.floor(Math.random() * AVATAR_RANDOM_COLORS.length)];
  const keys = Object.keys(AVATAR_GLYPHS);
  const glyph = AVATAR_GLYPHS[keys[Math.floor(Math.random() * keys.length)]] || AVATAR_GLYPHS.star;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="${color}"/><g transform="translate(10.5 10.5) scale(.79)" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function agentAvatar(id, size = 40, withPresence = true) {
  const a = AGENTS[id];
  if (!a) return "";
  const glyph = AVATAR_GLYPHS[a.glyph] || AVATAR_GLYPHS.star;
  const presence = a.presence || "online";
  if (a.avatar) {
    return `<span class="avatar" style="width:${size}px;height:${size}px">
      <img class="agent-avatar-img" src="${esc(a.avatar)}" alt="${esc(a.name)}">
      ${withPresence ? `<span class="presence ${presence === "offline" ? "offline" : presence === "running" ? "running" : "online"}"></span>` : ""}
    </span>`;
  }
  return `<span class="avatar" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 40 40" role="img" aria-label="${esc(a.name)}">
      <rect width="40" height="40" rx="20" fill="${a.color}"/>
      <circle cx="31" cy="9" r="14" fill="#fff" opacity=".10"/>
      <g transform="translate(10.5 10.5) scale(.79)" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" opacity=".96">${glyph}</g>
    </svg>
    ${withPresence ? `<span class="presence ${presence === "offline" ? "offline" : presence === "running" ? "running" : "online"}"></span>` : ""}
  </span>`;
}

function userAvatar(size = 32) {
  if (state.profileAvatar) {
    return `<span class="avatar" style="width:${size}px;height:${size}px"><img class="agent-avatar-img" src="${esc(state.profileAvatar)}" alt="你"></span>`;
  }
  return `<span class="avatar" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 40 40" role="img" aria-label="你">
      <rect width="40" height="40" rx="20" fill="var(--surface-3)"/>
      <text x="20" y="25" text-anchor="middle" font-size="14" font-weight="600" fill="var(--ink-2)" font-family="var(--font-ui)">你</text>
    </svg>
  </span>`;
}

function teamAvatar(id, size = 40) {
  const t = TEAMS[id];
  if (!t) return "";
  if (t.avatar) return `<span class="avatar" style="width:${size}px;height:${size}px"><img class="agent-avatar-img" src="${esc(t.avatar)}" alt="${esc(t.name)}"></span>`;
  const mini = size <= 28 ? 12 : 17;
  const gap = 1;
  const members = t.members.slice(0, 4);
  const bg = `<rect width="${size}" height="${size}" rx="${size / 2}" fill="var(--surface-2)"/>`;
  const cells = members.map((m, i) => {
    const x = 2 + (i % 2) * (mini + gap);
    const y = 2 + Math.floor(i / 2) * (mini + gap);
    return `<g transform="translate(${x} ${y})">
      <circle cx="${mini / 2}" cy="${mini / 2}" r="${mini / 2}" fill="${AGENTS[m].color}"/>
      <text x="${mini / 2}" y="${mini / 2 + 3.2}" text-anchor="middle" font-size="${mini * .42}" font-weight="700" fill="#fff" font-family="var(--font-ui)">${esc(AGENTS[m].short)}</text>
    </g>`;
  }).join("");
  return `<span class="avatar" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(t.name)}">${bg}${cells}</svg>
  </span>`;
}

const AVATAR_GLYPHS = {
  star: '<path d="m12 3 2.4 5.4 5.9.6-4.4 3.9 1.3 5.8L12 15.9 6.8 18.7l1.3-5.8L3.7 9l5.9-.6z"/>',
  hex: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><path d="M12 8l3.5 2v4L12 16l-3.5-2v-4z"/>',
  leaf: '<path d="M5 19c8 0 14-5 14-14-9 0-14 5-14 14z"/><path d="M5 19c3-5 6-8 11-10"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  code: '<path d="m8 9-4 3 4 3"/><path d="m16 9 4 3-4 3"/><path d="m14 5-4 14"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
};

const EDITORS = [
  { id: "finder", name: "访达" },
  { id: "cursor", name: "Cursor" },
  { id: "vscode", name: "VS Code" },
  { id: "zed", name: "Zed" },
  { id: "intellij", name: "IntelliJ IDEA" },
  { id: "terminal", name: "终端" },
  { id: "warp", name: "Warp" },
];

function editorIcon(editor, size = 18) {
  const style = `width:${size}px;height:${size}px;border-radius:${Math.round(size * .24)}px;display:grid;place-items:center;flex:none;font-size:${Math.round(size * .42)}px;font-weight:700;line-height:1`;
  switch (editor.id) {
    case "finder": return `<span style="${style};background:#EAF1FF;color:#2F6FED">${icon("folder", Math.round(size * .62))}</span>`;
    case "cursor": return `<span style="${style};background:#171717;color:#fff">${icon("box", Math.round(size * .58))}</span>`;
    case "vscode": return `<span style="${style};background:#1F8EFA;color:#fff">${icon("code", Math.round(size * .6))}</span>`;
    case "zed": return `<span style="${style};background:#1C1C1C;color:#fff">Z</span>`;
    case "intellij": return `<span style="${style};background:linear-gradient(135deg,#FC4C4C,#A64CFF);color:#fff">IJ</span>`;
    case "terminal": return `<span style="${style};background:#151515;color:#EDEDED;font-family:var(--font-mono)">&gt;_</span>`;
    case "warp": return `<span style="${style};background:#B9D4E8;color:#1E3A52">${icon("wave", Math.round(size * .58))}</span>`;
    default: return `<span style="${style};background:var(--surface-2);color:var(--ink-2)">${icon("code", Math.round(size * .6))}</span>`;
  }
}

function currentEditor() {
  return EDITORS.find((e) => e.id === state.preferredEditor) || EDITORS[2];
}

function editorPill() {
  const e = currentEditor();
  return `<div class="editor-pill" title="用 ${esc(e.name)} 打开工作区">
    <button class="editor-pill-icon" data-action="open-editor">${editorIcon(e, 17)}</button>
    <span class="editor-pill-divider"></span>
    <button class="editor-pill-caret" data-action="open-editor-menu" aria-label="选择编辑器">${icon("chevron-down", 11)}</button>
  </div>`;
}

function openEditorMenu(anchor) {
  const rect = anchor.getBoundingClientRect();
  const width = 250;
  const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
  const top = Math.min(rect.bottom + 7, window.innerHeight - 320);
  $("#popover-root").innerHTML = `<div class="popover-layer" data-action="close-picker"></div>
    <div class="editor-menu" style="left:${left}px;top:${top}px;width:${width}px" role="listbox" aria-label="选择编辑器">
      ${EDITORS.map((e) => `<div class="editor-item" data-action="select-editor" data-editor="${e.id}" role="option">
        ${editorIcon(e, 20)}
        <span class="editor-name">${esc(e.name)}</span>
        ${state.preferredEditor === e.id ? `<span class="editor-check">${icon("check", 14)}</span>` : ""}
      </div>`).join("")}
    </div>`;
}

/* ---------- 轻量 Markdown ---------- */

function inline(raw) {
  let s = esc(raw);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s（(])\/([a-z][a-z0-9-]+)/g, (m, pre, cmd) => `${pre}<span class="mention skill">/${cmd}</span>`);
  s = s.replace(/@([一-龥A-Za-z0-9_]+)/g, (m, name) => {
    const a = Object.values(AGENTS).find((x) => x.name === name);
    if (a) return `<span class="mention" style="--c:${a.color}">${a.name}</span>`;
    if (name === "我" || name === "用户") return `<span class="mention me">@我</span>`;
    return m;
  });
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return s;
}

function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
}

function md(raw) {
  if (!raw) return "";
  const lines = String(raw).split("\n");
  const out = [];
  let i = 0;
  let para = [];
  let list = null;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.type}>${list.items.map((x) => `<li>${inline(x)}</li>`).join("")}</${list.type}>`);
      list = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      flushPara(); flushList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.trim() === "") { flushPara(); flushList(); i++; continue; }

    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      flushPara(); flushList();
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(splitRow(lines[i])); i++; }
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushPara(); flushList(); out.push(`<p><strong>${inline(h[2])}</strong></p>`); i++; continue; }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((ul || ol)[1]);
      i++;
      continue;
    }

    const bq = line.match(/^>\s?(.*)$/);
    if (bq) { flushPara(); flushList(); out.push(`<blockquote>${inline(bq[1])}</blockquote>`); i++; continue; }

    para.push(line.trim());
    i++;
  }
  flushPara(); flushList();
  return out.join("");
}

/* ---------- 路由 ---------- */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length) return { route: "home", params: {} };
  if (parts[0] === "chat") return { route: `chat/${parts[1] || "solo"}`, params: {} };
  if (parts[0] === "settings") return { route: "settings", params: { tab: parts[1] || "profile" } };
  if (["agents", "teams", "runtimes"].includes(parts[0]) && parts[1] === "edit") return { route: `${parts[0]}/edit`, params: {} };
  if (parts[0] === "runtimes" && parts[1] === "new") return { route: "runtimes/new", params: {} };
  return { route: parts[0], params: {} };
}

function navigate(hash) {
  if (location.hash === hash) { render(); return; }
  location.hash = hash;
}

function setRoute() {
  const parsed = parseHash();
  state.route = parsed.route;
  if (parsed.route === "settings") state.settingsTab = parsed.params.tab || "profile";
  const managementTabs = {
    agents: "agents",
    teams: "teams",
    skills: "skills",
    mcp: "mcp",
    runtimes: "runtimes",
    "agents/edit": "agent-edit",
    "teams/edit": "team-edit",
    "runtimes/new": "runtime-new",
  };
  if (managementTabs[parsed.route]) state.settingsTab = managementTabs[parsed.route];
  if (parsed.route === "chat/team") state.rightOpen = true;
  if (parsed.route.startsWith("chat/") && state.lastRoute !== parsed.route) {
    state.rpTab = parsed.route === "chat/team" ? "trajectory" : "artifacts";
  }
  state.lastRoute = parsed.route;
}

/* ---------- 侧边栏 ---------- */

function isSettingsShellRoute() {
  return ["settings", "agents", "agents/edit", "teams", "teams/edit", "skills", "mcp", "runtimes", "runtimes/new"].includes(state.route);
}

function sessionWorkspace(session) {
  return session.workspace || WORKSPACES[0]?.id;
}

function currentWorkspace() {
  return WORKSPACES.find((w) => w.id === state.workspace) || WORKSPACES[0];
}

function renderSidebar() {
  const side = $("#sideScroll");
  if (!side) return;
  $$(".brand-mark").forEach((el) => { el.innerHTML = brandMark(24); });
  const isSettings = isSettingsShellRoute();
  const ws = currentWorkspace();
  const wsBlock = (w) => {
    // 会话打开时只高亮会话本身，工作区行不再叠加选中背景
    const sessionOpen = state.route.startsWith("chat/") && !!state.activeSessionId;
    const isActive = w.id === state.workspace && !sessionOpen;
    const wsSessions = SESSIONS.filter((s) => sessionWorkspace(s) === w.id && !s.archived);
    return `<div class="ws-item ${isActive ? "active" : ""}" data-workspace="${w.id}" role="button" tabindex="0">
      <span class="ws-icon">${icon("folder", 14)}</span>
      <span class="ws-name">${esc(w.name)}</span>
      <button class="ws-more" data-action="workspace-menu" data-workspace="${w.id}" aria-label="工作区菜单">${icon("more", 13)}</button>
      <button class="ws-add" data-action="new-session-in-workspace" data-workspace="${w.id}" title="在 ${esc(w.name)} 中新建任务" aria-label="在 ${esc(w.name)} 中新建任务">${icon("plus", 13)}</button>
    </div>
    ${wsSessions.length ? wsSessions.map((s) => {
      const dotClass = s.status === "running" ? "running" : s.status === "waiting" ? "waiting" : "done";
      return `<div class="ws-session ${s.id === state.activeSessionId ? "active" : ""}" data-session="${s.id}" role="button" tabindex="0">
        <span class="ws-session-icon">${icon(s.mode === "team" ? "users" : "chat", 12)}</span>
        <span class="ws-preview-title">${esc(s.title)}</span>
        <button class="ws-session-more" data-action="session-menu" data-session="${s.id}" aria-label="会话菜单">${icon("more", 12)}</button>
        <span class="ws-session-dot ${dotClass}"></span>
      </div>`;
    }).join("") : `<div class="ws-empty">暂无任务 :)</div>`}`;
  };
  const pinnedWs = WORKSPACES.filter((w) => w.pinned);
  const normalWs = WORKSPACES.filter((w) => !w.pinned);
  const workspaceHtml = `
    ${pinnedWs.length ? `<div class="side-label ws-label"><span>置顶</span></div>${pinnedWs.map(wsBlock).join("")}` : ""}
    <div class="side-label ws-label"><span>工作区</span><button class="icon-btn" data-action="add-workspace" title="添加工作区">${icon("plus", 12)}</button></div>
    ${normalWs.map(wsBlock).join("")}`;
  $("#workspaceSection").innerHTML = workspaceHtml;

  side.innerHTML = "";

  $("#sidebarFooter").innerHTML = `
    <button class="footer-btn" data-nav="#/settings/profile">${icon("settings", 15)}<span>设置</span><span class="kbd-hint">⌘,</span></button>
    <button class="footer-btn" data-action="open-help-menu">${icon("help", 15)}<span>帮助</span></button>
    <div class="sidebar-account">
      <button class="sidebar-account-btn" data-action="open-account-menu">
        <span class="account-avatar">${state.profileAvatar ? `<img class="profile-avatar-img" src="${esc(state.profileAvatar)}" alt="头像">` : "你"}</span>
        <span class="account-text"><span class="account-name">Pizza 用户</span><span class="account-sub">本地工作区</span></span>
        ${icon("chevron-right", 12)}
      </button>
    </div>
  `;

  $("#sidebar").classList.toggle("collapsed", state.sidebarCollapsed);
  const collapseBtn = $("#collapseBtn");
  if (collapseBtn) {
    collapseBtn.innerHTML = icon("panel-left", 16);
    collapseBtn.title = state.sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏";
    collapseBtn.setAttribute("aria-label", collapseBtn.title);
  }
  document.body.classList.toggle("settings-mode", isSettings);
  $("#app").style.visibility = "visible";
}

/* ---------- 标题栏 ---------- */

function renderTitlebar() {
  const titles = {
    home: "Pizza",
    "chat/team": "Pizza · 团队对话",
    "chat/solo": "Pizza · 智能体对话",
    agents: "Pizza · 智能体",
    "agents/edit": "Pizza · 编辑智能体",
    teams: "Pizza · 智能体团队",
    "teams/edit": "Pizza · 编辑团队",
    runtimes: "Pizza · 运行时",
    "runtimes/new": state.runtimeTest.editingId ? "Pizza · 编辑运行时" : "Pizza · 添加运行时",
    skills: "Pizza · Skill",
    mcp: "Pizza · MCP",
    sessions: "Pizza · 会话",
    settings: "Pizza · 设置",
  };
  $("#titlebarTitle").textContent = titles[state.route] || "Pizza";
  $("#searchBtn").innerHTML = icon("search", 16);
  applyTheme();
}

/* ---------- 通用小片段 ---------- */

function statusDot(status) {
  const map = { online: "online", running: "running", waiting: "waiting", offline: "offline", error: "error" };
  return `<span class="status-dot ${map[status] || ""}"></span>`;
}

function roleBadge(role) {
  if (!role) return "";
  const color = role === "指挥者" ? "var(--brand)" : "var(--muted)";
  return `<span class="badge" style="height:17px;font-size:9px;color:${color};border-color:transparent;background:color-mix(in srgb, ${color} 9%, transparent)">${esc(role)}</span>`;
}

function toolHtml(t) {
  const failed = t.status === "failed";
  return `<div class="tool-call ${failed ? "failed" : ""}">
    <div class="tool-call-head" data-action="toggle-tool">
      ${icon("terminal", 13)}
      <span class="tool-call-name">${esc(t.name)}</span>
      <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.target || "")}</span>
      <span class="tool-call-status ${failed ? "" : "ok"}">${failed ? icon("alert", 11) : icon("check", 11)} ${esc(t.time || "")}</span>
    </div>
    <div class="tool-call-body">${esc(t.input || "")}${t.output ? "\n\n" + esc(t.output) : ""}</div>
  </div>`;
}

function messageHtml(m) {
  if (m.type === "system") return `<div class="system-msg">${esc(m.text)}</div>`;
  if (m.type === "round") return `<div class="round-divider">${esc(m.text)}</div>`;
  if (m.type === "waiting") {
    const a = AGENTS[m.agent];
    return `<div class="waiting-card">
      <span class="waiting-icon">${icon("clock", 19)}</span>
      <div style="flex:1">
        <div class="waiting-title">等待你回复 · ${esc(a ? a.name : "智能体")}</div>
        <div class="waiting-text">${esc(m.text)}</div>
        <div class="waiting-actions">
          <button class="btn btn-sm btn-primary" data-action="focus-input">回复</button>
          <button class="btn btn-sm btn-ghost" data-action="continue-team">让指挥者继续</button>
        </div>
      </div>
    </div>`;
  }
  if (m.type === "artifact") {
    return `<div class="artifact-callout" data-action="open-artifact" data-artifact="${m.artifact}" data-key="${state.route === "chat/team" ? "team" : "solo"}">
      <span class="artifact-icon">${icon("file-text", 17)}</span>
      <div><div class="artifact-name">${esc(m.text)}</div><div class="artifact-meta">${esc(m.meta)}</div></div>
      ${icon("chevron-right", 15, 1.5)}
    </div>`;
  }
  if (m.type === "user") {
    return `<div class="msg msg-user" data-msg-id="${m.id}">
      <div class="bubble">${inline(m.text)}</div>
    </div>`;
  }
  const a = AGENTS[m.agent] || AGENTS.builder;
  const running = m.state === "running";
  const cancelled = m.state === "cancelled";
  return `<div class="msg msg-agent" data-msg-id="${m.id}">
    <div class="msg-avatar">${agentAvatar(m.agent, 40)}</div>
    <div class="msg-main">
      <div class="msg-head">
        <span class="msg-name">${esc(a.name)}</span>
        ${m.role ? `<span class="role-tag" style="--c:${a.color}">${esc(m.role)}</span>` : ""}
        <span class="msg-time">${esc(m.time || "")}</span>
        ${running ? `<span class="msg-state">${icon("loader", 11)} 正在工作</span>` : ""}
        ${cancelled ? `<span class="msg-state">已停止</span>` : ""}
      </div>
      <div class="msg-content">${md(m.text)}${running ? '<span class="stream-cursor"></span>' : ""}</div>
      ${(m.tools || []).map(toolHtml).join("")}
      <div class="msg-actions">
        <button class="mini-btn" data-action="copy-msg" data-msg-id="${m.id}">${icon("copy", 12)} 复制</button>
        <button class="mini-btn" data-action="quote-msg" data-msg-id="${m.id}">${icon("chat", 12)} 引用</button>
        ${!running ? `<button class="mini-btn" data-action="retry-msg" data-msg-id="${m.id}">${icon("refresh", 12)} 重试</button>` : ""}
      </div>
    </div>
  </div>`;
}

/* ---------- 首页 ---------- */

function homeHtml() {
  const team = state.homeMode === "team";
  const ws = currentWorkspace();
  const target = team ? TEAMS[state.homeTarget.team] : AGENTS[state.homeTarget.agent];
  const activeCount = SESSIONS.filter((s) => sessionWorkspace(s) === ws.id && s.status !== "done").length;
  const pinned = !!ws.pinned;
  return `<div class="home">
    <div class="workspace-hero">
      <div class="workspace-hero-left"><span class="workspace-hero-icon">${icon("folder", 16)}</span><div><div class="workspace-hero-name">${esc(ws.name)}</div><div class="workspace-hero-path">${esc(ws.path)}</div></div></div>
      <div class="workspace-hero-right"><span class="badge">${activeCount} 个活跃</span><button class="icon-btn ${pinned ? "active" : ""}" data-action="pin-workspace" data-workspace="${ws.id}" title="置顶工作区">${icon("pin", 15)}</button></div>
    </div>
    <div class="home-inner">
      <div class="home-mark">${brandMark(46)}</div>
      <h1 class="home-title">今天想切成哪一块？</h1>
      <p class="home-sub">选一个智能体，或拉一支团队，从一句话开始。</p>
      <div class="home-card">
        <div class="home-card-top">
          <button class="participant-btn" data-action="pick-target" title="选择参与者">
            ${team ? teamAvatar(state.homeTarget.team, 26) : agentAvatar(state.homeTarget.agent, 26, false)}
            <span class="participant-text"><span class="participant-label">参与者</span><span class="participant-name">${esc(target.name)}</span></span>
            ${icon("chevron-down", 12)}
          </button>
          <span class="composer-spacer"></span>
          <span class="badge">${team ? "团队 · 指挥者默认接管" : "单智能体 · 直接对话"}</span>
        </div>
        ${pendingChipsHtml("home")}
        <textarea id="homeInput" rows="3" placeholder="描述你要解决的问题，输入 @ 可以指定智能体，/ 引用 Skill…">${esc(state.draft.home || "")}</textarea>
        <div class="home-card-bottom">
          <button class="tool-btn" data-action="open-plus" title="添加文件、Skill 或上下文">${icon("plus", 17)}</button>
          <button class="tool-btn" data-action="toast" data-msg="输入 @ 选择智能体" title="@ 提及">${icon("at", 17)}</button>
          <button class="tool-btn" data-action="toast" data-msg="输入 / 引用 Skill" title="引用 Skill">${icon("slash", 17)}</button>
          <button class="home-workspace" data-action="choose-workspace-folder" title="选择工作区文件夹">${icon("folder", 14)} ${esc(ws.name)}</button>
          <span class="composer-spacer"></span>
          <button class="send-btn" data-action="send-home" title="开始对话">${icon("arrow-up", 16)}</button>
        </div>
      </div>
      <div class="suggestions">
        ${QUICK_PROMPTS.map((p) => `<button class="suggestion" data-action="fill-prompt" data-prompt="${esc(p.title)}">
          <span class="suggestion-icon">${icon(p.icon, 17)}</span>
          <span><span>${esc(p.title)}</span><span class="suggestion-sub">${esc(p.sub)}</span></span>
        </button>`).join("")}
      </div>
      <div class="recent-block">
        <div class="recent-head"><span>最近会话</span></div>
        <div class="recent-list">
          ${SESSIONS.filter((s) => sessionWorkspace(s) === state.workspace).slice(0, 3).map((s) => `<div class="recent-item" data-session="${s.id}">
            ${s.mode === "team" ? teamAvatar(s.target, 24) : agentAvatar(s.target, 24, false)}
            <span class="recent-title">${esc(s.title)}</span>
            <span class="badge">${s.mode === "team" ? "团队" : "智能体"}</span>
            <span class="recent-time">${esc(s.time)}</span>
          </div>`).join("") || `<div class="ws-empty" style="margin:4px 2px">这个工作区还没有会话 :)</div>`}
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------- 会话 ---------- */

function chatHeaderHtml(key) {
  const team = key === "team";
  const active = SESSIONS.find((s) => s.id === state.activeSessionId);
  const parent = active?.forkedFrom ? SESSIONS.find((s) => s.id === active.forkedFrom) : null;
  const forkBadge = active?.forkedFrom ? `<span class="badge" title="分叉自 ${esc(parent?.title || "已删除的会话")}">${icon("fork", 10)} 分叉</span>` : "";
  if (team) {
    const t = TEAMS[state.selectedTeam];
    return `<header class="chat-header">
      <div class="chat-head-main">
        ${teamAvatar(t.id, 38)}
        <div class="chat-head-text">
          <div class="chat-head-title">${esc(t.name)} <span class="badge badge-accent">团队模式</span> ${forkBadge}</div>
          <div class="chat-head-sub">${statusDot(state.teamConverged ? "online" : "running")} 指挥者 ${esc(AGENTS[t.leader].name)} · ${t.members.length} 名成员 · ${state.teamConverged ? "已收敛 · 文档已生成" : "第 2 轮"}</div>
        </div>
        <div class="avatar-stack" style="margin-left:4px">
          ${t.members.map((id) => agentAvatar(id, 26, false)).join("")}
        </div>
      </div>
      <div class="chat-head-actions">
        ${editorPill()}
        <button class="icon-btn" data-action="open-command-palette" title="搜索 ⌘K">${icon("search", 16)}</button>
        <button class="btn btn-sm" data-action="stop-all">${icon("stop", 12)} 停止</button>
        <button class="icon-btn" data-action="toggle-panel" title="右侧栏">${icon("panel-right", 16)}</button>
      </div>
    </header>`;
  }
  const activeSession = SESSIONS.find((s) => s.id === state.activeSessionId);
  const soloId = activeSession?.mode === "solo" ? activeSession.target : (state.selectedAgent || "builder");
  const a = AGENTS[soloId] || AGENTS.builder;
  return `<header class="chat-header">
    <div class="chat-head-main">
      ${agentAvatar(soloId, 38)}
      <div class="chat-head-text">
        <div class="chat-head-title">${esc(a.name)} <span class="badge">智能体模式</span> ${forkBadge}</div>
        <div class="chat-head-sub">${statusDot("online")} ${esc(a.desc)}</div>
      </div>
    </div>
    <div class="chat-head-actions">
      ${editorPill()}
      <button class="icon-btn" data-action="open-command-palette" title="搜索 ⌘K">${icon("search", 16)}</button>
      <button class="btn btn-sm" data-action="stop-all">${icon("stop", 12)} 停止</button>
      <button class="icon-btn" data-action="toggle-panel" title="右侧栏">${icon("panel-right", 16)}</button>
    </div>
  </header>`;
}

function pendingChipsHtml(key) {
  const pending = state.pending[key] || [];
  if (!pending.length) return "";
  return `<div class="composer-chips">${pending.map((p) => `<span class="composer-chip ${p.type === "skill" ? "skill" : ""}">
    ${p.type === "skill" ? icon("wand", 11) : p.type === "mcp" ? icon("plug", 11) : icon("file", 11)}
    ${esc(p.label)}
    <button data-action="remove-pending" data-id="${p.id}" aria-label="移除">${icon("x", 10)}</button>
  </span>`).join("")}</div>`;
}

function composerHtml(key) {
  const team = key === "team";
  const teamTarget = TEAMS[state.selectedTeam];
  const activeSession = SESSIONS.find((s) => s.id === state.activeSessionId);
  const soloId = activeSession?.mode === "solo" ? activeSession.target : (state.selectedAgent || "builder");
  const target = team ? AGENTS[teamTarget.leader] : (AGENTS[soloId] || AGENTS.builder);
  const stopped = !!state.streaming.timer;
  return `<div class="composer-wrap">
    <div class="composer">
      <div class="composer-route">${icon("at", 12)} 发送给 <strong>@${esc(target.name)}</strong>
        ${team ? `<span class="badge" style="height:16px;font-size:9px">指挥者</span>` : ""}
        <span class="route-mode">
          <button class="route-mode-btn active">排队</button>
          <button class="route-mode-btn" data-action="toast" data-msg="立即插话需要运行时支持；不支持时会降级为排队">插话</button>
        </span>
      </div>
      ${pendingChipsHtml(key)}
      <textarea id="composerInput" data-key="${key}" rows="1" placeholder="输入消息，@ 指定成员，/ 引用 Skill…">${esc(state.draft[key] || "")}</textarea>
      <div class="composer-toolbar">
        <button class="tool-btn" data-action="open-plus" title="添加文件、Skill 或上下文">${icon("plus", 17)}</button>
        <button class="tool-btn" data-action="open-mention" title="@ 指定成员">${icon("at", 17)}</button>
        <button class="tool-btn" data-action="open-slash" title="/ 引用 Skill">${icon("slash", 17)}</button>
        <button class="workspace-chip" data-action="choose-workspace-folder" title="选择工作区文件夹">${icon("folder", 14)} <span class="workspace-chip-name">${esc(currentWorkspace().name)}</span></button>
        <span class="composer-spacer"></span>
        <button class="send-btn ${stopped ? "stop" : ""}" data-action="${stopped ? "stop-all" : "send"}" title="${stopped ? "停止" : "发送"}">${icon(stopped ? "stop" : "arrow-up", 16)}</button>
      </div>
    </div>
  </div>`;
}

function chatHtml(key) {
  const thread = state.threads[key];
  return `<div class="chat-shell">
    ${chatHeaderHtml(key)}
    <div class="chat-body" id="chatBody">
      <div class="messages">${thread.map(messageHtml).join("")}</div>
    </div>
    ${composerHtml(key)}
  </div>`;
}

function scrollBottom() {
  const body = $("#chatBody");
  if (body) body.scrollTop = body.scrollHeight;
}

/* ---------- 智能体列表 / 编辑 ---------- */

function agentsPage() {
  const q = state.agentQuery.toLowerCase();
  const agents = Object.values(AGENTS);
  const list = agents.filter((a) => !q || a.name.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q));
  const statusText = (a) => a.presence === "running" ? "工作中" : a.presence === "offline" ? "离线" : a.presence === "waiting" ? "等待你" : "在线";
  return `<div class="page"><div class="page-inner">
    <header class="manage-head">
      <div class="manage-head-left">${icon("cpu", 16)} 智能体 <span class="badge">${agents.length}</span></div>
      <div class="manage-head-actions">
        <button class="icon-btn" data-action="toast" data-msg="搜索智能体（原型演示）" title="搜索">${icon("search", 16)}</button>
        <button class="icon-btn" data-action="toast" data-msg="筛选智能体（原型演示）" title="筛选">${icon("filter", 16)}</button>
        <button class="btn btn-sm btn-primary" data-action="new-agent">${icon("plus", 13)} 新建</button>
      </div>
    </header>
    <div class="manage-toolbar">
      <label class="search-input" style="flex:1;max-width:340px">${icon("search", 14)}<input id="agentSearch" placeholder="搜索智能体…" value="${esc(state.agentQuery)}"></label>
      <button class="filter-chip active">全部 ${agents.length}</button>
      <button class="filter-chip" data-action="toast" data-msg="在线筛选（原型演示）">在线 5</button>
      <button class="filter-chip" data-action="toast" data-msg="离线筛选（原型演示）">离线 1</button>
      <span style="flex:1"></span>
      <span class="badge">${icon("layers", 11)} 5 个运行时</span>
    </div>
    <div class="card" style="overflow:hidden">
      <div class="list-head"><span></span><span>智能体</span><span>状态</span><span>运行时</span><span>模型</span><span>最近活跃</span><span>运行次数</span><span></span></div>
      ${list.map((a) => `<div class="agent-row" data-agent="${a.id}">
        ${agentAvatar(a.id, 36)}
        <div style="min-width:0"><div class="name-line">${esc(a.name)} <span style="font-weight:400;color:var(--muted);font-size:10.5px">你</span> ${a.id === "host" ? `<span class="badge badge-accent" style="height:16px;font-size:9px">指挥者</span>` : ""}</div><div class="desc-line">${esc(a.desc)}</div></div>
        <div class="cell">${statusDot(a.presence)} ${statusText(a)}</div>
        <div class="cell">${icon("plug", 13)} ${esc(a.runtime)}</div>
        <div class="cell muted">${esc(a.model || "由运行时管理")}</div>
        <div class="cell muted">${a.presence === "running" ? "3 天前" : a.presence === "offline" ? "1 周前" : "刚刚"}</div>
        <div class="cell muted">${a.id === "host" ? 11 : a.id === "builder" ? 8 : 3}</div>
        <button class="icon-btn row-action" data-action="delete-agent" data-id="${a.id}" title="删除智能体" aria-label="删除 ${esc(a.name)}">${icon("trash", 14)}</button>
      </div>`).join("")}
    </div>
  </div></div>`;
}

function agentEditor() {
  const a = AGENTS[state.selectedAgent] || AGENTS.host;
  const tabs = [
    ["basic", "基本资料", "user"],
    ["runtime", "运行时", "plug"],
    ["instructions", "指令", "file-text"],
    ["capabilities", "能力", "layers"],
    ["behavior", "行为", "settings"],
  ];
  return `<div class="page"><div class="page-inner" style="max-width:1240px">
    <header class="page-header">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="icon-btn" data-nav="#/settings/agents" title="返回">${icon("arrow-left", 17)}</button>
        <div><div class="page-eyebrow">Agents / ${esc(a.name)}</div><h1 class="page-title">编辑智能体</h1></div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" data-nav="#/settings/agents">取消</button>
        <button class="btn btn-primary" data-action="save-agent">${icon("check", 14)} 保存</button>
      </div>
    </header>
    <div class="editor-layout">
      <nav class="editor-nav">
        ${tabs.map(([id, label, ic]) => `<button class="editor-nav-item ${state.agentTab === id ? "active" : ""}" data-action="agent-tab" data-tab="${id}">${icon(ic, 15)} ${label}${id === "instructions" ? '<span class="badge">P0</span>' : ""}</button>`).join("")}
        <div style="height:1px;background:var(--line);margin:8px 0"></div>
        <button class="editor-nav-item" data-action="toast" data-msg="复制智能体（原型演示）">${icon("copy", 15)} 复制</button>
        <button class="editor-nav-item" style="color:var(--red)" data-action="toast" data-msg="归档前会提示受影响的团队与会话">${icon("archive", 15)} 归档</button>
      </nav>
      <div>
        ${agentTabContent(a, state.agentTab)}
      </div>
      ${agentPreview(a)}
    </div>
  </div></div>`;
}

function agentTabContent(a, tab) {
  if (tab === "basic") {
    return `<section class="form-section">
      <div class="form-section-title">${icon("user", 15)} 身份</div>
      <div class="field">
        <div class="field-label">头像</div>
        <div class="avatar-picker">
          <div class="avatar-preview" data-action="upload-agent-avatar" role="button" tabindex="0" title="点击上传头像">${a.avatar ? `<img class="agent-avatar-img" src="${esc(a.avatar)}" alt="智能体头像">` : agentAvatar(a.id, 60, false)}</div>
          <div>
            <div class="avatar-presets">${[["star", "#D9482B"], ["sun", "#D97706"], ["leaf", "#16A34A"], ["hex", "#2563EB"], ["bolt", "#7C3AED"]].map(([g, color]) => `<button class="avatar-preset ${!a.avatar && a.color === color && a.glyph === g ? "active" : ""}" data-action="select-avatar-preset" data-color="${color}" data-glyph="${g}" title="使用该头像" style="background:${color}"></button>`).join("")}</div>
            <div class="avatar-actions"><button class="btn btn-sm" data-action="randomize-agent-avatar">${icon("refresh", 12)} 随机生成</button></div><div class="field-help" style="margin-top:7px">点击预览上传方形图片（≤2MB），或选择角色色。</div>
          </div>
        </div>
      </div>
      <div class="field"><div class="field-label">名称</div><input class="input" value="${esc(a.name)}"><div class="field-help">会话内唯一；重名会自动追加序号。</div></div>
      <div class="field"><div class="field-label">描述 <span class="hint">用于指挥者选择成员</span></div><input class="input" value="${esc(a.desc)}"></div>
      <div class="field"><div class="field-label">对话开场白 <span class="hint">最多 3 条 · P1</span></div>
        <div class="chip-list"><span class="chip">${icon("chat", 12)} 先给我结论</span><span class="chip">${icon("chat", 12)} 列出风险</span><button class="chip" style="border-style:dashed;color:var(--muted)" data-action="toast" data-msg="添加开场白（原型演示）">${icon("plus", 12)} 添加</button></div>
      </div>
    </section>
    <section class="form-section">
      <div class="form-section-title">${icon("folder", 15)} 工作区</div>
      <div class="field"><div class="field-label">默认工作目录</div><input class="input" value="~/Pizza"></div>
    </section>`;
  }
  if (tab === "runtime") {
    return `<section class="form-section">
      <div class="form-section-title">${icon("plug", 15)} 运行时与模型</div>
      <div class="field"><div class="field-label">运行时</div>
        <div class="member-card" style="margin:0">
          <span class="runtime-icon">${icon("sparkle", 17)}</span>
          <div class="member-info"><div class="member-name">Claude Code ${statusDot("online")} <span class="badge badge-green">在线</span></div><div class="member-desc">CLI · stream-json · 支持 MCP / Skill / 插话</div></div>
          <button class="btn btn-sm" data-nav="#/runtimes">更换</button>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><div class="field-label">模型</div><select class="select"><option>Claude Sonnet 4.5</option><option>Claude Opus 4.5</option><option>由运行时管理</option></select></div>
        <div class="field"><div class="field-label">并发上限</div><input class="input" type="number" value="3" min="1" max="10"></div>
      </div>
      <div class="field"><div class="field-label">思考强度</div>
        <div class="segmented">${["最低", "低", "中", "高", "最高"].map((x) => `<button class="${x === a.thinking ? "active" : ""}" data-action="toast" data-msg="思考强度：${x}">${x}</button>`).join("")}</div>
        <div class="field-help">由运行时能力决定；不支持时会禁用。</div>
      </div>
      <div class="field"><div class="field-label">自定义环境变量与参数 <span class="hint">P1</span></div>
        <div class="card" style="padding:12px;color:var(--muted);font-size:11.5px">未配置。敏感值保存在系统钥匙串，不写入日志。</div>
      </div>
    </section>`;
  }
  if (tab === "instructions") {
    return `<section class="form-section">
      <div class="form-section-title">${icon("file-text", 15)} 指令来源</div>
      <div class="field">
        <div class="card" style="padding:12px;display:flex;gap:10px;align-items:flex-start;border-color:var(--line-strong)">
          <input type="radio" checked style="margin-top:3px">
          <div><div style="font-size:12px;font-weight:600">模式一：自带初始 Prompt</div><div class="field-help">成员使用自己保存的角色、边界与输出格式。P0 默认。</div></div>
        </div>
        <div class="card" style="padding:12px;display:flex;gap:10px;align-items:flex-start;margin-top:7px;opacity:.55">
          <input type="radio" disabled style="margin-top:3px">
          <div><div style="font-size:12px;font-weight:600">模式二：指挥者动态下发 <span class="badge">P1</span></div><div class="field-help">不预设角色 Prompt，每次由指挥者下发完整角色指令。</div></div>
        </div>
      </div>
    </section>
    <section class="form-section">
      <div class="form-section-title">${icon("wand", 15)} 初始 Prompt</div>
      <div class="field">
        <textarea class="textarea mono" id="agentPrompt">你是 ${a.name}，${a.desc}。

职责：
- 在你的专业范围内给出明确判断，不代替其他成员作答。
- 观点必须带依据；不同意时给出具体反驳与新论据。
- 需要用户拍板时，@我 并提出一个具体问题。

输出格式：
- 先给结论，再给依据。
- 不确定的地方标注「待确认」。</textarea>
        <div class="field-help">支持变量：{{team.name}}、{{team.roster}}、{{workspace.path}}、{{round}}。</div>
        <div class="chip-list" style="margin-top:8px">${["{{team.roster}}", "{{workspace.path}}", "{{round}}"].map((v) => `<button class="chip" data-action="toast" data-msg="已插入变量 ${v}">${v}</button>`).join("")}</div>
      </div>
      <div class="field"><div class="field-label">模板库</div><div class="chip-list">${["通用助手", "前端工程师", "评审者", "唱反调者"].map((x) => `<button class="chip" data-action="toast" data-msg="已应用模板：${x}">${x}</button>`).join("")}</div></div>
    </section>`;
  }
  if (tab === "capabilities") {
    const skills = SKILLS.map((s) => ({ ...s, on: a.skills.includes(s.id) }));
    const mcps = MCPS.map((m) => ({ ...m, on: a.mcp.includes(m.id) }));
    return `<section class="form-section">
      <div class="form-section-title">${icon("wand", 15)} Skill</div>
      <div class="form-section-sub">Skill 是解决某一类工作的方法包；可挂载到多个智能体。</div>
      <div class="card" style="padding:4px 12px">
        ${skills.map((s) => `<div class="switch-row">
          <div class="switch-text"><div class="switch-title">${esc(s.name)} <span style="font-family:var(--font-mono);font-weight:400;color:var(--muted);font-size:10.5px">${s.cmd}</span></div><div class="switch-desc">${esc(s.desc)}</div></div>
          <button class="switch ${s.on ? "on" : ""}" data-action="toggle-switch" aria-label="切换 ${esc(s.name)}"></button>
        </div>`).join("")}
      </div>
      <div style="margin-top:8px"><button class="btn btn-sm" data-nav="#/settings/skills">${icon("wand", 13)} 管理工作区 Skill</button></div>
    </section>
    <section class="form-section">
      <div class="form-section-title">${icon("plug", 15)} MCP 工具</div>
      <div class="form-section-sub">三层合并：智能体自有 &gt; 工作区库绑定 &gt; 运行时本地配置。</div>
      <div class="card" style="padding:4px 12px">
        ${mcps.map((m) => `<div class="switch-row">
          <div class="switch-text"><div class="switch-title">${esc(m.name)} <span class="badge" style="height:16px;font-size:9px">${esc(m.transport)}</span></div><div class="switch-desc">${esc(m.desc)} · ${m.tools} 个工具</div></div>
          <button class="switch ${m.on ? "on" : ""}" data-action="toggle-switch" aria-label="切换 ${esc(m.name)}"></button>
        </div>`).join("")}
      </div>
      <div style="margin-top:8px"><button class="btn btn-sm" data-nav="#/settings/mcp">${icon("plug", 13)} 管理 MCP 服务器</button></div>
    </section>`;
  }
  return `<section class="form-section">
    <div class="form-section-title">${icon("settings", 15)} 上下文</div>
    <div class="field"><div class="field-label">上下文压缩阈值 <span class="hint">达到后摘要旧消息</span></div>
      <div class="range-row"><input type="range" min="100000" max="200000" step="100000" value="200000" id="contextRange"><span class="range-value" id="contextValue">200k</span></div>
      <div class="field-help">永不压缩：当前任务、未决问题、产出物路径、用户要求保留的内容。</div>
    </div>
    <div class="field-row">
      <div class="field"><div class="field-label">保留最近消息</div><input class="input" type="number" value="20"></div>
      <div class="field"><div class="field-label">单次运行超时</div><input class="input" value="30 分钟"></div>
    </div>
  </section>
  <section class="form-section">
    <div class="form-section-title">${icon("shield", 15)} 权限与审批</div>
    <div class="field"><div class="field-label">工作区访问</div><select class="select"><option>仅当前工作目录</option><option>工作区根目录</option><option>自定义路径…</option></select></div>
    <div class="field"><div class="field-label">危险工具调用</div>
      <div class="segmented"><button class="active">每次询问</button><button>总是允许</button><button>禁止</button></div>
      <div class="field-help">默认每次询问。拒绝会作为工具结果返回给智能体，并记入审计。</div>
    </div>
  </section>`;
}

function agentPreview(a) {
  const prompt = `你是 ${a.name}，${a.desc}。

你是团队「头脑风暴队」的成员。团队名单：
- 主持人（指挥者）：拆解问题、组织辩论、收敛结论
- 产品经理：用户价值、场景取舍、优先级
- 架构师：技术方案、成本、可演进性
- 用户研究员：证据、访谈、反例与边界

当前任务：评估是否推出移动端。
工作区：~/Pizza
当前轮次：第 2 轮

规则：
- 先给结论，再给依据。
- 不同意时给出具体反驳与新论据。
- 需要用户拍板时，@我 并提出一个具体问题。
- 输出 Markdown。`;
  return `<aside class="preview-panel">
    <div class="preview-head">${icon("eye", 14)} 最终生效配置</div>
    <div class="preview-tabs">
      <button class="preview-tab ${state.previewTab === "prompt" ? "active" : ""}" data-action="preview-tab" data-tab="prompt">Prompt</button>
      <button class="preview-tab ${state.previewTab === "test" ? "active" : ""}" data-action="preview-tab" data-tab="test">测试对话</button>
    </div>
    ${state.previewTab === "prompt" ? `<div class="prompt-preview">${esc(prompt)}</div>
      <div class="preview-meta"><span class="badge">${a.runtime}</span><span class="badge">思考 ${a.thinking}</span><span class="badge">200k</span><span class="badge">${a.skills.length} Skill</span><span class="badge">${a.mcp.length} MCP</span></div>`
      : `<div style="font-size:11.5px;line-height:1.7;color:var(--ink-2)">
          <div style="padding:8px 10px;border-radius:8px;background:var(--surface-2);margin-bottom:8px">帮我检查这段代码的边界条件。</div>
          <div style="padding:8px 10px;border-radius:8px;border:1px solid var(--line)">我会先定位输入校验与失败路径，再给出最小修复建议。<br><span style="color:var(--muted);font-size:10px">测试运行仅用于验证配置，不写入正式会话。</span></div>
          <button class="btn btn-sm" style="margin-top:10px" data-action="toast" data-msg="测试消息已发送（原型演示）">${icon("play", 12)} 发送测试</button>
        </div>`}
  </aside>`;
}

/* ---------- 团队 ---------- */

function teamsPage() {
  const q = state.teamQuery.toLowerCase();
  const list = Object.values(TEAMS).filter((t) => !q || t.name.toLowerCase().includes(q));
  return `<div class="page"><div class="page-inner">
    <header class="page-header">
      <div><div class="page-eyebrow">Teams</div><h1 class="page-title">智能体团队</h1><p class="page-sub">一个指挥者，一组成员，围绕会话协同完成一件事。</p></div>
      <div class="page-actions"><button class="btn" data-action="toast" data-msg="团队模板（原型演示）">${icon("layers", 14)} 从模板创建</button><button class="btn btn-primary" data-nav="#/teams/edit">${icon("plus", 14)} 新建团队</button></div>
    </header>
    <div class="toolbar">
      <label class="search-input">${icon("search", 14)}<input id="teamSearch" placeholder="搜索团队…" value="${esc(state.teamQuery)}"></label>
      <button class="filter-chip active">全部 ${Object.keys(TEAMS).length}</button>
      <button class="filter-chip" data-action="toast" data-msg="按最近使用筛选（原型演示）">最近使用</button>
    </div>
    <div class="team-grid">
      ${list.map((t) => `<div class="team-card" data-team="${t.id}">
        <div class="team-card-head">${teamAvatar(t.id, 44)}<div style="flex:1;min-width:0"><div class="team-card-name">${esc(t.name)} ${t.snapshots ? `<span class="badge">${t.snapshots} 快照</span>` : ""}</div><div class="team-card-desc">${esc(t.desc)}</div></div><button class="icon-btn row-action" data-action="delete-team" data-id="${t.id}" title="删除团队" aria-label="删除 ${esc(t.name)}">${icon("trash", 14)}</button></div>
        <div class="team-card-foot"><span class="badge badge-accent">指挥者 ${esc(AGENTS[t.leader].name)}</span><span>${t.members.length} 名成员</span><span style="margin-left:auto">${esc(t.last)}</span></div>
      </div>`).join("")}
      <button class="team-card" style="border-style:dashed;background:transparent;display:flex;align-items:center;justify-content:center;min-height:150px;color:var(--muted);gap:8px" data-nav="#/teams/edit">${icon("plus", 18)} 新建团队</button>
    </div>
    <div style="margin-top:26px">
      <div class="recent-head" style="padding-left:0"><span>模板</span></div>
      <div class="team-grid">
        ${TEAM_TEMPLATES.map((tpl) => `<div class="team-card" style="cursor:default"><div class="team-card-name">${esc(tpl.name)} <span class="badge">P1</span></div><div class="team-card-desc">${esc(tpl.desc)}</div><div class="team-card-foot"><span>${tpl.members.length} 名成员</span><button class="btn btn-sm" style="margin-left:auto" data-action="use-template" data-template="${tpl.id}">使用</button></div></div>`).join("")}
      </div>
    </div>
  </div></div>`;
}

function teamEditor() {
  const t = TEAMS[state.selectedTeam];
  const tabs = [["basic", "基本信息", "users"], ["leader", "指挥者", "crown"], ["members", "成员", "users"], ["instructions", "团队指令", "file-text"], ["snapshots", "快照", "layers"]];
  return `<div class="page"><div class="page-inner" style="max-width:1240px">
    <header class="page-header">
      <div style="display:flex;align-items:center;gap:12px"><button class="icon-btn" data-nav="#/settings/teams">${icon("arrow-left", 17)}</button><div><div class="page-eyebrow">Teams / ${esc(t.name)}</div><h1 class="page-title">编辑团队</h1></div></div>
      <div class="page-actions"><button class="btn btn-ghost" data-nav="#/settings/teams">取消</button><button class="btn btn-primary" data-action="save-team">${icon("check", 14)} 保存</button></div>
    </header>
    <div class="editor-layout">
      <nav class="editor-nav">${tabs.map(([id, label, ic]) => `<button class="editor-nav-item ${state.teamTab === id ? "active" : ""}" data-action="team-tab" data-tab="${id}">${icon(ic, 15)} ${label}</button>`).join("")}</nav>
      <div>${teamTabContent(t, state.teamTab)}</div>
      ${teamPreview(t)}
    </div>
  </div></div>`;
}

function teamTabContent(t, tab) {
  if (tab === "basic") {
    return `<section class="form-section"><div class="form-section-title">${icon("users", 15)} 团队身份</div>
      <div class="field"><div class="field-label">团队头像</div><div class="avatar-picker"><div class="avatar-preview" data-action="upload-team-avatar" role="button" tabindex="0" title="点击上传头像">${t.avatar ? `<img class="agent-avatar-img" src="${esc(t.avatar)}" alt="团队头像">` : teamAvatar(t.id, 60)}</div><div><div class="avatar-presets">${t.members.slice(0, 4).map((id) => `<button class="avatar-preset ${t.avatar ? "" : "active"}" style="background:${AGENTS[id].color}" data-action="toast" data-msg="成员头像用于默认拼贴"></button>`).join("")}</div><div class="avatar-actions"><button class="btn btn-sm" data-action="randomize-team-avatar">${icon("refresh", 12)} 随机生成</button></div><div class="field-help" style="margin-top:7px">点击预览上传团队头像（≤2MB）；默认由成员头像拼贴生成。</div>${t.avatar ? `<button class="btn btn-sm" style="margin-top:7px" data-action="reset-team-avatar">恢复默认头像</button>` : ""}</div></div></div>
      <div class="field"><div class="field-label">名称</div><input class="input" value="${esc(t.name)}"></div>
      <div class="field"><div class="field-label">描述</div><input class="input" value="${esc(t.desc)}"></div>
      <div class="field-row"><div class="field"><div class="field-label">默认扇出策略</div><div class="segmented"><button class="${t.fanout === "并发" ? "active" : ""}">并发</button><button class="${t.fanout === "串行" ? "active" : ""}">串行</button></div></div><div class="field"><div class="field-label">最大辩论轮次</div><input class="input" type="number" value="${t.maxRounds}"></div></div>
    </section>`;
  }
  if (tab === "leader") {
    return `<section class="form-section"><div class="form-section-title">${icon("crown", 15)} 指挥者</div>
      <div class="form-section-sub">指挥者默认接收用户消息，负责拆解、分派、交叉质询与收敛。它必须是团队成员。</div>
      <div class="member-card" style="border-color:var(--line-strong)">
        ${agentAvatar(t.leader, 38)}
        <div class="member-info"><div class="member-name">${esc(AGENTS[t.leader].name)} <span class="badge badge-accent">当前指挥者</span></div><div class="member-desc">${esc(AGENTS[t.leader].desc)}</div></div>
        <button class="btn btn-sm" data-action="toast" data-msg="编辑指挥者 Prompt（原型演示）">${icon("edit", 12)} Prompt</button>
      </div>
      <div class="field" style="margin-top:16px"><div class="field-label">更换指挥者</div>
        <div class="chip-list">${t.members.filter((id) => id !== t.leader).map((id) => `<button class="chip" data-action="set-leader" data-member="${id}">${agentAvatar(id, 16, false)} ${esc(AGENTS[id].name)}</button>`).join("")}</div>
        <div class="field-help">更换后即时生效；正在运行的回合不受影响。</div>
      </div>
      <div class="field"><div class="field-label">指挥者协议（只读）</div><div class="prompt-preview">1. 只协调，不代替成员实现。
2. 使用精确提及语法分派：[@名称](mention://agent/&lt;id&gt;)。
3. 分派后停止，等待成员回报。
4. 每轮记录评估：继续 / 收敛 / 升级给用户。
5. 收敛后输出结论、依据、分歧、未决问题与下一步。</div></div>
    </section>`;
  }
  if (tab === "members") {
    return `<section class="form-section">
      <div class="form-section-title" style="justify-content:space-between">${icon("users", 15)} 成员 <span style="font-size:10.5px;color:var(--muted);font-weight:400">${t.members.length} 人</span></div>
      <div class="form-section-sub">成员级配置可以覆盖 Prompt、Skill 与 MCP；覆盖不会修改智能体本身。</div>
      ${t.members.map((id) => {
        const a = AGENTS[id];
        const isLeader = id === t.leader;
        return `<div class="member-card">
          ${agentAvatar(id, 36)}
          <div class="member-info"><div class="member-name">${esc(a.name)} ${isLeader ? `<span class="leader-crown">${icon("crown", 13)}</span><span class="badge badge-accent" style="height:16px;font-size:9px">指挥者</span>` : ""} ${(a.overriddenTeams || []).includes(t.id) ? '<span class="override-dot" title="有团队覆盖"></span>' : ""}</div><div class="member-desc">${esc(a.desc)} · ${esc(a.runtime)}</div></div>
          <div class="member-actions">
            <button class="btn btn-sm btn-ghost" data-action="edit-member" data-member="${id}">${icon("edit", 12)} 覆盖</button>
            ${!isLeader ? `<button class="icon-btn" data-action="set-leader" data-member="${id}" title="设为指挥者">${icon("crown", 14)}</button>` : ""}
            ${!isLeader ? `<button class="icon-btn" data-action="remove-member" data-member="${id}" title="移除">${icon("x", 14)}</button>` : ""}
          </div>
        </div>`;
      }).join("")}
      <button class="btn" data-action="add-member" style="margin-top:6px">${icon("plus", 14)} 添加成员</button>
      <button class="btn btn-ghost" data-action="new-private-member">${icon("plus", 14)} 新建团队私有成员</button>
    </section>`;
  }
  if (tab === "instructions") {
    return `<section class="form-section">
      <div class="form-section-title">${icon("file-text", 15)} 团队编排 Prompt</div>
      <div class="form-section-sub">只提供给指挥者，用于规定它如何组织成员、何时辩论、何时收敛。</div>
      <textarea class="textarea mono" style="min-height:300px">你是团队「${t.name}」的指挥者。你的职责不是替成员答题，而是组织他们协作。

规则：
1. 收到任务后，先用一句话复述目标与成功标准。
2. 第一轮：把任务拆成 2–4 个独立子问题，@ 对应成员并行回答。
3. 第二轮起：把成员的具体观点交叉引用给对方，要求「同意并补充」或「反驳并给出新论据」；禁止空泛附和。
4. 至少保留一名成员承担反方角色。
5. 用户随时可能插话；收到插话后，先更新任务约束，再继续分派。
6. 需要用户拍板时，@我 并提出一个具体问题，不要自行假设。
7. 满足任一条件时收敛：达到 ${t.maxRounds} 轮；连续两位成员无新论据；你判断分歧已充分暴露。
8. 最终输出 Markdown，必须包含：结论、关键依据、分歧与未决问题、建议下一步。
9. 把最终文档写入工作区 .pizza/artifacts/。</textarea>
      <div class="chip-list" style="margin-top:8px">${["头脑风暴", "代码协作", "评审"].map((x) => `<button class="chip" data-action="toast" data-msg="已应用模板：${x}">${x}</button>`).join("")}</div>
    </section>`;
  }
  return `<section class="form-section">
    <div class="form-section-title">${icon("layers", 15)} 团队快照 <span class="badge">P1</span></div>
    <div class="form-section-sub">快照保存团队基本信息、成员、覆盖配置与编排 Prompt；可恢复或复制为新团队。</div>
    <button class="btn btn-primary" data-action="save-snapshot">${icon("plus", 14)} 保存当前配置为快照</button>
    <div class="card" style="margin-top:14px;padding:4px 14px">
      ${state.snapshots.map((s) => `<div class="switch-row"><div class="switch-text"><div class="switch-title">${esc(s.name)}</div><div class="switch-desc">${esc(s.time)} · ${esc(s.note)}</div></div><div style="display:flex;gap:5px"><button class="btn btn-sm" data-action="restore-snapshot" data-snapshot="${s.id}">恢复</button><button class="btn btn-sm btn-ghost" data-action="clone-snapshot" data-snapshot="${s.id}">复制为新团队</button></div></div>`).join("")}
    </div>
  </section>`;
}

function teamPreview(t) {
  const issues = [];
  if (!t.members.includes(t.leader)) issues.push("指挥者不在成员列表中");
  if (t.members.length < 2) issues.push("至少需要一名成员");
  return `<aside class="preview-panel">
    <div class="preview-head">${icon("shield", 14)} 校验与预览</div>
    <div class="team-summary">
      <div class="team-summary-title">团队名单（指挥者可见）</div>
      ${t.members.map((id) => `<div class="summary-row">${agentAvatar(id, 20, false)}<span style="flex:1">${esc(AGENTS[id].name)}</span><span style="font-size:9.5px;color:var(--muted)">${id === t.leader ? "指挥者" : "成员"}</span></div>`).join("")}
    </div>
    <div class="rp-note" style="margin-top:10px">
      <strong style="color:var(--ink)">提及语法</strong><br>
      [@${esc(AGENTS[t.leader].name)}](mention://agent/${t.leader})<br>
      精确语法才会触发分派；纯文本 @ 不触发。
    </div>
    <div style="margin-top:12px">
      ${issues.length ? issues.map((i) => `<div class="badge badge-red" style="margin:0 4px 5px 0">${esc(i)}</div>`).join("") : `<span class="badge badge-green">${icon("check", 10)} 配置有效</span>`}
      <span class="badge">${t.members.length} 成员</span><span class="badge">最多 ${t.maxRounds} 轮</span><span class="badge">${t.fanout}</span>
    </div>
    <div class="rp-note">保存后会写入团队快照，并在下一次会话中生效。运行中的回合继续使用旧配置。</div>
  </aside>`;
}

/* ---------- 运行时 ---------- */

function runtimesPage() {
  return `<div class="page"><div class="page-inner">
    <header class="page-header">
      <div><div class="page-eyebrow">Workspace</div><h1 class="page-title">运行时</h1><p class="page-sub">Pizza 不自带模型；它驱动本机已安装、已登录的智能体 CLI。</p></div>
      <div class="page-actions"><button class="btn btn-primary" data-action="start-runtime-setup">${icon("plus", 14)} 添加运行时</button></div>
    </header>
    <div class="toolbar">
      <label class="search-input">${icon("search", 14)}<input placeholder="搜索运行时…"></label>
      <button class="filter-chip active">全部 ${RUNTIMES.length}</button>
      <button class="filter-chip">在线 ${RUNTIMES.filter((r) => r.status === "online").length}</button>
      <button class="filter-chip">离线 ${RUNTIMES.filter((r) => r.status !== "online").length}</button>
      <span style="flex:1"></span><span class="badge">${icon("shield", 11)} 仅监听本机</span>
    </div>
    <div class="card" style="overflow:hidden">
      ${RUNTIMES.map((r) => `<div class="runtime-row runtime-grid">
        <span class="runtime-icon">${r.avatar ? `<img class="runtime-avatar-img" src="${esc(r.avatar)}" alt="">` : icon(r.icon, 18)}</span>
        <div><div class="runtime-name">${esc(r.name)} ${statusDot(r.status)} ${r.status === "online" ? `<span class="badge badge-green">在线</span>` : `<span class="badge">离线</span>`}</div><div class="runtime-meta">${esc(r.adapter)} · ${esc(r.protocol)}</div></div>
        <div class="runtime-caps">${r.caps.map((c) => `<span class="badge">${esc(c)}</span>`).join("")}</div>
        <div style="font-size:10.5px;color:var(--muted)">${r.models} 个模型<br>${r.agents} 个智能体</div>
        <div style="font-size:10.5px;color:var(--muted)">${esc(r.last)}</div>
        <div class="runtime-actions"><button class="btn btn-sm" data-action="test-runtime" data-runtime="${r.id}">测试</button><button class="icon-btn" data-action="runtime-menu" data-runtime="${r.id}" aria-label="运行时菜单">${icon("more", 15)}</button></div>
      </div>`).join("")}
    </div>
    <div class="card" style="margin-top:18px;padding:16px;display:flex;align-items:center;gap:14px;background:var(--surface-2)">
      <span class="runtime-icon" style="background:var(--surface)">${icon("shield", 18)}</span>
      <div style="flex:1"><div style="font-size:12px;font-weight:600">运行时拥有你当前系统用户的完整权限</div><div style="font-size:10.5px;color:var(--muted);margin-top:2px;line-height:1.6">Pizza 不做文件系统沙箱；危险工具调用默认逐次审批。建议在独立用户或容器中运行不受信任的任务。</div></div>
      <button class="btn btn-sm" data-action="toast" data-msg="安全说明（原型演示）">了解安全模型</button>
    </div>
  </div></div>`;
}

const RUNTIME_ADAPTER_ICONS = { claude: "sparkle", codex: "terminal", pi: "box", omp: "zap", dsh: "layers", hermes: "plug", custom: "command" };

function runtimeNewPage() {
  const test = state.runtimeTest;
  const editing = RUNTIMES.find((r) => r.id === test.editingId);
  const selected = test.adapter || "claude";
  const iconName = test.icon || RUNTIME_ADAPTER_ICONS[selected] || "sparkle";
  const adapters = [
    ["claude", "Claude Code", "CLI · stream-json", "sparkle"],
    ["codex", "Codex", "CLI · app-server", "terminal"],
    ["pi", "Pi", "CLI · 会话文件", "box"],
    ["omp", "Oh My Pi", "CLI · Pi 协议族", "zap"],
    ["dsh", "DeepSeek Harness", "CLI · dsh", "layers"],
    ["hermes", "Hermes", "ACP · stdio", "plug"],
    ["custom", "通用 ACP", "自定义传输", "command"],
  ];
  const defaults = {
    claude: "claude --output-format stream-json",
    codex: "codex app-server",
    pi: "pi acp",
    omp: "omp acp",
    dsh: "dsh acp",
    hermes: "hermes --acp",
    custom: "",
  };
  const transport = test.transport || "stdio";
  const urlPlaceholder = transport === "ws" ? "ws://127.0.0.1:4317/acp" : transport === "http" ? "http://127.0.0.1:4317/acp" : "stdio 使用命令启动，无需地址";
  const steps = ["启动进程 / 建立连接", "握手与版本协商", "创建临时会话", "发送测试消息", "清理临时会话"];
  return `<div class="page"><div class="page-inner" style="max-width:1180px">
    <header class="page-header"><div style="display:flex;align-items:center;gap:12px"><button class="icon-btn" data-nav="#/settings/runtimes">${icon("arrow-left", 17)}</button><div><div class="page-eyebrow">Runtimes / ${editing ? "编辑" : "添加"}</div><h1 class="page-title">${editing ? "编辑运行时" : "接入运行时"}</h1><p class="page-sub">${editing ? "修改接入配置；测试通过后保存。" : "测试通过后才能注册；注册后即可被智能体绑定。"}</p></div></div><div class="page-actions"><button class="btn btn-ghost" data-nav="#/settings/runtimes">取消</button><button class="btn btn-primary" data-action="register-runtime" ${test.status === "success" ? "" : "disabled"}>${icon("check", 14)} ${editing ? "保存修改" : "注册运行时"}</button></div></header>
    <div class="acp-layout">
      <div class="card" style="padding:18px">
        <div class="field"><div class="field-label">适配器</div><div class="team-grid" style="grid-template-columns:1fr 1fr;gap:7px">
          ${adapters.map(([id, name, sub, ic]) => `<button class="member-card" style="margin:0;text-align:left;cursor:pointer;${selected === id ? "border-color:var(--ink);background:var(--surface-2)" : ""}" data-action="select-adapter" data-adapter="${id}"><span class="runtime-icon">${icon(ic, 16)}</span><span class="member-info"><span class="member-name">${esc(name)}</span><span class="member-desc">${esc(sub)}</span></span></button>`).join("")}
        </div></div>
        <div class="field"><div class="field-label">名称</div><input class="input" id="runtimeNameInput" value="${esc(editing?.name || adapters.find((x) => x[0] === selected)?.[1] || "")}"></div>
        <div class="field"><div class="field-label">头像</div><div class="avatar-picker">
          <div class="avatar-preview" data-action="upload-runtime-avatar" role="button" tabindex="0" title="点击上传头像">${test.avatar ? `<img class="avatar-upload-img" src="${esc(test.avatar)}" alt="运行时头像">` : icon(iconName, 26)}</div>
          <div style="flex:1;min-width:0"><div class="avatar-presets">${["sparkle", "terminal", "plug", "box", "zap", "layers", "cpu", "command"].map((ic) => `<button class="avatar-preset" style="display:grid;place-items:center;color:var(--ink-2);${!test.avatar && iconName === ic ? "border-color:var(--ink);" : ""}" data-action="select-runtime-icon" data-icon="${ic}" aria-label="选择头像 ${ic}">${icon(ic, 14)}</button>`).join("")}</div><div class="avatar-actions"><button class="btn btn-sm" data-action="randomize-runtime-avatar">${icon("refresh", 12)} 随机生成</button></div><div class="field-help" style="margin-top:7px">点击预览上传头像，或选择图标；用于运行时列表与智能体绑定处。</div></div>
        </div></div>
        <div class="field-row"><div class="field"><div class="field-label">传输方式</div><div class="segmented" style="width:100%">${[["stdio", "stdio"], ["ws", "WebSocket"], ["http", "HTTP"]].map(([v, l]) => `<button style="flex:1" class="${transport === v ? "active" : ""}" data-action="select-transport" data-transport="${v}">${l}</button>`).join("")}</div></div><div class="field"><div class="field-label">超时</div><input class="input" value="30 秒"></div></div>
        <div class="field"><div class="field-label">ACP 连接地址 <span class="hint">${transport === "stdio" ? "stdio 无需地址" : "WebSocket / HTTP"}</span></div><input class="input" style="font-family:var(--font-mono);font-size:11.5px" value="${esc(test.url || "")}" placeholder="${esc(urlPlaceholder)}" ${transport === "stdio" ? "disabled" : ""}></div>
        <div class="field"><div class="field-label">命令</div><input class="input" style="font-family:var(--font-mono);font-size:11.5px" value="${esc(defaults[selected] || "")}" placeholder="例如：npx -y @scope/acp-adapter"></div>
        <div class="field"><div class="field-label">初始测试命令 <span class="hint">可选</span></div><input class="input" style="font-family:var(--font-mono);font-size:11.5px" value="${esc(defaults[selected] || "")}"></div>
        <div class="field"><div class="field-label">环境变量 <span class="hint">值保存到系统钥匙串</span></div><div class="card" style="padding:10px;font-size:11px;color:var(--muted)">未配置。可添加 API Key、代理或运行时专用变量。</div></div>
        <div class="switch-row"><div class="switch-text"><div class="switch-title">自动重连</div><div class="switch-desc">断线后按退避策略重连，不自动重放失败任务。</div></div><button class="switch on"></button></div>
        <button class="btn btn-primary" style="width:100%;margin-top:14px" data-action="acp-test">${test.status === "running" ? icon("loader", 14) + " 测试中…" : icon("flask", 14) + " 测试连接"}</button>
      </div>
      <div class="test-console">
        <div class="test-console-head">${statusDot(test.status === "success" ? "online" : test.status === "running" ? "running" : "offline")} 连接控制台 <span style="margin-left:auto;font-weight:400;opacity:.55">${esc(selected)}</span></div>
        <div class="test-steps">
          ${steps.map((s, i) => {
            const cls = test.status === "success" || i < test.step ? "success" : test.status === "running" && i === test.step ? "running" : "";
            return `<div class="test-step ${cls}"><span class="step-dot">${cls === "success" ? "✓" : cls === "running" ? "·" : i + 1}</span><span>${esc(s)}</span><span class="step-time">${cls === "success" ? (0.1 + i * 0.3).toFixed(1) + "s" : cls === "running" ? "进行中" : "等待"}</span></div>`;
          }).join("")}
        </div>
        ${test.status === "success" ? `<div class="test-result">
          <strong>连接成功</strong> · 协议握手完成 · 往返 182ms<br>
          <div class="capability-grid">
            <div class="capability"><b>协议</b>ACP / stream-json</div><div class="capability"><b>会话</b>支持恢复</div>
            <div class="capability"><b>MCP</b>stdio + HTTP</div><div class="capability"><b>插话</b>支持运行中追加</div>
          </div>
          <div style="margin-top:9px;opacity:.7">可用模型：Claude Sonnet 4.5、Claude Opus 4.5、Claude Haiku 4.5</div>
        </div>` : test.status === "failed" ? `<div class="test-result" style="color:#f0a29a"><strong>连接失败</strong><br>未找到命令：${esc(defaults[selected] || "")}<br>请先安装对应 CLI 并登录，或在命令中填写绝对路径。</div>` : `<div class="test-result" style="opacity:.65">点击「测试连接」后会依次执行握手、创建临时会话与测试消息。成功后才能注册。</div>`}
      </div>
    </div>
  </div></div>`;
}

/* ---------- Skill / MCP ---------- */

function skillsPage() {
  return `<div class="page"><div class="page-inner">
    <header class="page-header"><div><div class="page-eyebrow">Resources</div><h1 class="page-title">Skill</h1><p class="page-sub">可复用的工作方法：SKILL.md + 资源文件，可挂载到多个智能体。</p></div><div class="page-actions"><button class="btn" data-action="toast" data-msg="从文件夹 / ZIP / Git 导入（原型演示）">${icon("upload", 14)} 导入</button><button class="btn btn-primary" data-action="toast" data-msg="新建 Skill（原型演示）">${icon("plus", 14)} 新建 Skill</button></div></header>
    <div class="toolbar"><label class="search-input">${icon("search", 14)}<input placeholder="搜索 Skill…"></label><button class="filter-chip active">全部 ${SKILLS.length}</button><span style="flex:1"></span><span class="badge">${icon("wand", 11)} 内置协作 Skill 已启用</span></div>
    <div class="card" style="overflow:hidden">
      ${SKILLS.map((s) => `<div class="runtime-row" data-skill="${s.id}" style="cursor:pointer">
        <span class="runtime-icon" style="background:var(--accent-soft);color:var(--accent)">${icon("wand", 17)}</span>
        <div style="min-width:220px"><div class="runtime-name">${esc(s.name)} <span class="badge" style="font-family:var(--font-mono);font-size:9px">${s.cmd}</span></div><div class="runtime-meta">${esc(s.desc)}</div></div>
        <div class="runtime-caps"><span class="badge">v${esc(s.version)}</span><span class="badge">${esc(s.source)}</span><span class="badge">${s.usedBy} 个智能体</span></div>
        <button class="switch ${s.enabled ? "on" : ""}" style="margin-left:auto" data-action="toggle-switch" aria-label="启用 ${esc(s.name)}"></button>
        <button class="icon-btn row-action" data-action="delete-skill" data-id="${s.id}" title="删除 Skill" aria-label="删除 ${esc(s.name)}">${icon("trash", 14)}</button>
        <button class="icon-btn" data-action="open-skill" data-skill="${s.id}">${icon("chevron-right", 15)}</button>
      </div>`).join("")}
    </div>
    <div class="card" style="margin-top:18px;padding:15px;display:flex;gap:12px;align-items:flex-start">
      <span class="runtime-icon" style="background:var(--surface-2)">${icon("shield", 17)}</span>
      <div style="font-size:11px;color:var(--muted);line-height:1.7"><strong style="color:var(--ink)">导入的 Skill 不会被执行或签名审查。</strong> 它会被原样交给运行时；请只导入可信来源。同名冲突可选择保留两份、覆盖或跳过。</div>
    </div>
  </div></div>`;
}

function mcpPage() {
  return `<div class="page"><div class="page-inner">
    <header class="page-header"><div><div class="page-eyebrow">Resources</div><h1 class="page-title">MCP 服务器</h1><p class="page-sub">通过 Model Context Protocol 为智能体提供文件、仓库、数据库等工具。</p></div><div class="page-actions"><button class="btn btn-primary" data-action="add-mcp">${icon("plus", 14)} 添加服务器</button></div></header>
    <div class="toolbar"><label class="search-input">${icon("search", 14)}<input placeholder="搜索 MCP…"></label><button class="filter-chip active">全部 ${MCPS.length}</button><button class="filter-chip">stdio 2</button><button class="filter-chip">HTTP 1</button><span style="flex:1"></span><span class="badge">${icon("shield", 11)} 配置只写</span></div>
    <div class="card" style="overflow:hidden">
      ${MCPS.map((m) => `<div class="runtime-row" data-mcp="${m.id}" style="cursor:pointer">
        <span class="runtime-icon" style="${m.status === "error" ? "color:var(--red);background:var(--red-soft)" : "color:var(--blue);background:color-mix(in srgb, var(--blue) 10%, transparent)"}">${icon("plug", 17)}</span>
        <div style="min-width:220px"><div class="runtime-name">${esc(m.name)} ${statusDot(m.status)} <span class="badge">${esc(m.transport)}</span></div><div class="runtime-meta">${esc(m.desc)} · ${m.tools} 个工具</div></div>
        <div class="runtime-caps"><span class="badge">${m.usedBy} 个智能体</span>${m.status === "error" ? `<span class="badge badge-red">连接失败</span>` : `<span class="badge badge-green">健康</span>`}</div>
        <button class="switch on" style="margin-left:auto" data-action="toggle-switch"></button>
        <button class="icon-btn row-action" data-action="delete-mcp" data-id="${m.id}" title="删除 MCP" aria-label="删除 ${esc(m.name)}">${icon("trash", 14)}</button>
        <button class="icon-btn" data-action="open-mcp" data-mcp="${m.id}">${icon("chevron-right", 15)}</button>
      </div>`).join("")}
    </div>
    <div class="card" style="margin-top:18px;padding:15px;font-size:11px;color:var(--muted);line-height:1.7">
      <strong style="color:var(--ink)">合并优先级：</strong>智能体自有配置 &gt; 工作区库绑定 &gt; 运行时本地配置。被覆盖的项会在智能体页标注。URL、Header 与环境变量保存后不再回显；修改需整体替换。
    </div>
  </div></div>`;
}

/* ---------- 设置 ---------- */

const SETTINGS_NAV = [
  { group: "个人", items: [["profile", "个人资料", "user"], ["appearance", "语言与外观", "sun"]] },
  { group: "数据", items: [["memory", "记忆管理", "database"], ["archived", "已归档会话", "archive"]] },
  { group: "团队", items: [
    ["agents", "智能体", "cpu"],
    ["teams", "智能体团队", "users"],
    ["skills", "Skills", "wand"],
    ["mcp", "MCP", "plug"],
    ["runtimes", "运行时", "box"],
    ["stats", "统计", "chart"],
  ] },
  { group: "系统", items: [["system", "系统设置", "settings"], ["about", "关于 Pizza", "alert"]] },
];

const SETTINGS_EXTRA_LABELS = {
  "agent-edit": "编辑智能体",
  "team-edit": "编辑团队",
  "runtime-new": "接入运行时",
};

function settingsNavCount(id) {
  if (id === "agents") return Object.values(AGENTS).length;
  if (id === "teams") return Object.keys(TEAMS).length;
  if (id === "skills") return SKILLS.length;
  if (id === "mcp") return MCPS.length;
  if (id === "runtimes") return RUNTIMES.length;
  return "";
}

function settingsEmbed(html) {
  return html.replace(/^<div class="page"><div class="page-inner"[^>]*>/, "").replace(/<\/div><\/div>$/, "");
}

function settingsNavItem(id, itemLabel, ic, activeTab) {
  const count = settingsNavCount(id);
  return `<button class="settings-nav-item ${activeTab === id ? "active" : ""}" data-action="settings-tab" data-tab="${id}">${icon(ic, 15)} ${itemLabel}${count !== "" ? `<span class="nav-count">${count}</span>` : ""}</button>`;
}

function settingsPage() {
  const tab = state.settingsTab;
  const activeNav = { "agent-edit": "agents", "team-edit": "teams", "runtime-new": "runtimes" }[tab] || tab;
  const localTabs = ["agents", "teams", "skills", "mcp", "runtimes", "agent-edit", "team-edit", "runtime-new", "stats"];
  const label = SETTINGS_NAV.flatMap((g) => g.items).find(([id]) => id === tab)?.[1] || (tab === "runtime-new" && state.runtimeTest.editingId ? "编辑运行时" : SETTINGS_EXTRA_LABELS[tab]) || "设置";
  return `<div class="settings-shell">
    <nav class="settings-nav">
      <div class="brand-row">
        <a class="brand" href="#/home" aria-label="Pizza 首页">
          <span class="brand-mark"></span>
          <span class="brand-name">Pizza</span>
        </a>
      </div>
      <div class="settings-nav-scroll">
        ${SETTINGS_NAV.map((g) => `<div class="settings-group">${g.group}</div>${g.items.map(([id, itemLabel, ic]) => settingsNavItem(id, itemLabel, ic, activeNav)).join("")}`).join("")}
      </div>
      <div class="settings-nav-foot">
        <button class="settings-return" data-action="back-to-chat">${icon("chevron-left", 14)} 返回聊天</button>
        <button class="settings-theme" data-action="toggle-theme" title="切换主题">${icon(state.theme === "dark" ? "sun" : "moon", 15)}</button>
      </div>
    </nav>
    <div class="settings-content">
      <div class="settings-topbar"><span>设置</span>${icon("chevron-right", 11)}<strong>${esc(label)}</strong><span class="badge" style="margin-left:6px">${localTabs.includes(tab) ? "本机工作区" : "账号 · 所有设备同步"}</span></div>
      <div class="settings-inner ${localTabs.includes(tab) ? "wide" : ""}">${settingsContent(tab)}</div>
    </div>
  </div>`;
}

const STATS_VIEWS = {
  today: {
    metric: "今日 token", tokens: "182K", runs: "18", success: "96%",
    labels: ["00", "04", "08", "12", "16", "20"], bars: [28, 36, 54, 78, 64, 46],
  },
  "7d": {
    metric: "本周 token", tokens: "1.82M", runs: "128", success: "94%",
    labels: ["一", "二", "三", "四", "五", "六", "日"], bars: [42, 68, 55, 80, 63, 91, 74],
  },
  "30d": {
    metric: "本月 token", tokens: "7.4M", runs: "512", success: "93%",
    labels: ["第 1 周", "第 2 周", "第 3 周", "第 4 周", "本周"], bars: [62, 74, 58, 86, 70],
  },
};

function settingsContent(tab) {
  if (tab === "profile") {
    return `<h1 class="settings-title">个人信息</h1><p class="settings-sub">每次运行都会提供给为你工作的智能体，用来调整语气与协作方式。</p>
      <div class="settings-section"><div class="settings-card">
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">头像</div><div class="settings-row-desc">点击上传头像</div></div><div class="settings-row-control"><div class="profile-avatar" data-action="upload-profile-avatar" role="button" tabindex="0" title="点击上传头像">${state.profileAvatar ? `<img class="profile-avatar-img" src="${esc(state.profileAvatar)}" alt="头像">` : "你"}</div></div></div>
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">姓名</div><div class="settings-row-desc">显示在会话与通知中。</div></div><div class="settings-row-control"><input class="input" style="width:280px" value="Pizza 用户"></div></div>
        <div class="settings-row" style="align-items:flex-start"><div class="settings-row-text"><div class="settings-row-title">关于你</div><div class="settings-row-desc">每次运行都会提供给为你工作的智能体。</div></div><div class="settings-row-control"><div><textarea class="textarea" style="width:340px;min-height:82px" placeholder="例如：后端工程师，喜欢简洁的 PR，改动需要同时附上测试。"></textarea><div class="field-help" style="text-align:right">0/2000</div></div></div></div>
      </div></div>`;
  }
  if (tab === "appearance") {
    return `<h1 class="settings-title">语言与外观</h1><p class="settings-sub">立即生效，并保存在本机。</p>
      <div class="settings-section"><div class="settings-section-title">主题</div><div class="settings-card">
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">外观</div><div class="settings-row-desc">浅色、深色或跟随系统。</div></div><div class="settings-row-control"><div class="segmented">
          ${[["light", "浅色"], ["dark", "深色"], ["system", "跟随系统"]].map(([v, l]) => `<button class="${state.themeChoice === v ? "active" : ""}" data-action="theme-choice" data-theme-choice="${v}">${l}</button>`).join("")}
        </div></div></div>
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">字号</div><div class="settings-row-desc">影响正文与消息流。</div></div><div class="settings-row-control"><div class="segmented"><button class="active">标准</button><button>紧凑</button><button>宽松</button></div></div></div>
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">减少动效</div><div class="settings-row-desc">关闭脉冲、滑动与流式光标动画。</div></div><div class="settings-row-control"><button class="switch" data-action="toggle-switch"></button></div></div>
      </div></div>
      <div class="settings-section"><div class="settings-section-title">语言</div><div class="settings-card">
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">界面语言</div><div class="settings-row-desc">切换后无需重启。</div></div><div class="settings-row-control"><select class="select" style="width:160px"><option>简体中文</option><option>English</option></select></div></div>
      </div></div>`;
  }
  if (tab === "memory") {
    return `<h1 class="settings-title">记忆管理</h1><p class="settings-sub">Pizza 在会话中可引用的长期事实与偏好。</p>
      <div class="settings-section"><div class="settings-card">${MEMORY.map((m) => `<div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">${esc(m.text)}</div><div class="settings-row-desc">${esc(m.scope)}记忆 · ${esc(m.updated)}</div></div><div class="settings-row-control"><button class="btn btn-sm btn-ghost" data-action="toast" data-msg="编辑记忆（原型演示）">编辑</button><button class="icon-btn" data-action="toast" data-msg="删除记忆（原型演示）">${icon("trash", 14)}</button></div></div>`).join("")}</div></div>
      <button class="btn" data-action="toast" data-msg="导出记忆（原型演示）">${icon("download", 14)} 导出全部记忆</button>`;
  }
  if (tab === "archived") {
    return `<h1 class="settings-title">已归档会话</h1><p class="settings-sub">归档会话只读；可恢复或永久删除。</p>
      <div class="settings-section"><div class="settings-card">${ARCHIVED.map((s) => `<div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">${esc(s.title)}</div><div class="settings-row-desc">${s.mode === "team" ? "团队" : "智能体"} · ${esc(s.time)}</div></div><div class="settings-row-control"><button class="btn btn-sm" data-action="toast" data-msg="恢复会话（原型演示）">恢复</button><button class="btn btn-sm btn-danger" data-action="toast" data-msg="永久删除前会二次确认">永久删除</button></div></div>`).join("")}</div></div>`;
  }
  if (tab === "system") {
    return `<h1 class="settings-title">系统设置</h1><p class="settings-sub">影响本机运行与数据存储。</p>
      <div class="settings-section"><div class="settings-card">
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">默认工作区</div><div class="settings-row-desc">${esc(state.defaultWorkspacePath)}</div></div><div class="settings-row-control"><button class="btn btn-sm" data-action="choose-default-workspace">选择…</button></div></div>
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">默认运行时</div><div class="settings-row-desc">新建智能体时预选。</div></div><div class="settings-row-control"><select class="select" style="width:170px" data-setting="defaultRuntime">${RUNTIMES.map((r) => `<option value="${r.id}" ${state.defaultRuntime === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></div></div>
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">最大并发运行</div><div class="settings-row-desc">全局上限；单个智能体还有自己的并发限制。</div></div><div class="settings-row-control"><input class="input" style="width:70px" value="3"></div></div>
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">数据目录</div><div class="settings-row-desc">~/.pizza</div></div><div class="settings-row-control"><button class="btn btn-sm" data-action="toast" data-msg="打开数据目录（原型演示）">打开</button></div></div>
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">匿名统计</div><div class="settings-row-desc">默认关闭。Pizza 不收集会话内容。</div></div><div class="settings-row-control"><button class="switch" data-action="toggle-switch"></button></div></div>
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">自动更新</div><div class="settings-row-desc">仅从签名渠道下载。</div></div><div class="settings-row-control"><button class="switch on" data-action="toggle-switch"></button></div></div>
      </div></div>`;
  }
  if (tab === "about") {
    return `<h1 class="settings-title">关于 Pizza</h1><p class="settings-sub">把问题切开，@ 给合适的智能体，再拼回完整答案。</p>
      <div class="settings-section"><div class="settings-card">
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">版本</div><div class="settings-row-desc">0.1.0 · 原型预览</div></div><div class="settings-row-control"><button class="btn btn-sm" data-action="toast" data-msg="已是最新版本">检查更新</button></div></div>
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">开源协议</div><div class="settings-row-desc">正式发布前将在 LICENSE 中明确；参考实现的归属信息会被保留。</div></div><div class="settings-row-control"><button class="btn btn-sm" data-action="toast" data-msg="打开许可证（原型演示）">查看</button></div></div>
        <div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">反馈与文档</div><div class="settings-row-desc">问题、建议与使用手册。</div></div><div class="settings-row-control"><button class="btn btn-sm" data-action="toast" data-msg="打开文档（原型演示）">文档</button></div></div>
      </div></div>`;
  }
  if (tab === "stats") {
    const view = STATS_VIEWS[state.statsRange] || STATS_VIEWS["7d"];
    return `<h1 class="settings-title">统计</h1><p class="settings-sub">按智能体与会话查看 token 使用与运行情况。P1 功能。</p>
      <div class="toolbar">
        ${[["today", "今天"], ["7d", "近 7 天"], ["30d", "近 30 天"]].map(([id, text]) => `<button class="filter-chip ${state.statsRange === id ? "active" : ""}" data-action="stats-range" data-range="${id}">${text}</button>`).join("")}
        <span style="flex:1"></span><span class="badge">按本机数据统计</span>
      </div>
      <div class="settings-section"><div class="settings-card" style="padding:16px">
        <div style="display:flex;gap:22px;margin-bottom:16px"><div><div class="settings-row-desc">${view.metric}</div><div style="font-size:24px;font-family:var(--font-display)">${view.tokens}</div></div><div><div class="settings-row-desc">运行次数</div><div style="font-size:24px;font-family:var(--font-display)">${view.runs}</div></div><div><div class="settings-row-desc">成功率</div><div style="font-size:24px;font-family:var(--font-display)">${view.success}</div></div></div>
        <div class="stats-chart">${view.bars.map((h, i) => `<div class="stats-bar-col"><div class="stats-bar ${i === view.bars.length - 1 ? "active" : ""}" style="height:${Math.round(h * 0.82)}px"></div><span>${view.labels[i]}</span></div>`).join("")}</div>
      </div></div>`;
  }
  if (tab === "agents") return settingsEmbed(agentsPage());
  if (tab === "teams") return settingsEmbed(teamsPage());
  if (tab === "skills") return settingsEmbed(skillsPage());
  if (tab === "mcp") return settingsEmbed(mcpPage());
  if (tab === "runtimes") return settingsEmbed(runtimesPage());
  if (tab === "agent-edit") return settingsEmbed(agentEditor());
  if (tab === "team-edit") return settingsEmbed(teamEditor());
  if (tab === "runtime-new") return settingsEmbed(runtimeNewPage());
  return `<h1 class="settings-title">设置</h1><p class="settings-sub">选择左侧的团队或系统设置。</p>`;
}

/* ---------- 右侧面板 ---------- */

function artifactTreeHtml(key) {
  const q = state.artifactFilter.trim().toLowerCase();
  const artifacts = ARTIFACTS[key].filter((a) => !q || (a.path || a.name).toLowerCase().includes(q));
  const root = { folders: {}, files: [] };
  artifacts.forEach((a) => {
    const parts = (a.path || a.name).split("/");
    const file = parts.pop();
    let node = root;
    parts.forEach((p) => {
      node.folders[p] = node.folders[p] || { folders: {}, files: [] };
      node = node.folders[p];
    });
    node.files.push({ ...a, fileName: file });
  });
  const render = (node, path = "") => {
    const folders = Object.entries(node.folders).sort(([a], [b]) => a.localeCompare(b, "zh"));
    const files = node.files.slice().sort((a, b) => a.fileName.localeCompare(b.fileName, "zh"));
    return folders.map(([name, child]) => {
      const full = path ? `${path}/${name}` : name;
      const open = q ? true : (state.openFolders[full] ?? (name === "docs"));
      return `<div class="tree-row tree-folder" data-action="toggle-folder" data-folder="${esc(full)}">
        <span class="tree-caret">${icon(open ? "chevron-down" : "chevron-right", 11)}</span>
        <span class="tree-folder-icon">${icon("folder", 14)}</span>
        <span class="tree-name">${esc(name)}</span>
      </div>${open ? `<div class="tree-children">${render(child, full)}</div>` : ""}`;
    }).join("") + files.map((a) => {
      const status = (a.status || "M").toLowerCase();
      const label = status === "info" ? "i" : a.status;
      return `<div class="tree-row tree-file" data-action="open-artifact" data-artifact="${a.id}" data-key="${key}" title="${esc(a.path || a.name)} · ${esc(a.meta)}">
        <span class="tree-caret"></span>
        <span class="tree-status ${status}">${esc(label)}</span>
        <span class="tree-name">${esc(a.fileName)}</span>
      </div>`;
    }).join("");
  };
  return render(root);
}

function formatTokens(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function renderRightPanel() {
  const panel = $("#rightpanel");
  const key = state.route === "chat/team" ? "team" : state.route === "chat/solo" ? "solo" : null;
  if (!key || !state.rightOpen) { panel.hidden = true; panel.innerHTML = ""; return; }
  panel.hidden = false;
  const artifacts = ARTIFACTS[key];
  const team = key === "team";
  const tabs = [["artifacts", "产出物"], ["trajectory", "轨迹"], ["changes", "变更"], ["git", "Git"], ["audit", "审计"]];
  const titles = { artifacts: "产出物", trajectory: team ? "对话轨迹" : "运行轨迹", changes: "变更记录", git: "Git", audit: "审计日志" };
  let body = "";

  if (state.rpTab === "artifacts") {
    body = `
      <div class="rp-section">
        <div class="rp-section-title"><span>产出物</span><span>${artifacts.length}</span></div>
        <label class="search-input file-filter">${icon("search", 12)}<input id="artifactFilter" placeholder="筛选文件…" value="${esc(state.artifactFilter)}"></label>
        <div class="file-tree">${artifactTreeHtml(key)}</div>
      </div>
      <div class="rp-note">文件产出按目录结构展示；点击文件预览，展开文件夹查看全部。变更、Git 与审计为 P1。</div>`;
  } else if (state.rpTab === "trajectory") {
    const usage = TOKEN_USAGE[key] || [];
    const total = usage.reduce((sum, u) => sum + u.input + u.output, 0);
    const totalCost = usage.reduce((sum, u) => sum + u.cost, 0);
    const max = Math.max(...usage.map((u) => u.input + u.output), 1);
    const trajectory = [...(key === "team" ? TEAM_TRAJECTORY : SOLO_TRAJECTORY)];
    if (team && state.teamConverged) trajectory.push({ time: "刚刚", kind: "converge", text: "指挥者收敛并生成《移动端评估.md》" });
    const roster = team
      ? (state.teamConverged
        ? [["host", "done", "已收敛"], ["pm", "done", "已完成"], ["arch", "done", "已完成"], ["researcher", "done", "已回复"], ["critic", "done", "已完成"]]
        : [["host", "running", "组织辩论"], ["pm", "done", "已完成 · 2m"], ["arch", "running", "回应反驳"], ["researcher", "waiting", "等待你"], ["critic", "offline", "排队 · 离线"]])
      : [["builder", "done", "已完成"]];
    const summary = team ? (state.teamConverged ? "5 已完成" : "3 工作中 · 1 等待你") : "1 已完成";
    body = `
      <div class="rp-section">
        <div class="rp-section-title"><span>本回合</span><span>${summary}</span></div>
        ${roster.map(([id, st, text]) => `<div class="roster-row">${agentAvatar(id, 24)}<span class="status-dot ${st === "running" ? "running" : st === "waiting" ? "waiting" : st === "done" ? "online" : "offline"}"></span><span class="roster-name">${esc(AGENTS[id].name)}</span><span class="roster-state ${st}">${text}</span></div>`).join("")}
      </div>
      <div class="rp-divider"></div>
      <div class="rp-section">
        <div class="rp-section-title"><span>轨迹</span><span>${trajectory.length}</span></div>
        ${trajectory.map((t) => `<div class="trajectory-item ${t.kind}"><span class="trajectory-time">${esc(t.time)}</span><span class="trajectory-dot"></span><span class="trajectory-text">${esc(t.text)}</span></div>`).join("")}
      </div>
      <div class="rp-divider"></div>
      <div class="rp-section">
        <div class="rp-section-title"><span>Token 消耗</span><span>${formatTokens(total)}</span></div>
        ${usage.map((u) => {
          const sum = u.input + u.output;
          return `<div class="token-row">${agentAvatar(u.id, 18, false)}<span class="token-name">${esc(AGENTS[u.id].name)}</span><span class="token-bar"><i style="width:${Math.round(sum / max * 100)}%"></i></span><span class="token-value">${formatTokens(sum)}</span></div>`;
        }).join("")}
        <div class="token-total"><span>合计 ${formatTokens(total)} tokens</span><span>$${totalCost.toFixed(2)}</span></div>
      </div>`;
  } else if (state.rpTab === "changes") {
    const changes = [
      ["M", "settings-navigation.ts", "+4 −0", "Builder"],
      ["A", "archived-sessions-page.tsx", "+18 −0", "Builder"],
      ["A", "settings-navigation.test.ts", "+9 −0", "Builder"],
    ];
    body = `<div class="rp-note" style="margin-top:0">P1 原型预览 · 来自本会话的运行</div>
      <div class="rp-section" style="margin-top:10px">
        <div class="rp-section-title"><span>文件变更</span><span>${changes.length}</span></div>
        ${changes.map(([kind, name, diff, by]) => `<div class="artifact-item" data-action="toast" data-msg="查看 ${esc(name)} 的 diff（P1 原型）">
          <span class="artifact-icon ${kind === "M" ? "md" : "test"}">${kind}</span>
          <div class="artifact-text"><div class="artifact-name">${esc(name)}</div><div class="artifact-meta">${esc(by)} · ${esc(diff)}</div></div>
          ${icon("chevron-right", 13)}
        </div>`).join("")}
      </div>
      <div class="rp-note">变更记录只展示本会话运行产生的文件；不会修改工作区。</div>`;
  } else if (state.rpTab === "git") {
    const commits = [
      ["feat: 设置页新增归档入口", "刚刚"],
      ["test: 覆盖导航入口", "2 分钟前"],
      ["chore: 更新依赖", "昨天"],
    ];
    body = `<div class="rp-note" style="margin-top:0">P1 原型预览 · 只读状态 + 基础提交</div>
      <div class="team-summary" style="margin-top:10px">
        <div class="summary-row"><span class="k">分支</span><span style="font-family:var(--font-mono);font-size:10.5px">feat/archived-sessions</span></div>
        <div class="summary-row"><span class="k">状态</span><span>3 个文件已修改</span></div>
        <div class="summary-row"><span class="k">工作区</span><span>Pizza 项目</span></div>
      </div>
      <div class="rp-section" style="margin-top:12px">
        <div class="rp-section-title"><span>提交历史</span><span>${commits.length}</span></div>
        ${commits.map(([msg, time]) => `<div class="roster-row"><span class="status-dot online"></span><span class="roster-name" style="font-weight:500">${esc(msg)}</span><span class="roster-state">${esc(time)}</span></div>`).join("")}
      </div>
      <button class="btn vscode-btn" data-action="toast" data-msg="打开 Git 面板（P1 原型）">${icon("git", 14)} 查看完整 Git 状态</button>`;
  } else {
    const events = [
      { t: "10:12:04", actor: "researcher", event: "agent.message", run: "run_9f2" },
      { t: "10:12:04", actor: "user", event: "user.interject", run: "run_9f2" },
      { t: "10:11:52", actor: "host", event: "agent.message", run: "run_9e1" },
      { t: "10:09:31", actor: "pm", event: "agent.message", run: "run_9d4" },
      { t: "10:07:18", actor: "host", event: "agent.dispatch", run: "run_9c0" },
    ];
    body = `<div class="rp-note" style="margin-top:0">P1 原型预览 · 敏感字段已脱敏</div>
      <pre class="audit-pre">${events.map((e) => `{"ts":"2026-11-03T${e.t}","actor":"${e.actor}","event":"${e.event}","run":"${e.run}"}`).join("\n")}</pre>
      <div class="rp-note">审计事件按追加写保存为 JSONL；可按会话、运行与智能体筛选。</div>`;
  }

  panel.innerHTML = `
    <div class="rp-head"><span class="rp-title">${titles[state.rpTab]}</span><button class="icon-btn" data-action="toggle-panel">${icon("x", 15)}</button></div>
    <div class="rp-tabs">
      ${tabs.map(([id, label]) => `<button class="rp-tab ${state.rpTab === id ? "active" : ""}" data-action="rp-tab" data-tab="${id}" ${id !== "artifacts" && id !== "trajectory" ? 'title="P1"' : ""}>${label}</button>`).join("")}
    </div>
    <div class="rp-body">${body}</div>`;
}

/* ---------- 管理页外壳 ---------- */

/* ---------- 主渲染 ---------- */

function renderMain() {
  const r = state.route;
  let html = "";
  if (r === "home") html = homeHtml();
  else if (r === "chat/team") html = chatHtml("team");
  else if (r === "chat/solo") html = chatHtml("solo");
  else if (isSettingsShellRoute()) html = settingsPage();
  else html = homeHtml();
  $("#main").innerHTML = html;
  if (r.startsWith("chat/")) requestAnimationFrame(scrollBottom);
  postRender();
}

function postRender() {
  $$(".brand-mark").forEach((el) => { if (!el.querySelector("svg")) el.innerHTML = brandMark(24); });
  $$("textarea").forEach((el) => autoResize(el));
  const range = $("#contextRange");
  if (range) {
    range.addEventListener("input", () => {
      const v = Number(range.value);
      $("#contextValue").textContent = Math.round(v / 1000) + "k";
    });
  }
}

function autoResize(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
  if (!el.value) el.style.height = "";
}

function render() {
  setRoute();
  renderTitlebar();
  renderSidebar();
  renderMain();
  renderRightPanel();
}

/* ---------- 交互：发送与模拟流式 ---------- */

function currentChatKey() {
  if (state.route === "chat/team") return "team";
  if (state.route === "chat/solo") return "solo";
  return null;
}

function resolveTargets(text, key) {
  if (key === "solo") {
    const session = SESSIONS.find((s) => s.id === state.activeSessionId);
    return [session?.mode === "solo" ? session.target : state.selectedAgent || "builder"];
  }
  const names = Array.from(text.matchAll(/@([一-龥A-Za-z0-9_]+)/g)).map((m) => m[1]);
  const found = names.map((n) => Object.values(AGENTS).find((a) => a.name === n)).filter(Boolean);
  return found.length ? [...new Set(found.map((a) => a.id))] : ["host"];
}

function replyFor(agentId, text, key) {
  if (key === "solo") {
    return "收到。我会先定位相关代码与测试，再给出最小改动方案。\n\n计划：\n1. 读取设置页导航与路由\n2. 复用现有会话列表组件\n3. 补一条回归测试\n\n需要我直接开始修改吗？";
  }
  const map = {
    host: `收到。我会把这条消息纳入当前回合：\n- 重新确认目标与约束\n- 把新的约束同步给相关成员\n- 在下一轮收敛时体现\n\n@产品经理 @架构师 请基于「${text.slice(0, 18)}」更新各自的判断，重点说明它是否改变结论。`,
    pm: "收到。我会从用户价值与场景角度补充：这条约束会提高「查看与审批」的优先级，但不会改变完整客户端的高成本判断。",
    arch: "收到。我会重新评估技术约束：如果成本降为次要因素，可以优先做体验验证，但仍然建议先复用现有渲染层，而不是直接分叉移动端架构。",
    researcher: "收到。我会补充证据：需要区分「愿意查看」与「愿意在手机上发起任务」，这两类需求的强度差异很大。",
    critic: "我需要指出一个风险：如果只做只读指挥台，用户会在最需要行动的时候被推回桌面；这会削弱移动端的核心价值。",
    builder: "收到。我先检查相关模块与测试，再给出最小改动方案。",
  };
  return map[agentId] || map.host;
}

function sendCurrent() {
  const key = currentChatKey();
  if (!key) return;
  const input = $("#composerInput");
  const text = (input?.value || "").trim();
  const pending = state.pending[key] || [];
  if (!text && !pending.length) { toast("先写一条消息"); return; }

  const skills = (text.match(/(^|\s)\/([a-z][a-z0-9-]+)/g) || []).map((s) => s.trim());
  // 用户回复后，等待卡片应视为已解决，避免在消息流里残留旧状态。
  state.threads[key] = state.threads[key].filter((m) => m.type !== "waiting");
  const msg = { type: "user", id: uid(), text: text || "（引用了能力）", time: nowTime() };
  state.threads[key].push(msg);
  if (state.streaming.timer) state.threads[key].push({ type: "system", text: "用户插话 · 已送达当前运行" });
  state.draft[key] = "";
  state.pending[key] = [];
  closePicker();
  renderMain();
  scrollBottom();

  const targets = resolveTargets(text, key);
  simulateReply(key, targets[0], text, skills);
}

function sendHome() {
  const input = $("#homeInput");
  const text = (input?.value || "").trim();
  if (!text) { toast("先写一句话，再开始"); return; }
  const team = state.homeMode === "team";
  const key = team ? "team" : "solo";
  const targetId = team ? state.homeTarget.team : state.homeTarget.agent;
  const title = text.length > 24 ? `${text.slice(0, 24)}…` : text;
  const session = {
    id: `sess-${Date.now()}`, title, mode: team ? "team" : "solo", target: targetId,
    group: "刚刚", status: "running", time: "刚刚", workspace: state.workspace,
  };
  SESSIONS.unshift(session);
  state.activeSessionId = session.id;
  if (team) state.selectedTeam = targetId;
  else state.selectedAgent = targetId;
  state.pending[key] = [...(state.pending[key] || []), ...(state.pending.home || [])];
  state.pending.home = [];
  // 从首页发起的是新会话，消息流应从空白开始，而不是复用上一段演示对话。
  state.threads[key] = [];
  state.threads[key].push({ type: "user", id: uid(), text, time: nowTime() });
  state.draft[key] = "";
  state.draft.home = "";
  navigate(team ? "#/chat/team" : "#/chat/solo");
  setTimeout(() => simulateReply(key, team ? "host" : targetId, text, [], session.id), 550);
}

function simulateReply(key, agentId, text, skills, sessionId = state.activeSessionId) {
  if (state.streaming.timer) {
    clearInterval(state.streaming.timer);
    state.streaming = { timer: null, key: null, id: null };
  }
  const full = replyFor(agentId, text, key);
  const a = AGENTS[agentId] || AGENTS.builder;
  const session = SESSIONS.find((s) => s.id === sessionId);
  if (session) session.status = "running";
  const msg = { type: "agent", id: uid(), agent: agentId, role: key === "team" ? (agentId === "host" ? "指挥者" : "成员") : "成员", time: nowTime(), text: "", state: "running" };
  state.threads[key].push(msg);
  renderMain();
  scrollBottom();

  let i = 0;
  const timer = setInterval(() => {
    i += 2 + Math.floor(Math.random() * 3);
    msg.text = full.slice(0, i);
    const el = document.querySelector(`[data-msg-id="${msg.id}"] .msg-content`);
    if (el) {
      el.innerHTML = md(msg.text) + '<span class="stream-cursor"></span>';
      scrollBottom();
    }
    if (i >= full.length) {
      clearInterval(timer);
      msg.text = full;
      msg.state = "done";
      if (session) session.status = "done";
      state.streaming = { timer: null, key: null, id: null };
      renderSidebar();
      renderMain();
      scrollBottom();
    }
  }, 34);
  state.streaming = { timer, key, id: msg.id };
  renderMain();
  scrollBottom();
}

function continueTeam() {
  if (state.streaming.timer) { toast("请先停止当前运行"); return; }
  const key = "team";
  state.threads.team = state.threads.team.filter((m) => m.type !== "waiting");
  state.threads.team.push({ type: "system", text: "研究员已回复 · 指挥者继续收敛" });
  state.threads.team.push({
    type: "agent", id: uid(), agent: "host", role: "指挥者", time: nowTime(),
    text: "收到。研究员的补充确认了关键边界：一期只做「查看 + 审批 + 轻回复」，触发智能体留到二期。\n\n**结论：建议做移动指挥台，而不是完整客户端。**\n- 一期范围：通知、审批、轻回复、查看产出物。\n- 关键前提：桌面端在线中继；离线场景明确不可用。\n- 未决问题：目标用户是个人开发者还是 3–10 人团队。\n\n完整评估已写入产出物，请审阅。",
  });
  state.threads.team.push({ type: "artifact", artifact: "mobile-md", text: "移动端评估.md", meta: "主持人 · 刚刚 · 4.2 KB" });
  state.teamConverged = true;
  renderMain(); scrollBottom(); renderRightPanel();
  toast("指挥者已收敛并生成最终文档");
}

function stopAll() {
  if (state.streaming.timer) {
    clearInterval(state.streaming.timer);
    const key = state.streaming.key;
    const msg = state.threads[key]?.find((m) => m.id === state.streaming.id);
    if (msg) msg.state = "cancelled";
    state.streaming = { timer: null, key: null, id: null };
    toast("已停止当前运行；已产出的内容会保留");
  } else {
    toast("当前没有运行中的任务");
  }
  renderMain();
}

/* ---------- 交互：选择器与菜单 ---------- */

function pickerItems(type, key) {
  if (type === "slash") {
    return [
      ...SKILLS.map((s) => ({ value: s.cmd, label: s.cmd, name: s.name, desc: s.desc, group: "Skill", kind: "skill", icon: "wand" })),
      { value: "/stop", label: "/stop", name: "停止当前运行", desc: "中止本回合所有正在运行的智能体", group: "命令", kind: "command", icon: "stop" },
      { value: "/clear", label: "/clear", name: "清空会话", desc: "清空当前会话消息（需确认）", group: "命令", kind: "command", icon: "trash" },
    ];
  }
  const t = TEAMS[state.selectedTeam];
  const ids = key === "team" ? t.members : ["builder"];
  const items = ids.map((id) => ({ value: `@${AGENTS[id].name} `, id, name: AGENTS[id].name, desc: AGENTS[id].desc, group: id === t.leader ? "指挥者" : "成员", kind: "agent" }));
  items.push({ value: "@我 ", name: "我", desc: "让智能体把问题交还给你", group: "人类", kind: "me" });
  return items;
}

function showPicker(type, anchor) {
  const key = currentChatKey();
  if (!key) return;
  const input = $("#composerInput");
  const before = input.value.slice(0, input.selectionStart);
  const m = before.match(/(^|\s)([@/])([^\s@/]*)$/);
  const start = m ? before.length - m[3].length - 1 : before.length;
  const query = m ? m[3] : "";
  state.picker = { type, key, start, query, anchor };
  renderPicker();
}

function renderPicker() {
  const p = state.picker;
  const root = $("#popover-root");
  if (!p) { root.innerHTML = ""; return; }
  const items = pickerItems(p.type, p.key).filter((it) => !p.query || (it.name + it.label + it.desc).toLowerCase().includes(p.query.toLowerCase()));
  const groups = [...new Set(items.map((i) => i.group))];
  const rect = p.anchor.getBoundingClientRect();
  const width = 340;
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  const bottom = Math.max(12, window.innerHeight - rect.top + 8);
  root.innerHTML = `<div class="popover-layer" data-action="close-picker"></div>
    <div class="picker" style="left:${left}px;bottom:${bottom}px" role="listbox">
      <div class="picker-head">${icon(p.type === "slash" ? "slash" : "at", 14)}<span class="picker-search" style="color:var(--ink-2)">${p.type === "slash" ? "引用 Skill 或命令" : "选择要 @ 的智能体"}</span><span class="kbd">esc</span></div>
      ${items.length ? groups.map((g) => `<div class="picker-group">${g}</div>${items.filter((i) => i.group === g).map((i, idx) => `<div class="picker-item ${idx === 0 && g === groups[0] ? "active" : ""}" data-action="picker-select" data-value="${esc(i.value)}" data-kind="${i.kind}" data-id="${i.id || ""}" role="option">
        ${i.kind === "agent" ? agentAvatar(i.id, 26, false) : i.kind === "me" ? userAvatar(26) : `<span class="artifact-icon" style="width:26px;height:26px">${icon(i.icon || "wand", 13)}</span>`}
        <span class="picker-text"><span class="picker-name">${esc(i.name)} ${i.kind === "skill" ? `<span class="badge" style="height:15px;font-size:8px">Skill</span>` : ""}</span><span class="picker-desc">${esc(i.desc || "")}</span></span>
        <span class="kbd">${esc(i.label)}</span>
      </div>`).join("")}`).join("") : `<div class="picker-empty">没有匹配项</div>`}
      <div class="picker-foot"><span>↑↓ 选择 · Enter 插入</span><span>${p.type === "slash" ? "已挂载 Skill" : "本会话成员"}</span></div>
    </div>`;
}

function closePicker() {
  state.picker = null;
  $("#popover-root").innerHTML = "";
}

function selectPickerItem(value, kind, id) {
  const p = state.picker;
  const input = $("#composerInput");
  if (!p || !input) return;
  const before = input.value.slice(0, p.start);
  const after = input.value.slice(input.selectionStart);
  const insert = (kind === "skill" || kind === "command") ? value + " " : value;
  input.value = before + insert + after;
  input.focus();
  const pos = (before + insert).length;
  input.selectionStart = input.selectionEnd = pos;
  state.draft[p.key] = input.value;
  if (kind === "skill") {
    const cmd = value.trim();
    state.pending[p.key].push({ id: uid(), type: "skill", label: cmd });
  }
  closePicker();
  autoResize(input);
  renderMain();
  requestAnimationFrame(() => {
    const el = $("#composerInput");
    if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
  });
}

function showPlusMenu(anchor) {
  const rect = anchor.getBoundingClientRect();
  const width = 270;
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  const bottom = Math.max(12, window.innerHeight - rect.top + 8);
  const item = (action, ic, title, sub) => `<div class="picker-item" data-action="${action}"><span class="artifact-icon" style="width:28px;height:28px">${icon(ic, 14)}</span><span class="picker-text"><span class="picker-name">${title}</span><span class="picker-desc">${sub}</span></span></div>`;
  $("#popover-root").innerHTML = `<div class="popover-layer" data-action="close-picker"></div>
    <div class="picker" style="left:${left}px;bottom:${bottom}px;width:${width}px">
      <div class="picker-group">文件</div>
      ${item("plus-file", "file", "添加文件", "代码、文本、PDF")}
      ${item("plus-image", "image", "添加图片", "截图、设计稿")}
      <div class="picker-group">能力</div>
      ${item("plus-skill", "wand", "引用 Skill", "只对本次消息生效")}
      ${item("plus-mcp", "plug", "引用 MCP 工具", "从已连接服务器选择")}
      <div class="picker-group">上下文</div>
      ${item("plus-workspace", "folder", "打开工作区文件夹", `当前：${currentWorkspace().name}`)}
      ${item("plus-artifact", "file-text", "引用产出物", "将文件加入本次上下文")}
    </div>`;
}

function addPending(item) {
  const key = currentChatKey() || "home";
  state.pending[key].push({ id: uid(), ...item });
  closePicker();
  renderMain();
  requestAnimationFrame(() => { const el = $("#composerInput"); if (el) el.focus(); });
}

/* ---------- 交互：弹层 ---------- */

function paletteAllItems() {
  return [
    { kind: "command", id: "new-chat", title: "新建对话", hint: "C", icon: "plus" },
    { kind: "command", id: "chat-agent", title: "和智能体对话", hint: "⌘J", icon: "chat" },
    { kind: "command", id: "new-team", title: "新建团队", hint: "", icon: "users" },
    { kind: "command", id: "add-runtime", title: "添加运行时", hint: "", icon: "plug" },
    { kind: "command", id: "settings", title: "打开设置", hint: "", icon: "settings" },
    { kind: "session", id: "mobile", title: "移动端要不要做", label: "会话", target: "brainstorm" },
    { kind: "session", id: "claude", title: "接入 Claude Code 运行时", label: "会话", target: "solo" },
    { kind: "session", id: "api", title: "评审 API 设计", label: "会话", target: "dev" },
    { kind: "agent", id: "host", title: "主持人", label: "智能体", target: "host" },
    { kind: "agent", id: "pm", title: "产品经理", label: "智能体", target: "pm" },
    { kind: "team", id: "brainstorm", title: "头脑风暴队", label: "团队", target: "brainstorm" },
  ].filter((item) => item.kind !== "agent" || !AGENTS[item.target]?.privateTeam);
}

function paletteFiltered() {
  const q = state.commandPalette.query.trim().toLowerCase();
  if (!q) return paletteAllItems();
  return paletteAllItems().filter((item) => `${item.title} ${item.label || ""} ${item.hint || ""}`.toLowerCase().includes(q));
}

function paletteItemIcon(item) {
  if (item.kind === "command") return `<span class="palette-icon">${icon(item.icon || "command", 15)}</span>`;
  if (item.kind === "session") {
    return item.target === "brainstorm" || item.target === "dev"
      ? teamAvatar(item.target, 26)
      : agentAvatar("builder", 26, false);
  }
  if (item.kind === "agent") return agentAvatar(item.target, 26, false);
  return teamAvatar(item.target, 26);
}

function renderCommandPalette(keepFocus = false) {
  const p = state.commandPalette;
  if (!p.open) return;
  const items = paletteFiltered();
  if (p.selected >= items.length) p.selected = Math.max(0, items.length - 1);
  const groups = [
    { label: "新建", items: items.filter((i) => i.kind === "command") },
    { label: "最近", items: items.filter((i) => i.kind !== "command") },
  ];
  let index = 0;
  const rows = groups.map((group) => {
    if (!group.items.length) return "";
    return `<div class="palette-group">${group.label}</div>${group.items.map((item) => {
      const i = index++;
      const right = item.kind === "command" ? (item.hint ? `<span class="palette-kbd">${item.hint}</span>` : "") : `<span class="palette-label">${item.label || ""}</span>`;
      return `<div class="palette-item ${i === p.selected ? "active" : ""}" data-action="palette-execute" data-index="${i}" role="option">
        ${paletteItemIcon(item)}
        <span class="palette-title">${esc(item.title)}</span>
        ${right}
      </div>`;
    }).join("")}`;
  }).join("");
  $("#overlay-root").innerHTML = `<div class="palette-backdrop" data-action="close-palette">
    <div class="palette" role="dialog" aria-label="搜索与命令">
      <div class="palette-search">${icon("search", 19)}<input id="paletteInput" value="${esc(p.query)}" placeholder="搜索，或输入要做的事…" autocomplete="off" spellcheck="false"><span class="palette-esc">Esc</span></div>
      <div class="palette-list">${rows || `<div class="picker-empty">没有匹配项</div>`}</div>
      <div class="palette-foot">
        <span class="pf"><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
        <span class="pf"><kbd>↵</kbd> 执行</span>
        <span class="pf"><kbd>⌘</kbd><kbd>↵</kbd> 在新标签页打开</span>
        <span class="pf-right"><span class="pf"><kbd>&gt;</kbd> 命令</span><span class="pf"><kbd>#</kbd> 会话</span><span class="pf"><kbd>@</kbd> 智能体</span></span>
      </div>
    </div>
  </div>`;
  if (keepFocus) {
    requestAnimationFrame(() => {
      const input = $("#paletteInput");
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    });
  }
}

function openCommandPalette() {
  state.commandPalette = { open: true, query: "", selected: 0 };
  renderCommandPalette(true);
}

function closeCommandPalette() {
  state.commandPalette.open = false;
  $("#overlay-root").innerHTML = "";
}

function executePalette(index) {
  const item = paletteFiltered()[index];
  if (!item) return;
  closeCommandPalette();
  if (item.kind === "command") {
    if (item.id === "new-chat") navigate("#/home");
    else if (item.id === "chat-agent") navigate("#/chat/solo");
    else if (item.id === "new-team") navigate("#/teams/edit");
    else if (item.id === "add-runtime") startRuntimeSetup();
    else if (item.id === "settings") navigate("#/settings/profile");
    return;
  }
  if (item.kind === "session") {
    if (item.target === "solo") navigate("#/chat/solo");
    else { state.selectedTeam = item.target; navigate("#/chat/team"); }
    return;
  }
  if (item.kind === "agent") { state.selectedAgent = item.target; navigate("#/agents/edit"); return; }
  if (item.kind === "team") { state.selectedTeam = item.target; navigate("#/teams/edit"); }
}

function openAccountMenu(anchor, submenu = null) {
  state.accountAnchor = anchor || state.accountAnchor;
  state.accountSubmenu = submenu;
  const el = state.accountAnchor;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const width = 300;
  const inRail = !!el.closest(".settings-rail");
  const left = inRail ? 72 : Math.max(12, Math.min(rect.left - 4, window.innerWidth - width - 12));
  const bottom = Math.min(window.innerHeight - 12, window.innerHeight - rect.top + 8);
  const maxHeight = Math.max(260, rect.top - 16);
  const themeLabel = state.themeChoice === "system" ? "跟随系统" : state.themeChoice === "dark" ? "深色" : "浅色";
  let content = "";

  if (submenu === "theme") {
    content = `<div class="account-sub-title">主题</div>
      ${[["light", "浅色", "sun"], ["dark", "深色", "moon"], ["system", "跟随系统", "monitor"]].map(([v, label, ic]) => `<button class="account-item" data-action="select-account-theme" data-choice="${v}">${icon(ic, 15)} ${label} ${state.themeChoice === v ? `<span class="account-check">${icon("check", 14)}</span>` : ""}</button>`).join("")}
      <div class="account-sep"></div><button class="account-item" data-action="account-back">${icon("arrow-left", 15)} 返回</button>`;
  } else if (submenu === "language") {
    content = `<div class="account-sub-title">语言</div>
      ${["简体中文", "English"].map((lang) => `<button class="account-item" data-action="select-account-language" data-language="${lang}">${icon("globe", 15)} ${lang} ${state.language === lang ? `<span class="account-check">${icon("check", 14)}</span>` : ""}</button>`).join("")}
      <div class="account-sep"></div><button class="account-item" data-action="account-back">${icon("arrow-left", 15)} 返回</button>`;
  } else {
    content = `<div class="account-head"><span class="account-head-avatar">${state.profileAvatar ? `<img class="profile-avatar-img" src="${esc(state.profileAvatar)}" alt="头像">` : "你"}</span><div><div class="account-head-name">Pizza 用户</div><div class="account-head-mail">you@pizza.local</div></div></div>
      <div class="account-sep"></div>
      <button class="account-item" data-action="account-profile">${icon("user", 15)} 个人资料</button>
      <button class="account-item" data-action="account-theme">${icon("sun", 15)} 主题 <span class="account-right">${themeLabel} ${icon("chevron-right", 12)}</span></button>
      <button class="account-item" data-action="account-language">${icon("globe", 15)} 语言 <span class="account-right">${esc(state.language)} ${icon("chevron-right", 12)}</span></button>
      <button class="account-item" data-action="account-shortcuts">${icon("command", 15)} 快捷键</button>
      <div class="account-sep"></div>
      <button class="account-item" data-action="toast" data-msg="打开文档（原型演示）">${icon("book", 15)} 文档 <span class="account-right">${icon("external", 11)}</span></button>
      <button class="account-item" data-action="toast" data-msg="打开更新日志（原型演示）">${icon("clock", 15)} 更新日志 <span class="account-right">${icon("external", 11)}</span></button>
      <button class="account-item" data-action="toast" data-msg="打开 Discord（原型演示）">${icon("chat", 15)} Discord <span class="account-right">${icon("external", 11)}</span></button>
      <div class="account-sep"></div>
      <button class="account-item danger" data-action="account-logout">${icon("log-out", 15)} 退出登录</button>`;
  }
  $("#popover-root").innerHTML = `<div class="popover-layer" data-action="close-picker"></div><div class="account-menu" style="left:${left}px;bottom:${bottom}px;width:${width}px;max-height:${maxHeight}px;overflow-y:auto" role="menu">${content}</div>`;
}

function applyWorkspaceFolder(folderName) {
  // 浏览器不暴露本机绝对路径，原型用目录名生成展示路径；接入桌面端后改为真实路径。
  const name = (folderName || "").trim() || "新工作区";
  let workspace = WORKSPACES.find((w) => w.name === name);
  if (!workspace) {
    workspace = { id: `ws-${Date.now()}`, name, path: `~/Documents/${name}` };
    WORKSPACES.push(workspace);
  }
  state.workspace = workspace.id;
  if (state.route.startsWith("chat/")) {
    const session = SESSIONS.find((s) => s.id === state.activeSessionId);
    if (session) session.workspace = workspace.id;
  }
  renderSidebar(); renderMain();
  toast(`已切换工作区到「${workspace.name}」`);
}

async function pickDirectory(onPick) {
  // 优先调用系统目录选择器；不支持时退回 webkitdirectory 文件输入。
  if (window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      onPick(handle.name);
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  const input = document.createElement("input");
  input.type = "file";
  input.webkitdirectory = true;
  input.style.display = "none";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) onPick((file.webkitRelativePath || "").split("/")[0] || "新工作区");
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

async function chooseWorkspaceFolder() {
  pickDirectory((folder) => applyWorkspaceFolder(folder));
}

async function chooseDefaultWorkspace() {
  pickDirectory((folder) => {
    state.defaultWorkspacePath = `~/${folder}`;
    renderMain();
    toast(`默认工作区已设为 ~/${folder}`);
  });
}

function pickAvatarFile(onPick) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.style.display = "none";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast("头像图片不能超过 2MB", "error"); input.remove(); return; }
    const reader = new FileReader();
    reader.onload = () => onPick(String(reader.result || ""));
    reader.readAsDataURL(file);
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

function uploadRuntimeAvatar() {
  pickAvatarFile((data) => { state.runtimeTest.avatar = data; renderMain(); });
}

function uploadAgentAvatar() {
  const agent = AGENTS[state.selectedAgent];
  if (!agent) return;
  pickAvatarFile((data) => { agent.avatar = data; renderMain(); });
}

function uploadTeamAvatar() {
  const team = TEAMS[state.selectedTeam];
  if (!team) return;
  pickAvatarFile((data) => { team.avatar = data; renderMain(); });
}

function uploadProfileAvatar() {
  pickAvatarFile((data) => { state.profileAvatar = data; renderMain(); toast("头像已更新"); });
}

function startRuntimeSetup(editingId = null) {
  const runtime = RUNTIMES.find((r) => r.id === editingId);
  state.runtimeTest = {
    status: "idle", step: 0,
    adapter: runtime?.id || "claude",
    icon: runtime?.icon || RUNTIME_ADAPTER_ICONS[runtime?.id] || "sparkle",
    avatar: runtime?.avatar || "",
    transport: "stdio", url: "",
    editingId: runtime?.id || null,
  };
  navigate("#/runtimes/new");
}

function openRuntimeMenu(anchor, id) {
  const rect = anchor.getBoundingClientRect();
  const width = 180;
  const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
  const top = Math.min(rect.bottom + 6, window.innerHeight - 104);
  $("#popover-root").innerHTML = `<div class="popover-layer" data-action="close-picker"></div>
    <div class="account-menu" style="left:${left}px;top:${top}px;width:${width}px" role="menu">
      <button class="account-item" data-action="edit-runtime" data-runtime="${id}">${icon("edit", 15)} 编辑</button>
      <button class="account-item danger" data-action="delete-runtime" data-runtime="${id}">${icon("trash", 15)} 删除</button>
    </div>`;
}

function openDeleteRuntimeModal(id) {
  const r = RUNTIMES.find((x) => x.id === id);
  if (!r) return;
  openModal(`<div class="modal" style="width:min(450px,92vw)">
    <div class="modal-head"><div><div class="modal-title">删除运行时</div><div class="modal-sub">「${esc(r.name)}」将从 Pizza 移除，引用它的智能体将无法运行。</div></div><button class="icon-btn modal-close" data-action="close-overlay">${icon("x", 15)}</button></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-action="close-overlay">取消</button><button class="btn btn-danger" data-action="confirm-delete-runtime" data-runtime="${r.id}">${icon("trash", 13)} 删除</button></div>
  </div>`);
}

function openDeleteConfirm(title, message, action, id) {
  openModal(`<div class="modal" style="width:min(450px,92vw)">
    <div class="modal-head"><div><div class="modal-title">${esc(title)}</div><div class="modal-sub">${esc(message)}</div></div><button class="icon-btn modal-close" data-action="close-overlay">${icon("x", 15)}</button></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-action="close-overlay">取消</button><button class="btn btn-danger" data-action="${action}" data-id="${id}">${icon("trash", 13)} 删除</button></div>
  </div>`);
}

function openDeleteAgentModal(id) {
  const a = AGENTS[id];
  if (!a) return;
  openDeleteConfirm("删除智能体", `「${a.name}」将从工作区移除，并从所有智能体团队中移除；若它是指挥者，会自动转移指挥者。`, "confirm-delete-agent", id);
}

function openDeleteTeamModal(id) {
  const t = TEAMS[id];
  if (!t) return;
  openDeleteConfirm("删除智能体团队", `「${t.name}」的成员覆盖与快照将一并删除；已有会话记录保留。`, "confirm-delete-team", id);
}

function openDeleteSkillModal(id) {
  const s = SKILLS.find((x) => x.id === id);
  if (!s) return;
  openDeleteConfirm("删除 Skill", `「${s.name}」将从工作区移除；引用它的智能体下次运行不再加载。`, "confirm-delete-skill", id);
}

function openDeleteMcpModal(id) {
  const m = MCPS.find((x) => x.id === id);
  if (!m) return;
  openDeleteConfirm("删除 MCP 服务器", `「${m.name}」将从配置中移除；依赖它的工具调用会失败。`, "confirm-delete-mcp", id);
}

function openSessionMenu(id, x, y) {
  const s = SESSIONS.find((item) => item.id === id);
  if (!s) return;
  const width = 236;
  const left = Math.max(10, Math.min(x - 12, window.innerWidth - width - 10));
  const top = Math.max(10, Math.min(y, window.innerHeight - 360));
  $("#popover-root").innerHTML = `<div class="popover-layer" data-action="close-picker"></div>
    <div class="account-menu session-menu" style="left:${left}px;top:${top}px;width:${width}px" role="menu">
      <button class="account-item" data-action="session-rename" data-session="${s.id}">${icon("edit", 15)} 重命名</button>
      <button class="account-item" data-action="session-fork" data-session="${s.id}">${icon("fork", 15)} 分叉会话</button>
      <button class="account-item" data-action="session-export" data-session="${s.id}">${icon("download", 15)} 导出会话</button>
      <div class="account-sep"></div>
      <button class="account-item danger" data-action="session-archive" data-session="${s.id}">${icon("archive", 15)} 归档</button>
      <button class="account-item danger" data-action="session-delete" data-session="${s.id}">${icon("trash", 15)} 永久删除</button>
    </div>`;
}

function openRenameSessionModal(id) {
  const s = SESSIONS.find((item) => item.id === id);
  if (!s) return;
  openModal(`<div class="modal" style="width:min(440px,92vw)">
    <div class="modal-head"><div><div class="modal-title">重命名会话</div><div class="modal-sub">只修改显示名称，不影响运行记录。</div></div><button class="icon-btn modal-close" data-action="close-overlay">${icon("x", 15)}</button></div>
    <div class="modal-body"><input class="input" id="renameSessionInput" value="${esc(s.title)}" autofocus></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-action="close-overlay">取消</button><button class="btn btn-primary" data-action="save-session-rename" data-session="${s.id}">保存</button></div>
  </div>`);
}

function openDeleteSessionModal(id) {
  const s = SESSIONS.find((item) => item.id === id);
  if (!s) return;
  openModal(`<div class="modal" style="width:min(440px,92vw)">
    <div class="modal-head"><div><div class="modal-title">永久删除会话</div><div class="modal-sub">「${esc(s.title)}」及其消息、运行记录和产出物将被删除，无法恢复。</div></div><button class="icon-btn modal-close" data-action="close-overlay">${icon("x", 15)}</button></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-action="close-overlay">取消</button><button class="btn btn-danger" data-action="confirm-session-delete" data-session="${s.id}">${icon("trash", 13)} 永久删除</button></div>
  </div>`);
}

function openWorkspaceMenu(anchor, id) {
  const w = WORKSPACES.find((x) => x.id === id);
  if (!w) return;
  const rect = anchor.getBoundingClientRect();
  const width = 232;
  const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
  const top = Math.min(rect.bottom + 6, window.innerHeight - 170);
  $("#popover-root").innerHTML = `<div class="popover-layer" data-action="close-picker"></div>
    <div class="account-menu workspace-menu" style="left:${left}px;top:${top}px;width:${width}px" role="menu">
      <button class="account-item" data-action="workspace-pin" data-workspace="${w.id}">${icon("pin", 15)} ${w.pinned ? "取消置顶" : "置顶"}</button>
      <button class="account-item" data-action="workspace-edit" data-workspace="${w.id}">${icon("edit", 15)} 编辑</button>
      <div class="account-sep"></div>
      <button class="account-item danger" data-action="workspace-archive" data-workspace="${w.id}">${icon("archive", 15)} 归档工作区</button>
    </div>`;
}

function openWorkspaceEditModal(w) {
  openModal(`<div class="modal" style="width:min(480px,92vw)">
    <div class="modal-head"><div><div class="modal-title">编辑工作区</div><div class="modal-sub">修改名称与目录，不会移动已有文件。</div></div><button class="icon-btn modal-close" data-action="close-overlay">${icon("x", 15)}</button></div>
    <div class="modal-body">
      <div class="field"><div class="field-label">名称</div><input class="input" id="workspaceEditName" value="${esc(w.name)}"></div>
      <div class="field"><div class="field-label">目录</div><input class="input" id="workspaceEditPath" value="${esc(w.path)}"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-action="close-overlay">取消</button><button class="btn btn-primary" data-action="save-workspace-edit" data-workspace="${w.id}">保存</button></div>
  </div>`);
}

function openWorkspaceModal() {
  openModal(`<div class="modal" style="width:min(480px,92vw)">
    <div class="modal-head"><div><div class="modal-title">添加工作区</div><div class="modal-sub">每个工作区独立保存会话、产出物与审计；智能体与运行时可以共享。</div></div><button class="icon-btn modal-close" data-action="close-overlay">${icon("x", 15)}</button></div>
    <div class="modal-body">
      <div class="field"><div class="field-label">名称</div><input class="input" id="workspaceName" placeholder="例如：report_test"></div>
      <div class="field"><div class="field-label">目录</div><input class="input" id="workspacePath" placeholder="~/Documents/report_test"></div>
      <div class="rp-note">工作区会并列显示在左侧栏；切换工作区后，会话列表只显示该工作区的内容。</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-action="close-overlay">取消</button><button class="btn btn-primary" data-action="create-workspace">添加工作区</button></div>
  </div>`);
}

function openHelpMenu(anchor) {
  const rect = anchor.getBoundingClientRect();
  const width = 258;
  const inRail = !!anchor.closest(".settings-rail");
  const left = inRail ? 72 : Math.max(12, Math.min(rect.left - 4, window.innerWidth - width - 12));
  const bottom = Math.min(window.innerHeight - 12, window.innerHeight - rect.top + 8);
  $("#popover-root").innerHTML = `<div class="popover-layer" data-action="close-picker"></div>
    <div class="account-menu help-menu" style="left:${left}px;bottom:${bottom}px;width:${width}px" role="menu">
      <button class="account-item" data-action="toast" data-msg="打开文档（原型演示）">${icon("book", 15)} 文档 <span class="account-right">${icon("external", 11)}</span></button>
      <button class="account-item" data-action="toast" data-msg="打开更新日志（原型演示）">${icon("clock", 15)} 更新日志 <span class="account-right">${icon("external", 11)}</span></button>
      <button class="account-item" data-action="toast" data-msg="打开 Discord（原型演示）">${icon("chat", 15)} Discord <span class="account-right">${icon("external", 11)}</span></button>
      <div class="account-sep"></div>
      <button class="account-item" data-action="toast" data-msg="打开反馈（原型演示）">${icon("chat", 15)} 反馈</button>
    </div>`;
}

function openShortcutsModal() {
  openModal(`<div class="modal" style="width:min(520px,92vw)">
    <div class="modal-head"><div><div class="modal-title">快捷键</div><div class="modal-sub">常用操作可以全键盘完成。</div></div><button class="icon-btn modal-close" data-action="close-overlay">${icon("x", 15)}</button></div>
    <div class="modal-body">
      <div class="settings-card" style="padding:2px 14px">
        ${[["新建对话", "⌘N"], ["搜索会话", "⌘K"], ["发送", "Enter"], ["换行", "Shift + Enter"], ["停止当前运行", "⌘."], ["切换右侧栏", "⌘⇧B"], ["折叠左侧栏", "⌘⇧S"], ["提及选择器", "@"]].map(([label, key]) => `<div class="settings-row"><div class="settings-row-text"><div class="settings-row-title">${label}</div></div><div class="settings-row-control"><kbd style="font-family:var(--font-mono);font-size:10px;padding:3px 6px;border:1px solid var(--line);border-radius:5px;background:var(--surface-2)">${key}</kbd></div></div>`).join("")}
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" data-action="close-overlay">完成</button></div>
  </div>`);
}

function openModal(html) {
  $("#overlay-root").innerHTML = `<div class="overlay-backdrop" data-action="close-overlay"></div>${html}`;
}

function closeOverlay() {
  $("#overlay-root").innerHTML = "";
}

function openArtifact(key, id) {
  const a = ARTIFACTS[key]?.find((x) => x.id === id);
  if (!a) return;
  openModal(`<div class="modal">
    <div class="modal-head"><div><div class="modal-title">${esc(a.name)}</div><div class="modal-sub">${esc(a.by)} · ${esc(a.meta)}</div></div><button class="icon-btn modal-close" data-action="close-overlay">${icon("x", 15)}</button></div>
    <div class="modal-body"><div class="doc-preview">${a.content}</div></div>
    <div class="modal-foot"><button class="btn" data-action="toast" data-msg="已在 Finder 中显示（原型演示）">${icon("folder", 13)} 显示文件</button><button class="btn" data-action="toast" data-msg="正在用 VS Code 打开（原型演示）">${icon("code", 13)} 在 VS Code 中打开</button><button class="btn btn-primary" data-action="close-overlay">完成</button></div>
  </div>`);
}

function openParticipantMenu(anchor) {
  const rect = anchor.getBoundingClientRect();
  const width = 342;
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  const top = Math.min(rect.bottom + 6, window.innerHeight - 220);
  const item = (kind, id, name, desc, selected) => {
    const av = kind === "team" ? teamAvatar(id, 26) : agentAvatar(id, 26, false);
    return `<div class="pm-item" data-action="select-participant" data-kind="${kind}" data-id="${id}">
      ${av}
      <span style="flex:1;min-width:0"><span class="pm-name">${esc(name)}</span><span class="pm-desc">${esc(desc)}</span></span>
      ${selected ? `<span class="pm-check">${icon("check", 14)}</span>` : ""}
    </div>`;
  };
  $("#popover-root").innerHTML = `<div class="popover-layer" data-action="close-picker"></div>
    <div class="participant-menu" style="left:${left}px;top:${top}px;width:${width}px" role="listbox" aria-label="选择参与者">
      <div class="pm-group">智能体</div>
      ${Object.values(AGENTS).filter((a) => !a.privateTeam).map((a) => item("agent", a.id, a.name, a.desc, state.homeMode === "solo" && state.homeTarget.agent === a.id)).join("")}
      <div class="pm-group">智能体团队</div>
      ${Object.values(TEAMS).map((t) => item("team", t.id, t.name, `${t.members.length} 名成员 · 指挥者 ${AGENTS[t.leader].name}`, state.homeMode === "team" && state.homeTarget.team === t.id)).join("")}
      <div class="pm-footer"><span>选择即决定会话模式</span><span>esc</span></div>
    </div>`;
}

function openMemberDrawer(id) {
  const a = AGENTS[id];
  const t = TEAMS[state.selectedTeam];
  if (!a) return;
  openModal(`<div class="drawer">
    <div class="drawer-head">${agentAvatar(id, 40)}<div style="flex:1"><div class="modal-title">${esc(a.name)} · 团队覆盖</div><div class="modal-sub">只影响「${esc(t.name)}」，不修改全局智能体。</div></div><button class="icon-btn" data-action="close-overlay">${icon("x", 15)}</button></div>
    <div class="field"><div class="field-label">Prompt</div><div class="segmented" style="width:100%"><button class="active" style="flex:1" data-action="override-mode">继承</button><button style="flex:1" data-action="override-mode">替换</button><button style="flex:1" data-action="override-mode">追加</button></div><div class="field-help">选择「替换/追加」后可编辑团队专用指令。</div></div>
    <div class="field"><div class="field-label">团队专用 Prompt</div><textarea class="textarea mono" style="min-height:120px" placeholder="例如：在本团队中，你只负责反方论证，不要给实施建议。"></textarea></div>
    <div class="field"><div class="field-label">Skill</div><div class="chip-list">${SKILLS.map((s) => `<span class="chip">${icon("wand", 11)} ${esc(s.name)} <button data-action="remove-override-chip">${icon("x", 10)}</button></span>`).join("")}<button class="chip" style="border-style:dashed;color:var(--muted)" data-action="toast" data-msg="添加 Skill（原型演示）">${icon("plus", 11)} 添加</button></div></div>
    <div class="field"><div class="field-label">MCP</div><div class="chip-list">${MCPS.slice(0, 3).map((m) => `<span class="chip">${icon("plug", 11)} ${esc(m.name)} <button data-action="remove-override-chip">${icon("x", 10)}</button></span>`).join("")}</div></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-action="restore-override">恢复继承</button><button class="btn btn-primary" data-action="save-override" data-member="${id}">保存覆盖</button></div>
  </div>`);
}

function openSkillDrawer(id) {
  const s = SKILLS.find((x) => x.id === id);
  if (!s) return;
  openModal(`<div class="drawer">
    <div class="drawer-head"><span class="artifact-icon" style="width:36px;height:36px;background:var(--accent-soft);color:var(--accent)">${icon("wand", 18)}</span><div style="flex:1"><div class="modal-title">${esc(s.name)}</div><div class="modal-sub">${s.cmd} · v${esc(s.version)} · ${esc(s.source)}</div></div><button class="icon-btn" data-action="close-overlay">${icon("x", 15)}</button></div>
    <div class="modal-body"><p>${esc(s.desc)}</p><pre style="font-family:var(--font-mono);font-size:10.5px;line-height:1.6;background:var(--surface-2);padding:10px;border-radius:8px;white-space:pre-wrap">---
name: ${s.id}
description: ${s.desc}
version: ${s.version}
---

# ${s.name}

## 何时使用
当任务涉及${s.desc}时。

## 步骤
1. 先确认输入与成功标准。
2. 按清单逐项检查。
3. 输出结论、依据与未决问题。</pre>
    <div class="field-help">被 ${s.usedBy} 个智能体引用。导入的 Skill 不会被执行或签名审查。</div></div>
    <div class="modal-foot"><button class="btn" data-action="toast" data-msg="更新来源（P1）">更新来源</button><button class="btn btn-primary" data-action="close-overlay">完成</button></div>
  </div>`);
}

function openMcpDrawer(id) {
  const m = MCPS.find((x) => x.id === id);
  if (!m) return;
  openModal(`<div class="drawer">
    <div class="drawer-head"><span class="artifact-icon" style="width:36px;height:36px;color:var(--blue);background:color-mix(in srgb, var(--blue) 10%, transparent)">${icon("plug", 18)}</span><div style="flex:1"><div class="modal-title">${esc(m.name)}</div><div class="modal-sub">${esc(m.transport)} · ${m.tools} 个工具 · ${m.status === "online" ? "健康" : "连接失败"}</div></div><button class="icon-btn" data-action="close-overlay">${icon("x", 15)}</button></div>
    <div class="modal-body"><p>${esc(m.desc)}</p>
      <div class="settings-card" style="padding:2px 12px">${["read_file", "write_file", "list_directory", "search"].map((t) => `<div class="settings-row"><div class="settings-row-text"><div class="settings-row-title" style="font-family:var(--font-mono);font-size:11px">${t}</div><div class="settings-row-desc">工具参数与返回值对智能体可见</div></div><div class="settings-row-control">${m.status === "online" ? `<span class="badge badge-green">可用</span>` : `<span class="badge badge-red">不可用</span>`}</div></div>`).join("")}</div>
      <div class="rp-note">配置保存后不再回显；修改需整体替换。危险工具默认逐次审批。</div>
    </div>
    <div class="modal-foot"><button class="btn" data-action="toast" data-msg="重新测试连接（原型演示）">${icon("refresh", 13)} 测试</button><button class="btn btn-primary" data-action="close-overlay">完成</button></div>
  </div>`);
}

function openAddMcp() {
  openModal(`<div class="modal">
    <div class="modal-head"><div><div class="modal-title">添加 MCP 服务器</div><div class="modal-sub">测试并发现工具后再保存。</div></div><button class="icon-btn modal-close" data-action="close-overlay">${icon("x", 15)}</button></div>
    <div class="modal-body">
      <div class="field"><div class="field-label">名称</div><input class="input" placeholder="例如：linear"></div>
      <div class="field"><div class="field-label">传输方式</div><div class="segmented"><button class="active">stdio</button><button>SSE</button><button>HTTP</button></div></div>
      <div class="field"><div class="field-label">命令 / URL</div><input class="input" style="font-family:var(--font-mono);font-size:11.5px" placeholder="npx -y @modelcontextprotocol/server-..."></div>
      <div class="field"><div class="field-label">环境变量 / Header</div><textarea class="textarea mono" style="min-height:80px" placeholder="KEY=value（保存到系统钥匙串）"></textarea></div>
      <div class="rp-note">配置只写：保存后 URL、Header 与环境变量不再回显。</div>
    </div>
    <div class="modal-foot"><button class="btn" data-action="toast" data-msg="测试并发现工具（原型演示）">测试并发现工具</button><button class="btn btn-primary" data-action="toast" data-msg="已保存 MCP 服务器（原型演示）">保存</button></div>
  </div>`);
}

function openPrivateMemberModal() {
  const t = TEAMS[state.selectedTeam];
  openModal(`<div class="modal" style="width:min(480px,92vw)">
    <div class="modal-head"><div><div class="modal-title">新建团队私有成员</div><div class="modal-sub">只存在于「${esc(t.name)}」，不进入全局智能体列表。</div></div><button class="icon-btn modal-close" data-action="close-overlay">${icon("x", 15)}</button></div>
    <div class="modal-body">
      <div class="field"><div class="field-label">名称</div><input class="input" id="privateMemberName" placeholder="例如：安全评审"></div>
      <div class="field"><div class="field-label">描述</div><input class="input" id="privateMemberDesc" placeholder="一句话说明它适合接什么活"></div>
      <div class="field"><div class="field-label">运行时</div><select class="select" id="privateMemberRuntime"><option>Claude Code</option><option>Codex</option><option>Hermes</option><option>Pi</option></select></div>
      <div class="rp-note">私有成员的 Prompt、Skill 与 MCP 可在成员卡片中覆盖；删除团队时默认保留为归档智能体。</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-action="close-overlay">取消</button><button class="btn btn-primary" data-action="create-private-member">创建并加入团队</button></div>
  </div>`);
}

function openAddMember() {
  const t = TEAMS[state.selectedTeam];
  const available = Object.values(AGENTS).filter((a) => !t.members.includes(a.id));
  openModal(`<div class="modal" style="width:min(480px,92vw)">
    <div class="modal-head"><div><div class="modal-title">添加成员</div><div class="modal-sub">从智能体库选择，或在团队内新建私有成员。</div></div><button class="icon-btn modal-close" data-action="close-overlay">${icon("x", 15)}</button></div>
    <div class="modal-body">
      ${available.length ? available.map((a) => `<div class="picker-item" data-action="add-member-select" data-member="${a.id}">${agentAvatar(a.id, 30, false)}<span class="picker-text"><span class="picker-name">${esc(a.name)}</span><span class="picker-desc">${esc(a.desc)}</span></span>${icon("plus", 14)}</div>`).join("") : `<div class="picker-empty">所有智能体都已在团队中</div>`}
    </div>
    <div class="modal-foot"><button class="btn" data-action="toast" data-msg="新建团队私有成员（原型演示）">${icon("plus", 13)} 新建私有成员</button><button class="btn btn-primary" data-action="close-overlay">完成</button></div>
  </div>`);
}

/* ---------- 交互：运行时测试 ---------- */

function runAcpTest() {
  if (state.testTimer) clearTimeout(state.testTimer);
  state.runtimeTest = { status: "running", step: 0, adapter: state.runtimeTest.adapter || "claude" };
  renderMain();
  const advance = () => {
    if (state.route !== "runtimes/new") { state.testTimer = null; return; }
    if (state.runtimeTest.step < 4) {
      state.runtimeTest.step += 1;
      renderMain();
      state.testTimer = setTimeout(advance, 620);
    } else {
      state.runtimeTest.status = "success";
      state.testTimer = null;
      renderMain();
      toast("连接成功：协议握手完成");
    }
  };
  state.testTimer = setTimeout(advance, 620);
}

/* ---------- 交互：事件 ---------- */

function onClick(e) {
  const nav = e.target.closest("[data-nav]");
  if (nav) { e.preventDefault(); closePicker(); closeOverlay(); navigate(nav.dataset.nav); return; }

  const session = e.target.closest("[data-session]");
  if (session && !e.target.closest("[data-action]")) {
    const s = SESSIONS.find((x) => x.id === session.dataset.session);
    if (s) {
      state.workspace = sessionWorkspace(s);
      state.activeSessionId = s.id;
      renderSidebar();
      if (s.mode === "team") { state.selectedTeam = s.target; navigate("#/chat/team"); }
      else { state.selectedAgent = s.target; navigate("#/chat/solo"); }
    }
    return;
  }
  const wsItem = e.target.closest("[data-workspace]");
  if (wsItem && !e.target.closest("[data-action]")) {
    state.workspace = wsItem.dataset.workspace;
    renderSidebar(); renderMain();
    return;
  }

  const agentRow = e.target.closest("[data-agent]");
  if (agentRow && !e.target.closest("[data-action]")) {
    state.selectedAgent = agentRow.dataset.agent;
    navigate("#/agents/edit");
    return;
  }

  const teamCard = e.target.closest("[data-team]");
  if (teamCard && !e.target.closest("[data-action]")) {
    state.selectedTeam = teamCard.dataset.team;
    navigate("#/teams/edit");
    return;
  }

  const skillRow = e.target.closest("[data-skill]");
  if (skillRow && !e.target.closest("[data-action]")) { openSkillDrawer(skillRow.dataset.skill); return; }
  const mcpRow = e.target.closest("[data-mcp]");
  if (mcpRow && !e.target.closest("[data-action]")) { openMcpDrawer(mcpRow.dataset.mcp); return; }

  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;

  switch (action) {
    case "toast": toast(el.dataset.msg || "原型演示"); break;
    case "close-overlay": closeOverlay(); break;
    case "close-picker": closePicker(); closeOverlay(); break;
    case "collapse": state.sidebarCollapsed = !state.sidebarCollapsed; renderSidebar(); break;
    case "new-chat": navigate("#/home"); break;
    case "pick-target": openParticipantMenu(el); break;
    case "select-participant": {
      if (el.dataset.kind === "team") {
        state.homeTarget.team = el.dataset.id; state.selectedTeam = el.dataset.id; state.homeMode = "team";
      } else {
        state.homeTarget.agent = el.dataset.id; state.homeMode = "solo";
      }
      closePicker(); renderMain(); break;
    }
    case "send-home": sendHome(); break;
    case "fill-prompt": {
      const input = $("#homeInput");
      if (input) { input.value = el.dataset.prompt; state.draft.home = input.value; autoResize(input); input.focus(); }
      break;
    }
    case "send": sendCurrent(); break;
    case "stop-all": stopAll(); break;
    case "focus-input": { const i = $("#composerInput"); if (i) i.focus(); break; }
    case "continue-team": continueTeam(); break;
    case "toggle-panel": state.rightOpen = !state.rightOpen; renderRightPanel(); postRender(); break;
    case "rp-tab": state.rpTab = el.dataset.tab; renderRightPanel(); break;
    case "toggle-folder": {
      const folder = el.dataset.folder;
      const current = state.openFolders[folder] ?? (folder === "docs");
      state.openFolders[folder] = !current;
      renderRightPanel();
      break;
    }
    case "open-artifact": openArtifact(el.dataset.key || currentChatKey(), el.dataset.artifact); break;
    case "toggle-tool": el.parentElement.classList.toggle("open"); break;
    case "copy-msg": {
      const id = el.dataset.msgId;
      const key = currentChatKey();
      const msg = state.threads[key]?.find((m) => m.id === id);
      if (msg) navigator.clipboard?.writeText(msg.text).catch(() => {});
      toast("已复制消息"); break;
    }
    case "quote-msg": toast("已引用到输入框（原型演示）"); break;
    case "retry-msg": toast("已重新发送该消息（原型演示）"); break;
    case "agent-tab": state.agentTab = el.dataset.tab; renderMain(); break;
    case "team-tab": state.teamTab = el.dataset.tab; renderMain(); break;
    case "preview-tab": state.previewTab = el.dataset.tab; renderMain(); break;
    case "save-agent": toast("已保存智能体"); break;
    case "save-team": toast("已保存团队配置"); break;
    case "set-leader": {
      const id = el.dataset.member;
      const t = TEAMS[state.selectedTeam];
      t.leader = id;
      if (!t.members.includes(id)) t.members.unshift(id);
      toast(`已设置 ${AGENTS[id].name} 为指挥者`); renderMain(); break;
    }
    case "remove-member": {
      const id = el.dataset.member;
      const t = TEAMS[state.selectedTeam];
      if (id === t.leader) { toast("请先更换指挥者", "error"); break; }
      t.members = t.members.filter((x) => x !== id);
      toast(`已移除 ${AGENTS[id].name}`); renderMain(); break;
    }
    case "edit-member": openMemberDrawer(el.dataset.member); break;
    case "override-mode": {
      const group = el.parentElement;
      $$("button", group).forEach((b) => b.classList.remove("active"));
      el.classList.add("active");
      break;
    }
    case "remove-override-chip": {
      const chip = el.closest(".chip");
      if (chip) chip.remove();
      break;
    }
    case "save-override": {
      const agent = AGENTS[el.dataset.member];
      if (agent) agent.overriddenTeams = [...new Set([...(agent.overriddenTeams || []), state.selectedTeam])];
      closeOverlay(); toast("已保存团队覆盖"); renderMain(); break;
    }
    case "restore-override": {
      const agent = AGENTS[el.dataset.member || state.selectedAgent];
      if (agent) agent.overriddenTeams = (agent.overriddenTeams || []).filter((id) => id !== state.selectedTeam);
      closeOverlay(); toast("已恢复继承"); renderMain(); break;
    }
    case "add-member": openAddMember(); break;
    case "add-member-select": {
      const id = el.dataset.member;
      const t = TEAMS[state.selectedTeam];
      if (!t.members.includes(id)) t.members.push(id);
      closeOverlay(); toast(`已添加 ${AGENTS[id].name}`); renderMain(); break;
    }
    case "save-snapshot": {
      const t = TEAMS[state.selectedTeam];
      state.snapshots.unshift({
        id: uid(), name: `${t.name} · v${state.snapshots.length + 1}`, time: "刚刚", note: "手动保存",
        config: { name: t.name, desc: t.desc, leader: t.leader, members: [...t.members], fanout: t.fanout, maxRounds: t.maxRounds },
      });
      toast("已保存团队快照"); renderMain(); break;
    }
    case "restore-snapshot": {
      const snap = state.snapshots.find((x) => x.id === el.dataset.snapshot);
      const t = TEAMS[state.selectedTeam];
      if (!snap?.config) break;
      Object.assign(t, {
        name: snap.config.name, desc: snap.config.desc, leader: snap.config.leader,
        members: [...snap.config.members], fanout: snap.config.fanout, maxRounds: snap.config.maxRounds,
      });
      toast(`已恢复「${snap.name}」`); renderMain(); break;
    }
    case "clone-snapshot": {
      const snap = state.snapshots.find((x) => x.id === el.dataset.snapshot);
      if (!snap?.config) break;
      const id = `team-${Date.now()}`;
      TEAMS[id] = { ...snap.config, id, name: `${snap.config.name} · 副本`, last: "刚刚", snapshots: 0, members: [...snap.config.members] };
      state.selectedTeam = id;
      navigate("#/teams/edit");
      toast(`已从快照复制「${snap.config.name}」`);
      break;
    }
    case "new-agent": state.selectedAgent = "host"; navigate("#/agents/edit"); break;
    case "select-adapter": state.runtimeTest.adapter = el.dataset.adapter; state.runtimeTest.icon = RUNTIME_ADAPTER_ICONS[el.dataset.adapter] || state.runtimeTest.icon; renderMain(); break;
    case "select-runtime-icon": state.runtimeTest.icon = el.dataset.icon; state.runtimeTest.avatar = ""; renderMain(); break;
    case "upload-runtime-avatar": uploadRuntimeAvatar(); break;
    case "upload-agent-avatar": uploadAgentAvatar(); break;
    case "upload-team-avatar": uploadTeamAvatar(); break;
    case "upload-profile-avatar": uploadProfileAvatar(); break;
    case "randomize-agent-avatar": {
      const agent = AGENTS[state.selectedAgent];
      if (!agent) break;
      const colors = ["#D9482B", "#D97706", "#16A34A", "#2563EB", "#7C3AED"];
      const glyphs = Object.keys(AVATAR_GLYPHS);
      agent.color = colors[Math.floor(Math.random() * colors.length)];
      agent.glyph = glyphs[Math.floor(Math.random() * glyphs.length)];
      agent.avatar = "";
      renderMain();
      toast("已生成随机头像");
      break;
    }
    case "randomize-team-avatar": {
      const team = TEAMS[state.selectedTeam];
      if (!team) break;
      team.avatar = randomAvatarDataUrl();
      renderMain();
      toast("已生成随机团队头像");
      break;
    }
    case "randomize-runtime-avatar": {
      const icons = ["sparkle", "terminal", "plug", "box", "zap", "layers", "cpu", "command"];
      state.runtimeTest.icon = icons[Math.floor(Math.random() * icons.length)];
      state.runtimeTest.avatar = "";
      renderMain();
      toast("已生成随机运行时图标");
      break;
    }
    case "reset-team-avatar": {
      const team = TEAMS[state.selectedTeam];
      if (!team) break;
      team.avatar = "";
      renderMain();
      toast("已恢复默认团队头像");
      break;
    }
    case "select-transport": state.runtimeTest.transport = el.dataset.transport; renderMain(); break;
    case "test-runtime": {
      const runtime = RUNTIMES.find((r) => r.id === el.dataset.runtime);
      state.runtimeTest = { status: "idle", step: 0, adapter: el.dataset.runtime, icon: runtime?.icon || "sparkle", avatar: runtime?.avatar || "", transport: "stdio", url: "" };
      navigate("#/runtimes/new");
      break;
    }
    case "select-avatar-preset": {
      const agent = AGENTS[state.selectedAgent];
      if (agent) { agent.color = el.dataset.color; agent.glyph = el.dataset.glyph; agent.avatar = ""; }
      toast("已更新头像");
      renderMain();
      break;
    }
    case "use-template": {
      const tpl = TEAM_TEMPLATES.find((t) => t.id === el.dataset.template);
      if (!tpl) break;
      const id = `team-${Date.now()}`;
      TEAMS[id] = { ...tpl, id, last: "刚刚", snapshots: 0, members: [...tpl.members] };
      state.selectedTeam = id;
      navigate("#/teams/edit");
      toast(`已从模板创建「${tpl.name}」`);
      break;
    }
    case "new-private-member": openPrivateMemberModal(); break;
    case "create-private-member": {
      const nameInput = $("#privateMemberName");
      const descInput = $("#privateMemberDesc");
      const runtimeInput = $("#privateMemberRuntime");
      const name = (nameInput?.value || "").trim() || "新成员";
      const desc = (descInput?.value || "").trim() || "团队私有角色";
      const runtime = runtimeInput?.value || "Claude Code";
      const id = `private-${Date.now()}`;
      const palette = ["#D9482B", "#D97706", "#16A34A", "#2563EB", "#7C3AED", "#8A6A4F"];
      AGENTS[id] = {
        id, name, short: name.slice(0, 1), role: "成员", desc,
        color: palette[Object.keys(AGENTS).length % palette.length], glyph: "target",
        runtime, runtimeId: "claude", presence: "online", model: "Claude Sonnet 4.5", thinking: "中",
        skills: [], mcp: [], privateTeam: state.selectedTeam,
      };
      const t = TEAMS[state.selectedTeam];
      if (!t.members.includes(id)) t.members.push(id);
      closeOverlay();
      toast(`已创建团队私有成员 ${name}`);
      renderMain();
      break;
    }
    case "acp-test": runAcpTest(); break;
    case "register-runtime": {
      if (state.runtimeTest.status !== "success") break;
      const name = ($("#runtimeNameInput")?.value || "").trim();
      const editing = RUNTIMES.find((x) => x.id === state.runtimeTest.editingId);
      if (editing) {
        if (name) editing.name = name;
        editing.icon = state.runtimeTest.icon || editing.icon;
        editing.avatar = state.runtimeTest.avatar || editing.avatar;
        toast("运行时已更新");
      } else {
        toast("运行时已注册");
      }
      state.runtimeTest = { ...state.runtimeTest, editingId: null };
      navigate("#/runtimes");
      break;
    }
    case "start-runtime-setup": startRuntimeSetup(); break;
    case "open-skill": openSkillDrawer(el.dataset.skill); break;
    case "open-mcp": openMcpDrawer(el.dataset.mcp); break;
    case "add-mcp": openAddMcp(); break;
    case "delete-agent": openDeleteAgentModal(el.dataset.id); break;
    case "delete-team": openDeleteTeamModal(el.dataset.id); break;
    case "delete-skill": openDeleteSkillModal(el.dataset.id); break;
    case "delete-mcp": openDeleteMcpModal(el.dataset.id); break;
    case "confirm-delete-agent": {
      const id = el.dataset.id;
      if (!AGENTS[id]) break;
      Object.keys(TEAMS).forEach((teamId) => {
        const team = TEAMS[teamId];
        team.members = (team.members || []).filter((member) => member !== id);
        if (team.leader === id) {
          if (team.members.length) team.leader = team.members[0];
          else delete TEAMS[teamId];
        }
      });
      delete AGENTS[id];
      if (state.selectedAgent === id) state.selectedAgent = Object.keys(AGENTS)[0] || "";
      if (!TEAMS[state.selectedTeam]) state.selectedTeam = Object.keys(TEAMS)[0] || "";
      closeOverlay(); renderMain(); toast("已删除智能体"); break;
    }
    case "confirm-delete-team": {
      const id = el.dataset.id;
      if (!TEAMS[id]) break;
      delete TEAMS[id];
      if (state.selectedTeam === id) state.selectedTeam = Object.keys(TEAMS)[0] || "";
      closeOverlay(); renderMain(); toast("已删除智能体团队"); break;
    }
    case "confirm-delete-skill": {
      const idx = SKILLS.findIndex((x) => x.id === el.dataset.id);
      if (idx >= 0) SKILLS.splice(idx, 1);
      closeOverlay(); renderMain(); toast("已删除 Skill"); break;
    }
    case "confirm-delete-mcp": {
      const idx = MCPS.findIndex((x) => x.id === el.dataset.id);
      if (idx >= 0) MCPS.splice(idx, 1);
      closeOverlay(); renderMain(); toast("已删除 MCP 服务器"); break;
    }
    case "runtime-menu": openRuntimeMenu(el, el.dataset.runtime); break;
    case "edit-runtime": {
      const id = el.dataset.runtime;
      closePicker(); startRuntimeSetup(id); break;
    }
    case "delete-runtime": {
      const id = el.dataset.runtime;
      closePicker(); openDeleteRuntimeModal(id); break;
    }
    case "confirm-delete-runtime": {
      const idx = RUNTIMES.findIndex((x) => x.id === el.dataset.runtime);
      if (idx >= 0) RUNTIMES.splice(idx, 1);
      closeOverlay(); renderMain(); toast("运行时已删除"); break;
    }
    case "settings-tab": state.settingsTab = el.dataset.tab; navigate(`#/settings/${el.dataset.tab}`); renderMain(); break;
    case "back-to-chat": {
      const session = SESSIONS.find((x) => x.id === state.activeSessionId);
      navigate(session ? (session.mode === "team" ? "#/chat/team" : "#/chat/solo") : "#/home");
      break;
    }
    case "toggle-theme": state.themeChoice = state.theme === "dark" ? "light" : "dark"; applyTheme(); renderMain(); break;
    case "stats-range": state.statsRange = el.dataset.range; renderMain(); break;
    case "theme-choice": {
      state.themeChoice = el.dataset.themeChoice;
      applyTheme(); renderMain(); break;
    }
    case "toggle-switch": el.classList.toggle("on"); break;
    case "open-plus": showPlusMenu(el); break;
    case "open-command-palette": openCommandPalette(); break;
    case "add-workspace": openWorkspaceModal(); break;
    case "create-workspace": {
      const name = ($("#workspaceName")?.value || "").trim();
      const path = ($("#workspacePath")?.value || "").trim();
      if (!name) { toast("请输入工作区名称", "error"); break; }
      const id = `ws-${Date.now()}`;
      WORKSPACES.push({ id, name, path: path || `~/Documents/${name}` });
      state.workspace = id;
      closeOverlay();
      toast(`已添加工作区 ${name}`);
      renderSidebar(); renderMain();
      break;
    }
    case "workspace-menu": openWorkspaceMenu(el, el.dataset.workspace); break;
    case "choose-workspace-folder": chooseWorkspaceFolder(); break;
    case "choose-default-workspace": chooseDefaultWorkspace(); break;
    case "session-menu": {
      const rect = el.getBoundingClientRect();
      openSessionMenu(el.dataset.session, rect.right, rect.bottom + 4);
      break;
    }
    case "session-rename": {
      const id = el.dataset.session;
      closePicker(); openRenameSessionModal(id); break;
    }
    case "save-session-rename": {
      const s = SESSIONS.find((x) => x.id === el.dataset.session);
      if (!s) break;
      const title = ($("#renameSessionInput")?.value || "").trim();
      if (!title) { toast("请输入会话名称", "error"); break; }
      s.title = title; closeOverlay(); renderSidebar(); renderMain(); toast("已重命名会话"); break;
    }
    case "session-fork": {
      const src = SESSIONS.find((x) => x.id === el.dataset.session);
      if (!src) break;
      const fork = {
        ...src,
        id: `sess-fork-${Date.now()}`,
        title: `${src.title}（分叉）`,
        archived: false,
        forkedFrom: src.id,
        time: "刚刚",
      };
      const idx = SESSIONS.findIndex((x) => x.id === src.id);
      SESSIONS.splice(idx + 1, 0, fork);
      state.workspace = sessionWorkspace(fork);
      state.activeSessionId = fork.id;
      closePicker();
      renderSidebar();
      if (src.mode === "team") state.selectedTeam = src.target;
      navigate(src.mode === "team" ? "#/chat/team" : "#/chat/solo");
      toast(`已分叉为「${fork.title}」`);
      break;
    }
    case "session-export": closePicker(); toast("已导出为 Markdown（原型演示）"); break;
    case "session-archive": {
      const s = SESSIONS.find((x) => x.id === el.dataset.session);
      if (!s) break;
      s.archived = true;
      if (state.activeSessionId === s.id) state.activeSessionId = null;
      closePicker(); renderSidebar(); toast(`已归档「${s.title}」`); break;
    }
    case "session-delete": {
      const id = el.dataset.session;
      closePicker(); openDeleteSessionModal(id); break;
    }
    case "confirm-session-delete": {
      const id = el.dataset.session;
      const idx = SESSIONS.findIndex((x) => x.id === id);
      if (idx >= 0) SESSIONS.splice(idx, 1);
      if (state.activeSessionId === id) state.activeSessionId = null;
      closeOverlay(); renderSidebar(); renderMain(); toast("会话已永久删除"); break;
    }
    case "new-session-in-workspace": {
      state.workspace = el.dataset.workspace;
      state.draft.home = "";
      navigate("#/home");
      setTimeout(() => { const input = $("#homeInput"); if (input) input.focus(); }, 120);
      break;
    }
    case "pin-workspace": {
      const w = WORKSPACES.find((x) => x.id === el.dataset.workspace);
      if (!w) break;
      w.pinned = !w.pinned;
      toast(w.pinned ? `已置顶工作区 ${w.name}` : `已取消置顶 ${w.name}`);
      renderSidebar(); renderMain();
      break;
    }
    case "workspace-pin": {
      const w = WORKSPACES.find((x) => x.id === el.dataset.workspace);
      if (!w) break;
      w.pinned = !w.pinned;
      closePicker(); toast(w.pinned ? `已置顶工作区 ${w.name}` : `已取消置顶 ${w.name}`); renderSidebar();
      break;
    }
    case "workspace-edit": {
      const w = WORKSPACES.find((x) => x.id === el.dataset.workspace);
      if (!w) break;
      openWorkspaceEditModal(w);
      break;
    }
    case "save-workspace-edit": {
      const id = el.dataset.workspace;
      const w = WORKSPACES.find((x) => x.id === id);
      if (!w) break;
      const name = ($("#workspaceEditName")?.value || "").trim();
      const path = ($("#workspaceEditPath")?.value || "").trim();
      if (!name) { toast("请输入工作区名称", "error"); break; }
      w.name = name; w.path = path || w.path;
      closeOverlay(); toast("工作区已更新"); renderSidebar(); renderMain();
      break;
    }
    case "workspace-archive": {
      const id = el.dataset.workspace;
      if (WORKSPACES.length <= 1) { toast("至少保留一个工作区", "error"); break; }
      const idx = WORKSPACES.findIndex((w) => w.id === id);
      if (idx < 0) break;
      WORKSPACES.splice(idx, 1);
      if (state.workspace === id) state.workspace = WORKSPACES[0].id;
      closePicker(); toast("工作区已归档"); renderSidebar(); renderMain();
      break;
    }
    case "close-palette": if (e.target === el) closeCommandPalette(); break;
    case "palette-execute": executePalette(Number(el.dataset.index)); break;
    case "open-account-menu": openAccountMenu(el); break;
    case "account-back": openAccountMenu(state.accountAnchor, null); break;
    case "account-theme": openAccountMenu(state.accountAnchor, "theme"); break;
    case "account-language": openAccountMenu(state.accountAnchor, "language"); break;
    case "select-account-theme": state.themeChoice = el.dataset.choice; applyTheme(); closePicker(); renderMain(); break;
    case "select-account-language": state.language = el.dataset.language; closePicker(); toast(`语言：${state.language}`); break;
    case "account-profile": closePicker(); navigate("#/settings/profile"); break;
    case "account-shortcuts": closePicker(); openShortcutsModal(); break;
    case "open-help-menu": openHelpMenu(el); break;
    case "account-logout": closePicker(); toast("本地模式无需登录"); break;
    case "open-editor": toast(`正在用 ${currentEditor().name} 打开工作区（原型演示）`); break;
    case "open-editor-menu": openEditorMenu(el); break;
    case "select-editor": {
      state.preferredEditor = el.dataset.editor;
      closePicker();
      toast(`首选编辑器：${currentEditor().name}`);
      renderMain();
      renderRightPanel();
      break;
    }
    case "plus-file": addPending({ type: "file", label: "设置页截图.png" }); break;
    case "plus-image": addPending({ type: "file", label: "移动端草图.png" }); break;
    case "plus-skill": {
      closePicker();
      const input = $("#composerInput");
      if (input) {
        const pos = input.selectionStart;
        input.value = input.value.slice(0, pos) + "/" + input.value.slice(pos);
        input.focus(); input.selectionStart = input.selectionEnd = pos + 1;
        state.draft[currentChatKey()] = input.value;
        showPicker("slash", input);
      }
      break;
    }
    case "plus-mcp": addPending({ type: "mcp", label: "github / create_issue" }); break;
    case "plus-workspace": closePicker(); chooseWorkspaceFolder(); break;
    case "plus-artifact": addPending({ type: "file", label: "移动端评估.md" }); break;
    case "open-mention": {
      const input = $("#composerInput");
      if (!input) break;
      const pos = input.selectionStart;
      input.value = input.value.slice(0, pos) + "@" + input.value.slice(pos);
      input.focus(); input.selectionStart = input.selectionEnd = pos + 1;
      state.draft[currentChatKey()] = input.value;
      showPicker("mention", input); break;
    }
    case "open-slash": {
      const input = $("#composerInput");
      if (!input) break;
      const pos = input.selectionStart;
      input.value = input.value.slice(0, pos) + "/" + input.value.slice(pos);
      input.focus(); input.selectionStart = input.selectionEnd = pos + 1;
      state.draft[currentChatKey()] = input.value;
      showPicker("slash", input); break;
    }
    case "picker-select": selectPickerItem(el.dataset.value, el.dataset.kind, el.dataset.id); break;
    case "remove-pending": {
      const key = currentChatKey() || "home";
      state.pending[key] = state.pending[key].filter((p) => p.id !== el.dataset.id);
      renderMain(); break;
    }
    default: break;
  }
}

function onInput(e) {
  const el = e.target;
  if (el.id === "composerInput") {
    const key = el.dataset.key;
    state.draft[key] = el.value;
    autoResize(el);
    const before = el.value.slice(0, el.selectionStart);
    const m = before.match(/(^|\s)([@/])([^\s@/]*)$/);
    if (m) {
      state.picker = { type: m[2] === "@" ? "mention" : "slash", key, query: m[3], anchor: el };
      renderPicker();
    } else if (state.picker) closePicker();
  } else if (el.id === "homeInput") {
    state.draft.home = el.value;
    autoResize(el);
  } else if (el.id === "agentSearch") {
    state.agentQuery = el.value;
    const pos = el.selectionStart;
    renderMain();
    requestAnimationFrame(() => { const x = $("#agentSearch"); if (x) { x.focus(); x.selectionStart = x.selectionEnd = pos; } });
  } else if (el.id === "teamSearch") {
    state.teamQuery = el.value;
    const pos = el.selectionStart;
    renderMain();
    requestAnimationFrame(() => { const x = $("#teamSearch"); if (x) { x.focus(); x.selectionStart = x.selectionEnd = pos; } });
  } else if (el.id === "artifactFilter") {
    state.artifactFilter = el.value;
    const pos = el.selectionStart;
    renderRightPanel();
    requestAnimationFrame(() => { const x = $("#artifactFilter"); if (x) { x.focus(); x.setSelectionRange(pos, pos); } });
  } else if (el.id === "paletteInput") {
    state.commandPalette.query = el.value;
    state.commandPalette.selected = 0;
    renderCommandPalette(true);
  } else if (el.dataset.setting === "defaultRuntime") {
    state.defaultRuntime = el.value;
    toast(`默认运行时：${el.options[el.selectedIndex].text}`);
  } else if (el.id === "settingsSearch") {
    const q = el.value.trim().toLowerCase();
    $$(".settings-nav-item").forEach((item) => {
      item.style.display = !q || item.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  }
}

function onKeydown(e) {
  const mod = e.metaKey || e.ctrlKey;
  if (state.commandPalette.open) {
    if (e.key === "Escape") { e.preventDefault(); closeCommandPalette(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = paletteFiltered();
      if (!items.length) return;
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      state.commandPalette.selected = (state.commandPalette.selected + delta + items.length) % items.length;
      renderCommandPalette(true);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      executePalette(state.commandPalette.selected);
      return;
    }
  }
  if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); openCommandPalette(); return; }
  if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); navigate("#/chat/solo"); return; }
  if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); navigate("#/home"); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === "b") { e.preventDefault(); state.rightOpen = !state.rightOpen; renderRightPanel(); return; }
  if (e.key === "Escape") {
    if (state.picker) { closePicker(); return; }
    if ($("#popover-root").innerHTML) { closePicker(); return; }
    if ($("#overlay-root").innerHTML) { closeOverlay(); return; }
  }
  if (state.picker && ["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) {
    const items = $$(".picker-item");
    if (!items.length) return;
    const idx = items.findIndex((x) => x.classList.contains("active"));
    if (e.key === "Escape") { closePicker(); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const active = items[idx < 0 ? 0 : idx];
      if (active) selectPickerItem(active.dataset.value, active.dataset.kind, active.dataset.id);
      return;
    }
    e.preventDefault();
    const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items.forEach((x) => x.classList.remove("active"));
    items[next].classList.add("active");
    items[next].scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && !state.picker) {
    if (e.target.id === "homeInput") { e.preventDefault(); sendHome(); }
    else if (e.target.id === "composerInput") { e.preventDefault(); sendCurrent(); }
  }
}

/* ---------- 提示 ---------- */

function toast(msg, type = "") {
  const root = $("#toast-root");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === "error" ? "alert" : "check", 13)} ${esc(msg)}`;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .2s"; setTimeout(() => el.remove(), 220); }, 2200);
}

/* ---------- 启动 ---------- */

function init() {
  try {
    const savedChoice = localStorage.getItem("pizza-theme-choice");
    if (savedChoice) state.themeChoice = savedChoice;
    else {
      const savedTheme = localStorage.getItem("pizza-theme");
      if (savedTheme) state.themeChoice = savedTheme;
    }
  } catch (_) {}
  const themeParam = new URLSearchParams(location.search).get("theme");
  if (themeParam === "dark" || themeParam === "light" || themeParam === "system") state.themeChoice = themeParam;
  applyTheme();
  $$(".brand-mark").forEach((el) => { el.innerHTML = brandMark(24); });
  $("#newChatIcon").innerHTML = icon("plus", 16);
  $("#collapseBtn").innerHTML = icon("panel-left", 16);

  $("#newChatBtn").addEventListener("click", () => navigate("#/home"));
  $("#searchBtn").addEventListener("click", () => openCommandPalette());
  $("#themeBtn").addEventListener("click", () => {
    state.themeChoice = state.theme === "dark" ? "light" : "dark";
    applyTheme(); renderMain();
  });
  $("#collapseBtn").addEventListener("click", () => { state.sidebarCollapsed = !state.sidebarCollapsed; renderSidebar(); });

  document.addEventListener("click", onClick);
  document.addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".ws-session");
    if (!row) return;
    e.preventDefault();
    openSessionMenu(row.dataset.session, e.clientX, e.clientY);
  });
  document.addEventListener("input", onInput);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("hashchange", () => { closePicker(); closeOverlay(); render(); });

  render();
}

document.addEventListener("DOMContentLoaded", init);
