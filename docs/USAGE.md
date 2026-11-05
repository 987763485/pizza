# Pizza 安装与首次使用

## 系统要求

- macOS 13 或更高版本
- Windows 10 或更高版本
- 主流 x64 Linux 发行版（AppImage / deb）
- 至少一个本地运行时（Claude Code、Codex、Pi、Oh My Pi、DeepSeek Harness、Hermes、OpenCode、Qoder CN、Gemini CLI、Kimi Code 或通用 ACP）
- 本机可写的数据目录，默认 `~/.pizza`

## 安装

**macOS**

1. 打开 `Pizza-<version>-arm64.dmg`，把 Pizza 拖入「应用程序」。
2. 首次打开时若系统提示来源未知，请在「系统设置 → 隐私与安全性」中允许打开。

**Windows**

1. 运行 `Pizza-Setup-<version>.exe`，按向导完成安装；或解压 `Pizza-<version>-win.zip` 后运行。
2. 若 SmartScreen 提示未知发布者，选择「更多信息 → 仍要运行」。

**Linux**

1. AppImage：添加执行权限后运行 `Pizza-<version>.AppImage`。
2. deb：使用系统包管理器安装 `Pizza-<version>.deb`。

安装包不包含模型运行时，也不会自动下载模型。

## 首次启动

1. 启动后先看到运行时检测页，列出本机可执行文件的检测结果。
2. 勾选已安装的运行时，点击「导入所选运行时」；Pizza 会逐个测试连接并注册成功的运行时。
3. 也可以直接进入首页，稍后在「设置 → 运行时」中配置。
4. 创建智能体并发送第一条消息；数据只写入本机。

## 运行时检测

Pizza 从 Finder / Dock 启动时会自动补全 Homebrew、nvm、fnm、bun、pnpm、`~/.local/bin`、`~/.opencode/bin`、`~/.qoder-cn/entry`、`~/.kimi-code/bin` 等常见可执行目录，避免图形应用继承的 PATH 过短导致检测不到已安装的运行时。

如果仍显示未安装，请先在终端确认 `which claude`、`which codex` 等命令可用，再点击「重新检测」；也可以在运行时页面手动填写命令路径。

Pizza 只调用 `which`/`where` 与 `<command> --version` 检测，不执行未知脚本。各运行时的安装方式以其官方文档为准；安装后需要登录时，请先在终端完成登录，再回到 Pizza 测试连接。

## 数据目录

- 默认：`~/.pizza`（数据库、附件、Skill、物化运行目录与产出物）。
- 可用环境变量 `PIZZA_DATA_DIR` 覆盖；设置页也支持切换目录。
- 切换采用「确认 → 下次启动复制 → 校验 → 切换 → 保留旧目录」；失败会继续使用旧目录并显示原因。

## 开发与打包

```bash
npm install
npm run dev          # 开发模式
npm run typecheck    # 类型检查
npm test             # 单元/集成测试
npm run test:e2e     # Electron 端到端测试
npm run build          # 生产构建
npm run package:mac    # 校验元数据、构建并生成 macOS dmg/zip
npm run package:win    # 生成 Windows nsis/zip
npm run package:linux  # 生成 Linux AppImage/deb
```

构建产物位于 `release/`。未签名产物只用于本地验收；正式签名、公证与 Gatekeeper 校验步骤见 `docs/RELEASE.md`。
