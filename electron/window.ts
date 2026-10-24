import { BrowserWindow, shell, app, screen } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** 窗口位置/大小持久化：存 userData/window-state.json */
export interface WindowState {
  bounds?: { x?: number; y?: number; width: number; height: number }
  isMaximized?: boolean
}

function stateFile(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

export function loadWindowState(): WindowState {
  try {
    if (existsSync(stateFile())) {
      const s = JSON.parse(readFileSync(stateFile(), 'utf-8')) as WindowState
      // 防呆：保存的视频模式可能落在已拔掉的显示器外
      if (s.bounds && s.bounds.width >= 500 && s.bounds.height >= 350) {
        // 坐标在任何显示器的可视范围都兜不住时，只丢位置保留大小
        // （loadWindowState 在 app ready 后调用，screen 可用）
        const b = s.bounds
        const onSomeDisplay = screen.getAllDisplays().some((d) => {
          const da = d.workArea
          const overlapOne = b.x != null && b.x < da.x + da.width && b.x + b.width > da.x
          const overlapTwo = b.y != null && b.y < da.y + da.height && b.y + b.height > da.y
          return overlapOne && overlapTwo
        })
        if (!onSomeDisplay) return { ...s, bounds: { width: b.width, height: b.height } }
      }
      return s
    }
  } catch { /* 损坏文件当无状态 */ }
  return {}
}

export function saveWindowState(win: BrowserWindow) {
  try {
    if (win.isMaximized()) {
      // 最大化时保留上一次的还原 bounds 更符合直觉：此处直接存 maximized 标记
      const prev = loadWindowState()
      writeFileSync(stateFile(), JSON.stringify({
        bounds: prev.bounds ?? undefined,
        isMaximized: true
      } satisfies WindowState))
    } else {
      const b = win.getBounds()
      writeFileSync(stateFile(), JSON.stringify({
        bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
        isMaximized: false
      } satisfies WindowState))
    }
  } catch { /* 存不进去就算了 */ }
}

export function createMainWindow(state: WindowState = {}): BrowserWindow {
  const b = state.bounds
  const win = new BrowserWindow({
    width: b?.width ?? 1180,
    height: b?.height ?? 760,
    x: b?.x,
    y: b?.y,
    minWidth: 640,
    minHeight: 420,
    show: false,
    frame: false,            // 自定义标题栏，年轻感
    titleBarStyle: 'hidden',
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    icon: join(__dirname, '../../build/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (state.isMaximized) win.maximize()
  win.on('ready-to-show', () => win.show())

  // 调试：把渲染进程 console / preload 错误转发到主进程 stdout
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message}  (${sourceId}:${line})`)
  })
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error(`[preload-error] ${preloadPath}:`, error)
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[did-fail-load] ${code} ${desc}`)
  })

  // 开发态加载 vite dev server，生产态加载打包产物
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 安全：仅放行 http/https 的站内导航，其余交给系统浏览器
  const isWebUrl = (url: string) => { try { return ['http:', 'https:'].includes(new URL(url).protocol) } catch { return false } }
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault()
      if (isWebUrl(url)) shell.openExternal(url)
    }
  })

  return win
}
