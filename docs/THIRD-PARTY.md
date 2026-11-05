# 第三方组件与许可

Pizza 独立实现，但使用以下开源依赖。发布安装包时本文件随应用提供；各组件仍受其原始许可证约束。

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| Electron | 桌面运行时 | MIT |
| React / React DOM | 渲染层 | MIT |
| React Router | 路由 | MIT |
| Zustand | 客户端状态 | MIT |
| Zod | 运行时校验 | MIT |
| i18next / react-i18next | 国际化 | MIT |
| react-markdown / remark-gfm / rehype-highlight | Markdown 渲染 | MIT |
| react-nice-avatar / chroma-js | 随机头像生成 | MIT |
| highlight.js | 代码高亮 | BSD-3-Clause |
| chokidar | 文件监听 | MIT |
| fflate | ZIP 解压 | MIT |
| @modelcontextprotocol/sdk | MCP 客户端 | MIT |
| electron-vite / Vite | 构建 | MIT |
| TypeScript | 类型系统 | Apache-2.0 |
| Vitest / Playwright | 测试 | MIT / Apache-2.0 |
| electron-builder | 安装包构建 | MIT |

## 模型运行时

Pizza 不捆绑任何模型运行时。用户自行安装的 Claude Code、Codex、Pi、Oh My Pi、DeepSeek Harness、Hermes 等运行时及其模型服务受各自许可与条款约束，Pizza 仅通过本地协议调用。
