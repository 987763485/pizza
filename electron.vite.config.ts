import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve('src/shared'),
  '@renderer': resolve('src/renderer/src'),
  '@runtime-sdk': resolve('packages/runtime-sdk/src/index.ts'),
}

// 构建号必须固化进主进程产物；打包后用户环境不会保留构建时的 shell 变量。
const buildNumber = process.env.PIZZA_BUILD_NUMBER ?? 'dev'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __PIZZA_BUILD_NUMBER__: JSON.stringify(buildNumber),
    },
    resolve: { alias },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
  },
  renderer: {
    plugins: [react()],
    resolve: { alias },
  },
})
