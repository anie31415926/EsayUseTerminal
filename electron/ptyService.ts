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
 * PtySession —— 主进程侧的单个终端会话封装。
 * 与渲染进程的 TerminalSession 一一对应，通过 IPC 解耦。
 */
class PtySession {
  readonly id: string
  private proc: pty.IPty
  private win: BrowserWindow
  readonly shellPath: string

  constructor(win: BrowserWindow, shellPath: string, cwd: string, cols: number, rows: number) {
    this.id = randomUUID()
    this.win = win
    this.shellPath = shellPath
    // windowsHide: 兜底老版本 ConPTY 不可用时避免弹出黑框；typings 未收录，运行时透传
    this.proc = pty.spawn(shellPath, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      windowsHide: true,
      useConpty: true
    } as pty.IPtyForkOptions)

    // pty 输出 -> 合帧后推给渲染进程（高频 cat/日志输出时按 ~16ms 合批，减少 IPC 洪水）
    let buf = ''
    let timer: NodeJS.Timeout | null = null
    const flush = () => {
      timer = null
      if (buf && !win.isDestroyed()) win.webContents.send(`pty:data:${this.id}`, buf)
      buf = ''
    }
    this.proc.onData((data) => {
      buf += data
      if (!timer) timer = setTimeout(flush, 16)
    })
    const flushNow = () => { if (timer) { clearTimeout(timer); flush() } }

    this.proc.onExit(({ exitCode, signal }) => {
      flushNow()
      if (!win.isDestroyed()) {
        win.webContents.send(`pty:exit:${this.id}`, { exitCode, signal })
      }
      sessions.delete(this.id)
    })
  }

  write(data: string) { this.proc.write(data) }
  resize(cols: number, rows: number) {
    try { this.proc.resize(cols, rows) } catch { /* 已退出的 pty 忽略 */ }
  }
  kill() { try { this.proc.kill() } catch { /* noop */ } }
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

export function killAllSessions() {
  for (const s of [...sessions.values()]) s.kill()
  sessions.clear()
}

export function registerPtyIpc() {
  // 新建会话：返回 sessionId（shell 必须命中白名单）
  ipcMain.handle('pty:spawn', async (e, opts: { cols?: number; rows?: number; cwd?: string; shell?: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    const { path: shellPath, candidates } = await resolveShell(opts?.shell)
    const requestedCwd = opts?.cwd ?? ''
    const cwd = fs.existsSync(requestedCwd) ? requestedCwd : defaultCwd()
    console.log(`[pty:spawn] shell=${shellPath} requestedCwd='${requestedCwd}' -> cwd='${cwd}'`)
    const s = new PtySession(win, shellPath, cwd, opts?.cols ?? 80, opts?.rows ?? 24)
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
