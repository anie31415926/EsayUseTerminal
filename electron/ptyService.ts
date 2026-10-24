import { ipcMain, BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as fs from 'node:fs'

const execFileAsync = promisify(execFile)

/**
 * 起一个 pty。Windows 上优先用 node-pty 自带的 conpty.dll（VS Code 同款）。
 * 原因：系统 ConPTY 的 kill() 会 fork 一个 conpty_console_list_agent 去枚举控制台进程，
 * 而原生 kill 几乎同时就把控制台销毁了，两者抢时序 —— agent 里的 AttachConsole 必然失败，
 * 于是每关一个标签/退出应用，就往控制台吐一坨未捕获异常栈（功能无影响，纯噪音）。
 * conpty.dll 的 kill 走另一条分支，不 fork agent，因此彻底没有这个问题。
 * dll 加载不出来时（比如被安全软件拦）自动回退系统 ConPTY，功能不受影响。
 */
function spawnPty(shellPath: string, cwd: string, cols: number, rows: number): pty.IPty {
  // windowsHide 在 typings 里没收录，但运行时透传给 ConPTY/winpty，保留兜底
  const opts: pty.IWindowsPtyForkOptions & { windowsHide?: boolean } = {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    // windowsHide: 兜底老版本 ConPTY 不可用时避免弹出黑框
    windowsHide: true,
    useConpty: true
  }

  if (process.platform === 'win32') {
    try {
      return pty.spawn(shellPath, [], { ...opts, useConptyDll: true })
    } catch (err) {
      console.warn('[pty] conpty.dll 不可用，回退系统 ConPTY：', (err as Error)?.message ?? err)
    }
  }
  return pty.spawn(shellPath, [], opts)
}

/** 窗口或 webContents 任一销毁后都别再 send，否则主进程会抛 Object has been destroyed */
function canSend(win: BrowserWindow): boolean {
  return !win.isDestroyed() && !win.webContents.isDestroyed()
}

/**
 * PtySession —— 主进程侧的单个终端会话封装。
 * 与渲染进程的 TerminalSession 一一对应，通过 IPC 解耦。
 */
class PtySession {
  readonly id: string
  private proc: pty.IPty
  private win: BrowserWindow
  readonly shellPath: string
  /**
   * 进程是否已经结束。
   * 对已退出的 pty 再 kill 是纯粹的坑（Windows 上会 fork 枚举控制台进程的 agent 并抛
   * AttachConsole failed）。虽然现在默认走 conpty.dll 不再 fork，但闸门留着：
   * 幂等 + 保住回退系统 ConPTY 时的那条路径。
   */
  private exited = false
  private buf = ''
  private flushTimer: NodeJS.Timeout | null = null
  private disposables: { dispose: () => void }[] = []

  constructor(win: BrowserWindow, shellPath: string, cwd: string, cols: number, rows: number) {
    this.id = randomUUID()
    this.win = win
    this.shellPath = shellPath
    this.proc = spawnPty(shellPath, cwd, cols, rows)

    // pty 输出 -> 合帧后推给渲染进程（高频 cat/日志输出时按 ~16ms 合批，减少 IPC 洪水）
    this.disposables.push(this.proc.onData((data) => {
      this.buf += data
      if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 16)
    }))

    this.disposables.push(this.proc.onExit(({ exitCode, signal }) => {
      this.exited = true
      this.flush()
      if (canSend(win)) {
        win.webContents.send(`pty:exit:${this.id}`, { exitCode, signal })
      }
      sessions.delete(this.id)
    }))
  }

  private flush() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }
    if (this.buf && canSend(this.win)) this.win.webContents.send(`pty:data:${this.id}`, this.buf)
    this.buf = ''
  }

  write(data: string) { this.proc.write(data) }
  resize(cols: number, rows: number) {
    try { this.proc.resize(cols, rows) } catch { /* 已退出的 pty 忽略 */ }
  }
  isExited() { return this.exited }

  kill() {
    if (this.exited) return
    this.exited = true            // 先置位再 kill，防止 onExit 与调用方重入
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }
    for (const d of this.disposables) { try { d.dispose() } catch { /* noop */ } }
    this.disposables = []
    try { this.proc.kill() } catch { /* noop */ }
  }
}

