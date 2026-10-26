import { BrowserWindow, screen, shell } from 'electron'
import { createMainWindow, loadWindowState, saveWindowState, type WindowState } from './window'
import { killWindowSessions } from './ptyService'

/** Each window owns its terminals and startup pack; application services are registered once. */
export class WindowManager {
  private windows = new Map<number, { window: BrowserWindow; autoPackId: string }>()

  constructor(private createWindow: (state: WindowState) => BrowserWindow = createMainWindow) {}

  create(autoPackId = ''): BrowserWindow {
    const source = BrowserWindow.getFocusedWindow() ?? [...this.windows.values()].at(-1)?.window
    let state: WindowState = loadWindowState()
    if (source && !source.isDestroyed()) {
      const bounds = source.getNormalBounds()
      const area = screen.getDisplayMatching(bounds).workArea
      const width = Math.min(bounds.width, area.width)
      const height = Math.min(bounds.height, area.height)
      state = { bounds: {
        x: Math.max(area.x, Math.min(bounds.x + 28, area.x + area.width - width)),
        y: Math.max(area.y, Math.min(bounds.y + 28, area.y + area.height - height)),
        width, height
      } }
    }
    const win = this.createWindow(state)
    const ownerId = win.webContents.id
    this.windows.set(ownerId, { window: win, autoPackId })
    win.on('close', () => saveWindowState(win))
    win.on('closed', () => {
      killWindowSessions(ownerId)
      this.windows.delete(ownerId)
    })
    win.webContents.setWindowOpenHandler(({ url }) => {
      try { if (['http:', 'https:'].includes(new URL(url).protocol)) void shell.openExternal(url) } catch { /* Ignore invalid links. */ }
      return { action: 'deny' }
    })
    return win
  }

  autoPackFor(ownerId: number): string { return this.windows.get(ownerId)?.autoPackId ?? '' }
}
