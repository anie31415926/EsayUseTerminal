# ⚡ Spark Terminal

<img src="build/icon-256.png" width="96" align="right" alt="Spark Terminal icon" />

一个基于 **Electron + xterm.js + node-pty** 的轻量、年轻、可扩展终端窗口。
VSCode 同款终端内核，渲染走 canvas，大数据量输出不卡。

## ✨ 功能

- [x] 内嵌真实终端（自动探测 `pwsh` / `powershell` / `cmd`）
- [x] 键盘输入命令、实时显示输出
- [x] 多标签页（Ctrl+Shift+T 新建，Ctrl+Shift+W 关闭，Ctrl+Tab 切换）
- [x] 多个独立窗口：重复启动 EXE、点击标题栏“新窗口”或按 Ctrl+Shift+N；各窗口的终端会话独立，关闭一个不会结束其他窗口的命令
- [x] 标签溢出导航：左右按钮、滚轮横向滚动、全部标签菜单；新建和切换时自动显示当前标签
- [x] 标签重命名：双击标题或 `F2` 内联编辑，右键可「恢复自动标题」，改名后锁定不被 shell 标题覆盖
- [x] 字体缩放：`Ctrl + =` / `Ctrl + -` / `Ctrl + 0`，或 **Ctrl + 鼠标滚轮**
- [x] 鼠标滚轮滚动、右侧拖动滚动条查看历史（scrollback 5000 行）
- [x] 拖文件进终端自动粘贴带引号的路径
- [x] 切换工作区：选择文件夹、点击 ✓ 或在路径框按 Enter，立即打开并激活该目录的新终端；原终端继续运行，新标签和内容包沿用所选工作区，无效目录明确报错
- [x] 深色活力主题（青柠 + 电光紫渐变点缀）
- [x] 自定义无框窗口、底部状态栏（shell / 行列 / 缩放比例）

## 🧱 技术栈与架构

```
┌─────────────────────────────────────────────┐
│ Renderer (Chromium, sandboxed)               │
│  ┌─────────────── EventBus ──────────────┐  │
│  │  TerminalController  ←→  TabBar       │  │
│  │       │                    StatusBar   │  │
│  │       ▼                    TitleBar   │  │
│  │  TerminalSession (xterm.js + addons)  │  │
│  └───────────────┬───────────────────────┘  │
└──────────────────┼───────────────────────────┘
                   │ contextBridge (window.spark)
┌──────────────────┼───────────────────────────┐
│ Main (Node.js)   ▼                           │
│  ptyService.ts  ←  node-pty  ←  cmd/pwsh    │
└─────────────────────────────────────────────┘
```

**解耦要点**：
- UI 组件（TabBar/StatusBar/TitleBar）**不直接调用** Controller，全部通过 `core/EventBus` 订阅事件 → 换 UI 框架、加插件都不动核心。
- `TerminalSession` 把 xterm 实例和 pty 连接封装成黑盒，对外只有 `show/hide/focus/setZoom/dispose`。
- 快捷键键位统一在 `src/shortcuts/bindings.ts` 定义，`core/ShortcutManager.ts` 负责组合键匹配、焦点作用域、优先级和注销；组件只注册命令处理函数，不自行监听键盘组合。
- `ui/InputEditor.ts` 只负责未发送文字的编辑、撤销和重做；`terminal/SessionInput.ts` 负责把草稿提交给当前会话，关闭会话时取消延迟发送。
- `electron/WindowManager.ts` 管理独立窗口与启动内容包；PTY 按窗口归属列出、操作和回收。多个窗口由同一应用进程协调，共享浏览器配置，避免多个进程竞争写入配置目录。
- `ui/TabScroller.ts` 独立处理标签横向滚动和全部标签菜单，`TabBar` 负责提供标签数据与激活回调。
- `core/WorkspaceManager.ts` 统一管理工作区校验与保存，`ui/WorkspaceBar.ts` 只负责输入和错误展示；主进程校验实际目录，明确路径无效时不静默回退。
- 主题是 CSS 变量 + `ThemeManager`，新增主题 = 新 CSS + 一条登记。
- preload 用 `contextBridge` 暴露最小 API，主进程永远拿不到渲染进程的 DOM。

## 📁 目录

```
terminal-app/
├── electron/                 # 主进程
│   ├── main.ts               # 入口、生命周期
│   ├── window.ts             # BrowserWindow 配置
│   ├── ptyService.ts          # node-pty 会话管理（IPC handler）
│   └── preload.ts             # contextBridge 安全桥
├── src/                      # 渲染进程
│   ├── main.ts                # 组装入口
│   ├── core/
│   │   ├── EventBus.ts        # 类型安全事件总线
│   │   └── ThemeManager.ts
│   ├── terminal/
│   │   ├── TerminalSession.ts # xterm + pty 单会话封装
│   │   └── TerminalController.ts # 多会话调度
│   ├── ui/
│   │   ├── TitleBar.ts
│   │   ├── TabBar.ts
│   │   └── StatusBar.ts
│   └── styles/
│       ├── base.css
│       └── theme-neon.css
└── electron.vite.config.ts
```

