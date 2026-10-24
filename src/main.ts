import './styles/base.css'
import { TerminalController } from './terminal/TerminalController'
import { TitleBar } from './ui/TitleBar'
import { TabBar } from './ui/TabBar'
import { StatusBar } from './ui/StatusBar'
import { SettingsPanel } from './ui/SettingsPanel'
import { FindBox } from './ui/FindBox'
import { WorkspaceBar } from './ui/WorkspaceBar'
import { attachContextMenu } from './ui/ContextMenu'
import { ScrollBar } from './ui/ScrollBar'
import { themeManager } from './core/ThemeManager'
import { bus } from './core/EventBus'

function shellName(full: string): string {
  return full.split(/[\\/]/).pop() ?? full
}

async function main() {
  try {
    themeManager.apply(themeManager.current)

    const host = document.getElementById('terminal-host')!
    const controller = new TerminalController(host)

    new TitleBar()
    const findBox = new FindBox()
    const statusBar = new StatusBar()

    // 工作区：顶部栏选择/输入下次新标签的启动目录
    let workspaceCwd = localStorage.getItem('spark.cwd') || ''
    new WorkspaceBar((cwd) => { workspaceCwd = cwd })

    const settings = new SettingsPanel({
      getFontSize: () => controller.active()?.getFontSize() ?? 13,
      setFontSize: (n) => controller.active()?.setFontSize(n)
    })
    statusBar.bind(() => settings.toggle(document.getElementById('btn-settings')!))

    new TabBar({
      onClickTab: (id) => controller.activate(id),
      onCloseTab: (id) => controller.close(id),
      onNewTab: () => void controller.create(shellOf(controller), workspaceCwd || undefined)
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
    attachContextMenu(host, () => controller.active(), () => void controller.create(shellPath, workspaceCwd || undefined))

    // shell 候选：新 API 返回数组（带白名单），旧 preload 兼容单值
    let shellPath = ''
    if (typeof window.spark.detectShells === 'function') {
      const candidates = await window.spark.detectShells()
      shellPath = candidates[0] ?? ''
    } else {
      const legacy = await (window.spark as unknown as { detectShell?: () => Promise<string> }).detectShell?.()
      shellPath = legacy?.trim().split(/\r?\n/)[0] ?? ''
    }

    // 热重载恢复：优先接管主管里还活着的 pty 会话
    const restored = await controller.restore()

    if (!restored) await controller.create(shellPath, workspaceCwd || undefined)

    // 首个会话在 bus 监听注册前就绪时，显式补绑 find 目标
    const first = controller.active()
    if (first) {
      findBox.setSession(first)
      scrollBar.bind(first)
      statusBar.setZoom(first.getZoom())
      statusBar.setDim(first.term.cols, first.term.rows)
    }

    const ro = new ResizeObserver(() => controller.active()?.fit.fit())
    ro.observe(host)

    window.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.shiftKey && e.code === 'KeyT') { e.preventDefault(); void controller.create(shellPath, workspaceCwd || undefined); return }
      if (e.shiftKey && e.code === 'KeyW') { e.preventDefault(); const id = controller.active()?.ptyId; if (id) controller.close(id); return }
      if (e.code === 'KeyF' && !e.shiftKey && !e.altKey) {
        // 无条件弹出查找框（无论焦点是否在终端）
        e.preventDefault()
        bus.emit('search:toggle', {})
        return
      }
      if (e.code === 'Tab') {
        e.preventDefault()
        const all = controller.all()
        if (all.length < 2) return
        const idx = all.findIndex((s) => s.ptyId === controller.active()?.ptyId)
        const next = e.shiftKey ? (idx - 1 + all.length) % all.length : (idx + 1) % all.length
        controller.activate(all[next].ptyId)
        return
      }
      // Ctrl+1..9 切到第 N 个标签（Ctrl+9 恒为最后一个，VSCode 风）
      if (/^Digit[1-9]$/.test(e.code) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        const all = controller.all()
        if (all.length < 1) return
        const n = Number(e.code.slice(5))
        controller.activate(all[n === 9 ? all.length - 1 : n - 1].ptyId)
        return
      }
      const s = controller.active()
      if (!s) return
      if (e.code === 'Equal' || e.code === 'NumpadAdd') { e.preventDefault(); s.setZoom(s.getZoom() + 0.1) }
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract') { e.preventDefault(); s.setZoom(s.getZoom() - 0.1) }
      else if (e.code === 'Digit0' || e.code === 'Numpad0') { e.preventDefault(); s.setZoom(1) }
    })

    host.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const s = controller.active()
      if (!s) return
      const delta = e.deltaY < 0 ? 0.1 : -0.1
      s.setZoom(s.getZoom() + delta)
    }, { passive: false })

    // 拖文件进终端 → 粘贴带引号的路径（含空格也安全），并聚焦终端
    host.addEventListener('dragover', (e) => { e.preventDefault() })
    host.addEventListener('drop', (e) => {
      e.preventDefault()
      const files = [...(e.dataTransfer?.files ?? [])]
      const paths = files.map((f) => (f as File & { path?: string }).path).filter((p): p is string => !!p)
      if (!paths.length) return
      const line = paths.map((p) => (p.includes(' ') ? `"${p}"` : p)).join(' ')
      const s = controller.active()
      if (s) { window.spark.write(s.ptyId, line); s.focus() }
    })

    bus.on('session:created', () => {
      const s = controller.active()
      if (s) statusBar.setShell(shellName(s.shellPath || shellPath))
    })
  } catch (err) {
    console.error('[boot][FATAL]', err)
  }
}

function shellOf(controller: TerminalController): string {
  return controller.active()?.shellPath || ''
}

main()