const sessions = new Map<string, PtySession>()

/**
 * shell 白名单：渲染进程只允许从探测到的候选里挑，不给任意 exe 开口子。
 */
async function whereExe(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('where', [name], { timeout: 5000 })
    const first = stdout.trim().split(/\r?\n/)[0]
    return first && first.toLowerCase().endsWith('.exe') ? first : null
  } catch {
    return null
  }
}

async function detectShellCandidates(): Promise<string[]> {
  const out: string[] = []
  if (process.platform === 'win32') {
    for (const name of ['pwsh.exe', 'powershell.exe', 'cmd.exe']) {
      const p = await whereExe(name)
      if (p) out.push(p)
    }
    return out.length ? out : [path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'cmd.exe')]
  }
  const shells = [process.env['SHELL'], '/bin/bash', '/bin/sh', '/bin/zsh'].filter((s): s is string => !!s)
  for (const s of shells) {
    try { if (fs.existsSync(s)) out.push(s) } catch { /* ignore */ }
  }
  return out.length ? out : ['/bin/sh']
}

async function resolveShell(requested?: string): Promise<{ path: string; candidates: string[] }> {
  const candidates = await getCachedCandidates()
  if (
    requested &&
    candidates.some((c) => path.normalize(c).toLowerCase() === path.normalize(requested).toLowerCase())
  ) {
    return { path: requested, candidates }
  }
  return { path: candidates[0], candidates }
}

let cachedCandidates: string[] | null = null
async function getCachedCandidates(): Promise<string[]> {
  if (!cachedCandidates) cachedCandidates = await detectShellCandidates()
  return cachedCandidates
}

function defaultCwd(): string {
  return homedir()
}

/** 校验目录（不只是「存在」：路径可能是个文件，或者是空串） */
function isDirectory(p: string): boolean {
  if (!p) return false
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

export function killAllSessions() {
  for (const s of [...sessions.values()]) {
    if (!s.isExited()) s.kill()
  }
  sessions.clear()
}

export function registerPtyIpc() {
  // 新建会话：返回 sessionId（shell 必须命中白名单）
  ipcMain.handle('pty:spawn', async (e, opts: { cols?: number; rows?: number; cwd?: string; shell?: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('窗口已销毁，无法创建终端会话')
    const { path: shellPath, candidates } = await resolveShell(opts?.shell)
    const requestedCwd = opts?.cwd ?? ''
    // 工作区路径可能已被删除、写成文件、或带引号，一律回退主目录
    const cwd = isDirectory(requestedCwd) ? requestedCwd : defaultCwd()
    console.log(`[pty:spawn] shell=${shellPath} requestedCwd='${requestedCwd}' -> cwd='${cwd}'`)

    let s: PtySession
    try {
      s = new PtySession(win, shellPath, cwd, opts?.cols ?? 80, opts?.rows ?? 24)
    } catch (err) {
      // 兜底：cwd / shell 任一不可用时，用主目录再试一次，实在不行才把错误抛给渲染进程
      if (cwd === defaultCwd()) throw err
      console.error(`[pty:spawn] 首次启动失败，回退主目录重试：`, err)
      s = new PtySession(win, shellPath, defaultCwd(), opts?.cols ?? 80, opts?.rows ?? 24)
    }
    sessions.set(s.id, s)
    return { id: s.id, shellPath, candidates }
  })

  ipcMain.on('pty:write', (e, id: string, data: string) => sessions.get(id)?.write(data))
  ipcMain.on('pty:resize', (e, id: string, cols: number, rows: number) => sessions.get(id)?.resize(cols, rows))
  ipcMain.on('pty:kill', (e, id: string) => {
    sessions.get(id)?.kill()
    sessions.delete(id)
  })

  // 渲染进程热重载后重建会话列表用
  ipcMain.handle('pty:list', () =>
    [...sessions.values()].map((s) => ({ id: s.id, shellPath: s.shellPath }))
  )
  ipcMain.handle('shell:detect', () => getCachedCandidates())
}
