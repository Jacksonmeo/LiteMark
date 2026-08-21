# v0.2 功能设计 — 设置面板 · 主题 · 字号缩放

> 状态：待实施 · 原则：轻量化、简约实用、不过度设计
> 全部改动仅涉及渲染进程，主进程零改动（设置存 localStorage，不走 IPC）

## 1. 入口

顶栏按钮顺序变为：`打开 | 最近 | 设置`

- 「设置」按钮位于「最近」右侧
- 点击弹出设置弹窗（复用现有 modal 组件），改动即时生效并即时保存，无需"确定"按钮，弹窗右下角仅一个「关闭」

## 2. 设置项清单（最终范围，共 6 项）

| # | 设置项 | 形式 | 可选值 / 范围 | 默认值 |
|---|---|---|---|---|
| S1 | 外观主题 | 三选一按钮组 | 明亮 / 暗黑 / 跟随系统 | 跟随系统 |
| S2 | 预览字号 | 数字（步进 1） | 12 – 28 px | 16 |
| S3 | 编辑器字号 | 数字（步进 1） | 10 – 24 px | 14 |
| S4 | 同步滚动 | 开关 | 开 / 关 | 开 |
| S5 | 编辑器自动换行 | 开关 | 开 / 关 | 开 |
| S6 | 显示行号 | 开关 | 开 / 关 | 开 |

弹窗底部提供「恢复默认」文字按钮，一键还原以上全部。

### 明确不做（防蔓延）

自定义 CSS、字体族选择、快捷键自定义、界面语言切换、导出选项、最近文件数量调整 —— 一律不做。

## 3. 存储

localStorage 单键 JSON：

```
litemark.settings = {
  theme: 'system' | 'light' | 'dark',
  previewFontSize: 16,
  editorFontSize: 14,
  syncScroll: true,
  wordWrap: true,
  lineNumbers: true
}
```

- 启动时读取一次，缺项用默认值补齐
- 任一项变更立即写回（无防抖必要，写入成本可忽略）

## 4. 主题实现要点

- `style.css` 重构为 CSS 变量驱动：`--bg` `--fg` `--muted` `--border` `--code-bg` `--hover-bg` 等，组件样式全部改引变量
- `<html data-theme="light|dark">` 切换变量组；暗色覆盖块只写变量值 + 一小段 `.hljs-*` 前景色调色板（约 15 行，覆盖关键字/字符串/注释/数字/函数/标题即可）
- `theme: system` 时监听 `matchMedia('(prefers-color-scheme: dark)')` change 事件实时跟随
- KaTeX 公式继承 `currentColor`，随主题自适应，无需额外处理
- 现有 `github.css`（hljs 亮色）保留为基底，暗色用属性选择器提高优先级覆盖

## 5. Ctrl+滚轮字号缩放

- 交互：按住 Ctrl 滚动滚轮，**作用于鼠标当前悬停的窗格**
  - 阅读模式 → 调整预览字号（S2）
  - 编辑模式 → 悬停编辑区调 S3，悬停预览区调 S2
- 向上滚增大、向下滚减小，每格 ±1px，到达边界停住
- `wheel` 监听 `{ passive: false }` 并 `preventDefault()`，避免触发 Chromium 页面缩放
- 实时生效（CSS 变量），停止滚动后写回 localStorage
- 附带快捷键 `Ctrl+0`：重置当前悬停窗格的字号为默认值
- 弹窗中的 S2/S3 数字输入与滚轮共享同一存储键，双向同步

## 6. 各设置的生效方式

| 设置 | 生效机制 |
|---|---|
| S1 主题 | 切换 `html[data-theme]` + 注册/注销 media listener |
| S2 预览字号 | `--preview-font-size` 变量，`.md-body` 引用 |
| S3 编辑器字号 | `--editor-font-size` 变量，`.cm-editor .cm-scroller` 引用 |
| S4 同步滚动 | main.ts 中 bindScrollSync 的两个 handler 加开关判断 |
| S5 自动换行 | CodeMirror Compartment 重新配置 `EditorView.lineWrapping` |
| S6 行号 | CodeMirror Compartment 重新配置 `lineNumbers()` |

> 用两个 Compartment 承载 S5/S6，切换时 dispatch reconfigure，不重建编辑器实例。

## 7. 验收清单

- [ ] 顶栏出现「设置」按钮，点击弹出设置弹窗，Esc / 点遮罩可关闭
- [ ] 三种主题模式切换即时生效；「跟随系统」在 Windows 深浅色切换时实时响应
- [ ] 暗色下正文、代码块、KaTeX、问题面板、弹窗均无刺眼白底残留
- [ ] Ctrl+滚轮在阅读/编辑两模式下均能缩放对应窗格，Ctrl+0 重置
- [ ] 字号改动重启应用后保留
- [ ] 关闭同步滚动后两侧独立滚动
- [ ] 关闭自动换行/行号后编辑器即时变化，光标位置不丢失
- [ ] 「恢复默认」后所有设置回到上表默认值
- [ ] typecheck 通过，主进程代码无任何改动
