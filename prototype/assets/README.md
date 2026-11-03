# Pizza 品牌与应用图标

## 文件

| 文件 | 用途 |
| --- | --- |
| `app-icon.svg` | 应用图标矢量源文件（1024 × 1024） |
| `icon-1024.png` | 应用图标主文件，用于打包与商店素材 |
| `icon-512.png` / `icon-256.png` / `icon-192.png` | PWA、桌面与文档展示 |
| `icon-180.png` / `apple-touch-icon.png` | iOS / iPadOS 主屏图标 |
| `icon-128.png` / `icon-64.png` / `icon-32.png` | 桌面文件、favicon 等小尺寸 |
| `favicon.ico` / `favicon-32.png` | 浏览器标签页图标 |
| `Pizza.icns` | macOS 应用打包图标（包含 16–1024px 全尺寸） |
| `logo-mark.svg` | 透明背景品牌标记，用于界面内联或外部素材 |

## 设计

- 白色圆角底 + 一整块披萨缺一片：圆形饼身、右上角切片缺口，番茄红用于饼边与意式辣肠点缀。
- 缺口表达「切开、分一份、再拼回来」的产品理念。
- 图标保留足够内边距，32px 下仍能辨认披萨、缺口与红点。
- 界面内的品牌标记由 `prototype/js/icons.js` 的 `brandMark()` 生成，路径与 `logo-mark.svg` 一致。

## 重新生成

以 `icon-1024.png` 为主文件，用 `sips -z <size> <size>` 生成其余 PNG；`favicon.ico` 由 256px PNG 转换。
