import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { PtyCompatibility } from '../src/shared/pty'

/**
 * preload 桥：渲染进程只能通过这里暴露的 API 与主进程通信，
 * 保持 contextIsolation = true 的安全模型（sandbox: true，无 Node 能力）。
 */
const api = {
  spawn: (opts: { cols?: number; rows?: number; cwd?: string; shell?: string }) =>
    ipcRenderer.invoke('pty:spawn', opts) as Promise<{ id: string; shellPath: string; candidates: string[] } & PtyCompatibility>,
  write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
  resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
  kill: (id: string) => ipcRenderer.send('pty:kill', id),
  detectShells: () => ipcRenderer.invoke('shell:detect') as Promise<string[]>,

  // 活着的 pty 会话清单（渲染进程热重载后重建绑定用）
  listSessions: () => ipcRenderer.invoke('pty:list') as Promise<({ id: string; shellPath: string } & PtyCompatibility)[]>,

  // 弹出系统目录选择框，返回选中路径（取消返回 null）
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder') as Promise<string | null>,
  resolveCwd: (cwd: string) => ipcRenderer.invoke('workspace:resolve', cwd) as Promise<string>,

  // 启动时是否要自动触发某个内容包 id（由 bat 脚本通过 SPARK_AUTO_PACK 注入）
  getAutoPack: () => ipcRenderer.invoke('app:get-auto-pack') as Promise<string>,

  /**
   * 取拖入文件的真实路径。
   * Electron 新版本已移除非标准的 File.path，必须走 webUtils（只能在渲染进程侧调用）。
   * 失败返回空串，调用方自行降级。
   */
  getPathForFile: (file: File): string => {
    try { return webUtils.getPathForFile(file) } catch { return '' }
  },

  // 事件订阅：返回 unsubscribe 函数
  onData: (id: string, cb: (data: string) => void) => {
    const ch = `pty:data:${id}`
    const listener = (_: unknown, data: string) => cb(data)
    ipcRenderer.on(ch, listener)
    return () => ipcRenderer.off(ch, listener)
  },
  onExit: (id: string, cb: (info: { exitCode: number; signal?: number }) => void) => {
    const ch = `pty:exit:${id}`
    const listener = (_: unknown, info: { exitCode: number; signal?: number }) => cb(info)
    ipcRenderer.on(ch, listener)
    return () => ipcRenderer.off(ch, listener)
  },

  // 窗口控制（自定义标题栏）
  window: {
    newWindow: () => ipcRenderer.invoke('win:new') as Promise<void>,
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggle-maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    setBg: (color: string) => ipcRenderer.invoke('win:set-bg', color)
  }
}

contextBridge.exposeInMainWorld('spark', api)

export type SparkApi = typeof api
