#!/usr/bin/env node
// 打包前校验版本、构建号与 electron-builder 元数据，避免关于页与安装包不一致。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?$/

export function validateMetadata({ root, pkg, env = process.env }) {
  const errors = []
  if (!pkg.name) errors.push('package.json 缺少 name')
  if (!SEMVER.test(String(pkg.version ?? ''))) {
    errors.push(`package.json version 不是合法语义化版本：${pkg.version}`)
  }
  if (!pkg.main) errors.push('package.json 缺少 main')

  const builderPath = join(root, 'electron-builder.yml')
  if (!existsSync(builderPath)) {
    errors.push('缺少 electron-builder.yml')
  } else {
    const yaml = readFileSync(builderPath, 'utf8')
    if (!/^appId:\s*\S+/m.test(yaml)) errors.push('electron-builder.yml 缺少 appId')
    if (!/^productName:\s*\S+/m.test(yaml)) {
      errors.push('electron-builder.yml 缺少 productName')
    }
    if (!/^mac:\s*$/m.test(yaml)) errors.push('electron-builder.yml 缺少 mac 配置')
    if (!/^win:\s*$/m.test(yaml)) errors.push('electron-builder.yml 缺少 win 配置')
    if (!/^linux:\s*$/m.test(yaml)) errors.push('electron-builder.yml 缺少 linux 配置')
  }

  if (!existsSync(join(root, 'resources', 'icon.icns'))) {
    errors.push('缺少 macOS 应用图标 resources/icon.icns')
  }
  if (!existsSync(join(root, 'resources', 'icon.png'))) {
    errors.push('缺少跨平台应用图标 resources/icon.png')
  }
  if (!existsSync(join(root, 'docs', 'THIRD-PARTY.md'))) {
    errors.push('缺少第三方归属文档 docs/THIRD-PARTY.md')
  }

  const build = env.PIZZA_BUILD_NUMBER
  if (build !== undefined && !/^\d+$/.test(String(build))) {
    errors.push(`PIZZA_BUILD_NUMBER 必须是非负整数：${build}`)
  }

  return {
    ok: errors.length === 0,
    errors,
    version: pkg.version,
    build: build ?? 'dev',
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd()
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const result = validateMetadata({ root, pkg })
  if (!result.ok) {
    console.error(`打包元数据校验失败：\n- ${result.errors.join('\n- ')}`)
    process.exit(1)
  }
  console.log(`打包元数据校验通过：v${result.version} · build ${result.build}`)
}
