import { app, ipcMain, BrowserWindow, dialog } from 'electron'
import { mkdirSync } from 'node:fs'
import { registerPtyIpc, killAllSessions } from './ptyService'
import { WindowManager } from './WindowManager'
import { registerClipboardImageIpc } from './clipboardImages'
import { runDraftEditorHelper } from './draftEditor'

// 关键：让 Windows 任务栏/开始菜单识别这是独立应用，而不是 electron.exe 的默认图标
app.setAppUserModelId('com.sparkterminal.app')

// 测试/多开逃生口：SPARK_ALLOW_MULTI=1 时跳过单实例锁，
// 且允许用 SPARK_USER_DATA 指定独立 userData（互不干扰）
if (process.env['SPARK_USER_DATA']) {
  app.setPath('userData', process.env['SPARK_USER_DATA'])
  mkdirSync(process.env['SPARK_USER_DATA'], { recursive: true })
}

const windows = new WindowManager()

function registerWindowIpc() {
  ipcMain.handle('win:new', () => { windows.create() })
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
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  })
  // 启动参数：双击快捷方式想直接进某个内容包时用（bat 里 set SPARK_AUTO_PACK=<id>）
  ipcMain.handle('app:get-auto-pack', (event) => windows.autoPackFor(event.sender.id))
}

// One coordinator shares Chromium settings safely; every launch opens an independent window.
const allowMulti = process.env['SPARK_ALLOW_MULTI'] === '1'
const autoPackId = process.env['SPARK_AUTO_PACK'] || ''
const editingDraft = process.argv.includes('--spark-edit')
const gotLock = !editingDraft && (allowMulti || app.requestSingleInstanceLock({ autoPackId }))
if (editingDraft) {
  void app.whenReady().then(runDraftEditorHelper).then(() => app.exit(0), (error) => { console.error(error); app.exit(1) })
} else if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, _argv, _cwd, data) => {
    const request = data as { autoPackId?: unknown } | undefined
    const packId = typeof request?.autoPackId === 'string' ? request.autoPackId : ''
    void app.whenReady().then(() => { windows.create(packId) })
  })

  app.whenReady().then(() => {
    registerPtyIpc()
    registerClipboardImageIpc()
    registerWindowIpc()
    windows.create(autoPackId)
  })

  let cleanupStarted = false
  let cleanupFinished = false
  app.on('before-quit', (event) => {
    if (cleanupFinished) return
    event.preventDefault()
    if (cleanupStarted) return
    cleanupStarted = true
    void killAllSessions().finally(() => {
      cleanupFinished = true
      app.quit()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
