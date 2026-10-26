import './styles/base.css'
import { TerminalController } from './terminal/TerminalController'
import { TitleBar } from './ui/TitleBar'
import { TabBar } from './ui/TabBar'
import { StatusBar } from './ui/StatusBar'
import { SettingsPanel } from './ui/SettingsPanel'
import { ShortcutPanel } from './ui/ShortcutPanel'
import { shortcutLabel } from './shortcuts/bindings'
import { FindBox } from './ui/FindBox'
import { WorkspaceBar } from './ui/WorkspaceBar'
import { WorkspaceManager } from './core/WorkspaceManager'
import { PackBar } from './ui/PackBar'
import { launchPack } from './presets/launch'
import { BUILTIN_PACKS } from './presets/builtin'
import { attachContextMenu } from './ui/ContextMenu'
import { ScrollBar } from './ui/ScrollBar'
import { themeManager } from './core/ThemeManager'
import { bus } from './core/EventBus'
import { shortcuts } from './shortcuts'
import { registerAppShortcuts } from './shortcuts/registerAppShortcuts'

function shellName(full: string): string {
  return full.split(/[\\/]/).pop() ?? full
}

async function main() {
  try {
    themeManager.apply(themeManager.current)

    const host = document.getElementById('terminal-host')!
    const controller = new TerminalController(host)
    let shellPath = ''
    const workspace = new WorkspaceManager((cwd) => controller.create(shellPath, cwd))
    const detachShortcuts = shortcuts.attach(window)
    const unregisterShortcuts = registerAppShortcuts(controller, () => {
      void controller.create(shellPath, workspace.current || undefined)
    })
    window.addEventListener('unload', () => { unregisterShortcuts(); detachShortcuts() }, { once: true })

    new TitleBar()
    const findBox = new FindBox()
    const statusBar = new StatusBar()
    const shortcutPanel = new ShortcutPanel()
    const shortcutButton = document.getElementById('btn-shortcuts')!
    shortcutButton.title = `快捷键 (${shortcutLabel('shortcuts.toggle')})`
    shortcutButton.onclick = () => shortcutPanel.toggle()
    window.addEventListener('unload', () => shortcutPanel.dispose(), { once: true })

    const workspaceBar = new WorkspaceBar((cwd) => workspace.apply(cwd), workspace.current)
    try { await workspace.initialize() }
    catch (error) { workspaceBar.showError(error) }

    const settings = new SettingsPanel({
      getFontSize: () => controller.active()?.getFontSize() ?? 13,
      setFontSize: (n) => controller.active()?.setFontSize(n),
      onOpenShortcuts: () => shortcutPanel.toggle()
    })
    statusBar.bind(() => settings.toggle(document.getElementById('btn-settings')!))

    new TabBar({
      onClickTab: (id) => controller.activate(id),
      onCloseTab: (id) => controller.close(id),
      onNewTab: () => void controller.create(shellOf(controller), workspace.current || undefined)
    })

    // 会话切换：滚动条重绑 + 状态栏缩放显示同步
    const scrollBar = new ScrollBar(host)
    bus.on('session:active', ({ id }) => {
      const s = controller.all().find((x) => x.ptyId === id)
      if (s) {
        findBox.setSession(s)
        scrollBar.bind(s)
        statusBar.setZoom(s.getZoom())
        statusBar.setDim(s.term.cols, s.term.rows)
        statusBar.setShell(shellName(s.shellPath || 'shell'))
      }
    })

    // TabBar 拖拽重排 -> 会话顺序同步（Ctrl+Tab 邻居依赖）
    bus.on('tabs:reorder', ({ ids }) => controller.reorder(ids))

    // 终端右键菜单
    attachContextMenu(host, () => controller.active(), () => void controller.create(shellPath, workspace.current || undefined))

    // shell 候选：新 API 返回数组（带白名单），旧 preload 兼容单值
    if (typeof window.spark.detectShells === 'function') {
      const candidates = await window.spark.detectShells()
      shellPath = candidates[0] ?? ''
    } else {
      const legacy = await (window.spark as unknown as { detectShell?: () => Promise<string> }).detectShell?.()
      shellPath = legacy?.trim().split(/\r?\n/)[0] ?? ''
    }

    // 内容包：新建终端，等待输入就绪后自动启动、注入并发送。
    new PackBar((pack) => void launchPack(controller, shellPath, pack, workspace.current))

    // 热重载恢复：优先接管主管里还活着的 pty 会话
    const restored = await controller.restore()

    // 启动时是否被 bat/快捷方式指定了「自动进某个内容包」
    const autoPackId = (await window.spark.getAutoPack?.()) || ''
    const autoPack = BUILTIN_PACKS.find((p) => p.id === autoPackId)

    if (autoPack) {
      // 双击快捷方式直达：不开默认空标签，直接建包对应的会话
      console.log(`[boot] 自动启动内容包：${autoPack.id}`)
      void launchPack(controller, shellPath, autoPack, workspace.current)
    } else if (!restored) {
      await controller.create(shellPath, workspace.current || undefined)
    }

    // 首个会话在 bus 监听注册前就绪时，显式补绑 find 目标
    const first = controller.active()
    if (first) {
      findBox.setSession(first)
      scrollBar.bind(first)
      statusBar.setZoom(first.getZoom())
      statusBar.setDim(first.term.cols, first.term.rows)
      statusBar.setShell(shellName(first.shellPath || 'shell'))
    }

    host.addEventListener('wheel', (e) => {
      if (!e.ctrlKey || e.deltaY === 0) return
      e.preventDefault()
      e.stopPropagation()
      const s = controller.active()
      if (!s) return
      const delta = e.deltaY < 0 ? 0.1 : -0.1
      s.setZoom(s.getZoom() + delta)
    }, { passive: false, capture: true })

    // 拖文件进终端 → 粘贴带引号的路径（含空格也安全），并聚焦终端
    host.addEventListener('dragover', (e) => { e.preventDefault() })
    host.addEventListener('drop', (e) => {
      e.preventDefault()
      const files = [...(e.dataTransfer?.files ?? [])]
      // File.path 在 Electron 新版本已被移除，改用 preload 的 webUtils 桥；旧版本回退取值
      const paths = files
        .map((f) => window.spark.getPathForFile?.(f) || (f as File & { path?: string }).path || '')
        .filter((p): p is string => !!p)
      if (!paths.length) return
      const line = paths.map((p) => (p.includes(' ') ? `"${p}"` : p)).join(' ')
      const s = controller.active()
      if (s) { window.spark.write(s.ptyId, line); s.focus() }
    })

    // 会话关闭：查找框 / 滚动条别再抓着已经 dispose 的 term
    bus.on('session:closed', ({ id }) => {
      if (findBox.sessionId === id) findBox.setSession(null)
      if (scrollBar.sessionId === id) scrollBar.unbind()
    })
  } catch (err) {
    console.error('[boot][FATAL]', err)
  }
}

function shellOf(controller: TerminalController): string {
  return controller.active()?.shellPath || ''
}

main()