## 🚀 运行

```powershell
cd terminal-app
npm install        # node-pty 是原生模块，首次会本地编译；Windows 需要 VS Build Tools
npm run dev
```

日常启动使用 `启动-静默.vbs`、`启动-带控制台.bat` 或 `npm start`，直接加载构建产物，不启动开发服务器。源码或构建产物变化时会自动重建一次，后续启动复用缓存。

开发调试仍使用 `npm run dev`。构建：`npm run build`；生成安装包：`npm run dist`。

Windows 安装程序输出到 `dist/SparkTerminal Setup <版本>.exe`，安装后可直接启动，无需安装 Node.js 或启动开发服务器。`dist/win-unpacked/` 是用于验证的完整应用目录，运行其中的 EXE 时需保留同目录的依赖文件。

从旧版升级时先正常退出旧版窗口一次，再启动新版；之后重复启动会直接新建独立窗口。

## ⌨️ 快捷键

点击状态栏的“快捷键”、在设置里选择“查看全部快捷键”，或按 `F1` 打开完整列表。列表支持搜索操作、全部备用组合键及生效范围，从统一快捷键配置生成；按 `Esc` 关闭并恢复输入焦点。

| 快捷键 | 作用 |
|---|---|
| `Ctrl + =` / `Ctrl + -` / `Ctrl + 0` | 放大 / 缩小 / 复位字体 |
| `Ctrl + 滚轮` | 缩放字体 |
| `Ctrl + Shift + T` | 新建标签 |
| `Ctrl + Shift + N` | 新建独立窗口 |
| `Ctrl + Shift + W` | 关闭当前标签 |
| `Ctrl + Tab` / `Ctrl + Shift + Tab` | 切换标签 |
| `Ctrl + Shift + A` | 显示全部标签菜单 |
| `F2` | 重命名当前标签（也可双击标签标题） |
| `F1` | 打开 / 关闭快捷键列表 |
| `Ctrl + C` | 有选中则复制，无选中则发送 ETX 中断当前命令 |
| `Ctrl + Z` | 撤销未发送文字：PowerShell 使用 PSReadLine 原生撤销，Codex 内容包使用下方独立输入框 |
| `Ctrl + Y` / `Ctrl + Shift + Z` | 重做未发送文字 |
| `Ctrl + Shift + E` | 显示 / 隐藏当前标签的独立输入框 |
| `Enter` / `Shift + Enter` | 独立输入框内发送 / 换行 |

内置 Codex 内容包在完成初始注入后默认打开独立输入框。草稿在本地编辑，发送时才整段粘贴并单独提交回车；切换标签保留各自草稿。点击“终端输入”可操作 Codex 原生交互，再按 `Ctrl+Shift+E` 返回独立输入框。直接在 Codex 原生终端输入区域键入的文字仍由 Codex 自身管理，不具备本地草稿的撤销能力；已发送的内容不属于撤销范围。

> 注：刻意保留 `Ctrl+W` 给终端 readline（删除前一单词），未拦截。
> 底层 pty 在 Windows 上优先用 node-pty 自带的 `conpty.dll`（VS Code 同款），加载失败自动回退系统 ConPTY。

## 🔌 扩展点

1. **新主题**：在 `src/core/ThemeManager.ts` 的 `THEMES` 加一条，在 `src/styles/` 加个 css，UI 代码零改。
2. **新 shell（git bash / WSL / Cygwin）**：主进程 `electron/ptyService.ts` 的 `detectDefaultShell()` 加候选路径即可。
3. **新 addon**（选中即复制、分屏、查询、图片预览）：在 `TerminalSession` 构造函数里 `this.term.loadAddon(new XxxAddon())`。
4. **新 UI 面板**：订阅 `bus.on('session:created' | 'zoom:changed' | ...)`，无需改动 Controller。
5. **新快捷键**：在 `src/shortcuts/bindings.ts` 增加命令键位，通过 `registerShortcut()` 注册处理函数及作用域；注册会返回注销函数，临时组件销毁时调用它。菜单的快捷键提示通过 `shortcutLabel()` 从同一张表读取。
6. **新内容包**：在 `src/presets/builtin.ts` 增加配置，按需设置 `inputEditor: true` 使用独立草稿输入；多行提交要求目标应用支持整段粘贴。
