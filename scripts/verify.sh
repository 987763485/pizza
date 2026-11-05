#!/usr/bin/env bash
# 统一验收入口：类型检查、单元/集成测试、生产构建与 Electron E2E。
# Comet 的 Build/Verify 检查直接调用 `npm run verify`，保证本地与流程记录一致。
set -euo pipefail

npm run check:package
npm run typecheck
npm test
npm run build
npx playwright test
