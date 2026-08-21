# LiteMark

轻量级 Windows 桌面 Markdown 阅读器 / 编辑器，带语法检查与一键修复。

基于 Electron + CodeMirror 6 + markdown-it + KaTeX，主打**秒打开、够轻量、能查错**。

## 功能

- **阅读模式**：双击 `.md` 文件即以干净的排版呈现，支持 KaTeX 数学公式、代码高亮、相对路径图片、目录锚点跳转
- **编辑模式**：`F4` 一键进入分屏（左编辑 / 右实时预览），分割条可拖动且记忆位置，`Esc` 返回阅读
- **语法检查（Lint）**：
  - 括号配对（含全角 `（）【】「」`）
  - 加粗失效检测：`**` 未闭合、星号内侧空格导致不渲染等常见问题定位到行
  - LaTeX 检查：`$` / `$$` 配对、`\begin{} / \end{}` 匹配、公式内花括号平衡
  - 链接/图片语法残缺、表格管道符错位、标题层级跳跃
  - 自动跳过代码块与行内代码，避免误报
- **一键修复**：安全修复项支持单条修复或全部修复，修复前可见 diff 预览；编辑器悬停提示内也可直接修复
- **文件管理**：最近打开列表、拖拽打开、外部修改监听与重载提示、未保存关闭确认、CRLF 自动保持

## 快捷键

| 按键 | 功能 |
|---|---|
| `F4` | 阅读 ⇄ 编辑 分屏切换 |
| `Esc` | 返回阅读模式 |
| `Ctrl+S` / `Ctrl+Shift+S` | 保存 / 另存为 |
| `Ctrl+O` | 打开文件 |

## 开发

```bash
npm install        # 安装依赖
npm run dev        # 开发调试
npm run build      # 构建产物
npm run dist       # 打包 NSIS 安装包（含 .md 文件关联）
npm run typecheck  # 类型检查
```

> 若 Electron 二进制下载失败，先执行
> `$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"`，
> 再运行 `node node_modules\electron\install.js`。

## 技术栈

Electron · electron-vite · TypeScript · CodeMirror 6 · markdown-it · KaTeX · highlight.js · chokidar

## License

[MIT](./LICENSE)
