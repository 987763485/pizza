# 发布与签名说明

当前 macOS / Windows / Linux 构建均为**未签名**产物，用于本地验收与内部分发。正式发布前需要完成各平台的签名与公证；本文件记录切换步骤，避免把未签名产物误认为正式包。

## 1. 当前构建

```bash
npm run package:mac
npm run package:win
npm run package:linux
```

- macOS：`release/Pizza-<version>-arm64.dmg`、`release/Pizza-<version>-arm64-mac.zip`
- Windows：`release/Pizza-Setup-<version>.exe`、`release/Pizza-<version>-win.zip`
- Linux：`release/Pizza-<version>.AppImage`、`release/Pizza-<version>.deb`
- 版本：`package.json` 的 `version`
- 构建号：环境变量 `PIZZA_BUILD_NUMBER`；未设置时为 `dev`
- 图标：macOS 使用 `resources/icon.icns`，由 `resources/icon-macos-1024.png` 生成（1024 画布、四周约 100px 透明边距，符合 macOS 图标网格）；Windows/Linux 使用 `resources/icon.png`
- 随包资源：`THIRD-PARTY.md`、`USAGE.md`
- 不包含任何模型运行时

`electron-builder.yml` 中 `mac.identity: null` 表示跳过签名；`gatekeeperAssess: false` 与 `hardenedRuntime: false` 仅适用于本地验收。

## 2. Windows / Linux

- Windows 未签名安装包会触发 SmartScreen；正式发布前应配置代码签名证书。
- Linux AppImage / deb 不依赖平台签名；正式发布前应校验包内容与依赖。
- 三个平台共用 `resources/icon.png` 作为 Windows/Linux 图标来源。
- Linux 使用 `package.json` 的 `desktopName` 与 `linux.syncDesktopName: true`，确保桌面环境能把窗口关联到 `.desktop` 入口；发布前请把 `homepage` 替换为真实产品地址。

## 3. 正式签名前置条件

1. Apple Developer Program 账号。
2. 本机钥匙串安装有效的 `Developer ID Application` 证书。
3. App Store Connect API Key 或 Apple ID 专用密码，用于公证。

## 4. 切换签名配置

1. 删除或注释 `mac.identity: null`。
2. 设置 `hardenedRuntime: true`，并移除 `gatekeeperAssess: false`。
3. 按 electron-builder 文档配置公证：

```bash
export APPLE_ID="<apple-id>"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="<team-id>"
npm run package:mac
```

或使用 App Store Connect API Key：

```bash
export APPLE_API_KEY="<path-to-AuthKey.p8>"
export APPLE_API_KEY_ID="<key-id>"
export APPLE_API_ISSUER="<issuer-id>"
```

4. 构建后在目标机器执行：

```bash
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/Pizza.app"
spctl --assess --type execute --verbose=4 "release/mac-arm64/Pizza.app"
```

5. 首次启动确认 Gatekeeper 不再提示来源未知，并完成一次真实运行时接入。

## 5. 自动更新

P0 不包含自动更新；设置项只记录偏好。接入自动更新前必须先完成签名、公证与更新源的安全设计。

## 6. 验收记录

未签名产物的实际验收结果记录在 `docs/ACCEPTANCE.md`。正式签名包发布前，应补充签名校验、公证票据与 Gatekeeper 结果。
