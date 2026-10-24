import { app, shell, ipcMain, BrowserWindow, dialog } from 'electron'
import { mkdirSync } from 'node:fs'
import { createMainWindow, loadWindowState, saveWindowState } from './window'
import { registerPtyIpc, killAllSessions } from './ptyService'

// 关键：让 Windows 任务栏/开始菜单识别这是独立应用，而不是 electron.exe 的默认图标
app.setAppUserModelId('com.sparkterminal.app')

// 测试/多开逃生口：SPARK_ALLOW_MULTI=1 时跳过单实例锁，
// 且允许用 SPARK_USER_DATA 指定独立 userData（互不干扰）
if (process.env['SPARK_USER_DATA']) {
  app.setPath('userData', process.env['SPARK_USER_DATA'])
  mkdirSync(process.env['SPARK_USER_DATA'], { recursive: true })
}

const mainWin = { ref: null as BrowserWindow | null }

function registerWindowIpc() {
  ipcMain.handle('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.handle('win:toggle-maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.handle('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.handle('win:set-bg', (e, color: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return
    BrowserWindow.fromWebContents(e.sender)?.setBackgroundColor(color)
  })
  ipcMain.handle('dialog:pick-folder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
}

// 单实例锁：避免多开（SPARK_ALLOW_MULTI=1 时放行，供测试/调试）
const allowMulti = process.env['SPARK_ALLOW_MULTI'] === '1'
const gotLock = allowMulti || app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // 第二个实例启动时，把已有窗口拉回前台
  app.on('second-instance', () => {
    const w = mainWin.ref
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  })

  app.whenReady().then(() => {
    const state = loadWindowState()
    const win = createMainWindow(state)

    mainWin.ref = win
    win.on('close', () => saveWindowState(win))
    win.on('closed', () => { mainWin.ref = null })

    // 外链一律交给系统浏览器，不在应用内打开；仅放行网页协议
    const isWebUrl = (url: string) => { try { return ['http:', 'https:'].includes(new URL(url).protocol) } catch { return false } }
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) shell.openExternal(url)
      return { action: 'deny' }
    })

    registerPtyIpc()
    registerWindowIpc()
  })

  app.on('before-quit', () => {
    // 退出前杀掉全部 pty，避免遗留 shell 子进程
    killAllSessions()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
