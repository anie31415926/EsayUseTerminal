import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { themeManager } from '../core/ThemeManager'
import { bus } from '../core/EventBus'
import { shortcuts } from '../shortcuts'
import { SessionInput } from './SessionInput'

export interface SessionOptions {
  shellPath?: string
}

const FONT_KEY = 'spark.fontSize'
const ZOOM_KEY = 'spark.zoom'
export const FONT_MIN = 8
export const FONT_MAX = 32

function loadNum(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key)
    const v = raw == null ? NaN : Number(raw)
    if (!Number.isFinite(v)) return fallback
    return Math.min(max, Math.max(min, v))
  } catch {
    return fallback
  }
}

/**
 * TerminalSession —— 一个终端标签对应的完整会话。
 * 内部组合 xterm 渲染器 + node-pty 连接，对外只暴露 show/hide/dispose/setZoom。
 * 支持 adopt()：渲染进程热重载后，重新绑定主管里仍活着的 pty 会话。
 */
export class TerminalSession {
  readonly term: Terminal
  readonly fit: FitAddon
  readonly search: SearchAddon
  readonly host: HTMLDivElement
  shellPath: string

  ptyId = ''
  private unsubscribeData: (() => void) | null = null
  private unsubscribeExit: (() => void) | null = null
  private offTheme: (() => void) | null = null
  private baseFontSize: number
  private zoomFactor: number
  private exited = false
  private webgl: WebglAddon | null = null
  private input: SessionInput

  constructor(opts: SessionOptions = {}) {
    this.baseFontSize = loadNum(FONT_KEY, 13, FONT_MIN, FONT_MAX)
    this.zoomFactor = loadNum(ZOOM_KEY, 1, 0.5, 2.5)

    this.term = new Terminal({
      fontFamily: 'Cascadia Code, JetBrains Mono, Consolas, "Courier New", monospace',
      fontSize: Math.round(this.baseFontSize * this.zoomFactor),
      fontWeight: 400,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 50000,
      theme: themeManager.xtermTheme(),
      allowProposedApi: true,
      macOptionIsMeta: false
    })

    this.fit = new FitAddon()
    this.search = new SearchAddon()
    this.term.loadAddon(this.fit)
    this.term.loadAddon(new WebLinksAddon())
    this.term.loadAddon(this.search)

    // GPU 加速渲染；丢失上下文时自动回退到 DOM 渲染
    try {
      this.webgl = new WebglAddon()
      this.webgl.onContextLoss(() => this.disposeWebgl())
      this.term.loadAddon(this.webgl)
    } catch { this.webgl = null /* 无 WebGL 环境继续用 canvas */ }

    this.host = document.createElement('div')
    this.host.className = 'session-host'
    this.host.style.display = 'none'
    this.input = new SessionInput(this.term, (data) => this.writeInput(data), () => !!this.ptyId && !this.exited)

    // 用户在终端里的输入 -> 写到 pty
    this.term.onData((data) => {
      if (this.ptyId) window.spark.write(this.ptyId, data)
    })

    // 终端尺寸变化 -> 同步给 pty（必须，否则输出换行错乱）
    this.term.onResize(({ cols, rows }) => {
      if (this.ptyId) window.spark.resize(this.ptyId, cols, rows)
      bus.emit('term:resize', { id: this.ptyId, cols, rows })
    })

    // 终端标题（Windows 下 cmd/PowerShell 会通过 OSC 0/2 改窗口标题）
    this.term.onTitleChange((title) => {
      bus.emit('session:title-changed', { id: this.ptyId, title })
    })

    // 主题切换生效到已打开的实例
    this.offTheme = bus.on('theme:changed', () => {
      this.term.options.theme = themeManager.xtermTheme()
    })

    this.term.attachCustomKeyEventHandler((event) => !shortcuts.handle(event))

    this.shellPath = opts.shellPath ?? ''
  }

  /** 读剪贴板并粘贴：无权限/被拒时安静失败，不抛未处理 Promise */
  async pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      if (text) this.term.paste(text)
    } catch { /* 剪贴板不可用（无焦点 / 权限拒绝）时忽略 */ }
  }

  private async copyToClipboard(text: string) {
    try { await navigator.clipboard.writeText(text) } catch { /* 忽略 */ }
  }

  copySelection() {
    const selection = this.term.getSelection()
    if (selection) void this.copyToClipboard(selection)
  }

  copyOrInterrupt() {
    if (this.term.hasSelection()) this.copySelection()
    else this.writeInput('\x03')
  }

  private writeInput(data: string) {
    if (this.ptyId && !this.exited) window.spark.write(this.ptyId, data)
  }

  undoInput() { if (this.input.hasFocus()) this.input.undo(); else this.writeInput('\x1a') }
  redoInput() { if (this.input.hasFocus()) this.input.redo(); else this.writeInput('\x19') }
  hasInputFocus() { return this.hasFocus() || this.input.hasFocus() }
  enableInputEditor() { this.input.enable(this.host.style.display !== 'none') }
  toggleInputEditor() { this.input.toggle() }

  async start(cwd?: string) {
    const { id, shellPath } = await window.spark.spawn({
      cols: this.term.cols || 80, rows: this.term.rows || 24,
      cwd, shell: this.shellPath || undefined
    })
    this.ptyId = id
    // 采纳主进程实际选中的 shell：传空时会回退到候选列表第一个，
    // 不写回来会导致状态栏显示 "shell"、后续新标签也一直传空
    if (shellPath) this.shellPath = shellPath
    this.bindPty(id)
    this.openTerminal()
  }

  /** 渲染进程热重载后：接管主管里仍存在的 pty 会话，不重新 spawn */
  async adopt(ptyId: string, shellPath: string) {
    this.ptyId = ptyId
    this.shellPath = shellPath
    this.bindPty(ptyId)
    this.openTerminal()
    // 让 pty 立刻按当前视口回吐一屏内容（PowerShell/cmd 不会主动重绘）
    window.spark.resize(ptyId, this.term.cols, this.term.rows)
  }

  private bindPty(id: string) {
    this.unsubscribeData?.()
    this.unsubscribeExit?.()
    this.unsubscribeData = window.spark.onData(id, (data) => {
      if (!this.exited) this.term.write(data)
    })
    this.unsubscribeExit = window.spark.onExit(id, () => {
      this.exited = true
      this.input.dispose()
      this.term.write('\r\n\x1b[90m[进程已退出，标签可关闭]\x1b[0m\r\n')
      bus.emit('session:exited', { id })
    })
  }

  private openTerminal() {
    if (!this.term.element) this.term.open(this.host)
    this.fit.fit()
  }

  show() { this.host.style.display = 'block'; this.input.show(true); requestAnimationFrame(() => this.fit.fit()) }
  hide() { this.host.style.display = 'none'; this.input.show(false) }

  focus() { if (!this.input.focus()) this.term.focus() }
  hasFocus() { return document.activeElement === this.term.textarea }

  isExited() { return this.exited }

  /** 运行时改字号（独立于缩放），写入持久化 */
  setFontSize(size: number) {
    this.baseFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(size)))
    try { localStorage.setItem(FONT_KEY, String(this.baseFontSize)) } catch { /* 无痕模式忽略 */ }
    this.term.options.fontSize = Math.round(this.baseFontSize * this.zoomFactor)
    this.fit.fit()
  }
  getFontSize() { return this.baseFontSize }

  /** 滚轮/快捷键缩放：factor 1 = 100%，步进 0.1 */
  setZoom(factor: number) {
    this.zoomFactor = Math.min(2.5, Math.max(0.5, factor))
    try { localStorage.setItem(ZOOM_KEY, String(this.zoomFactor)) } catch { /* 忽略 */ }
    this.term.options.fontSize = Math.round(this.baseFontSize * this.zoomFactor)
    this.fit.fit()
    bus.emit('zoom:changed', { factor: this.zoomFactor })
  }
  getZoom() { return this.zoomFactor }

  dispose() {
    this.unsubscribeData?.()
    this.unsubscribeExit?.()
    this.offTheme?.()
    this.input.dispose()
    // 已经退出的会话不能再 kill：ConPTY 会对已消失的控制台 fork 枚举进程的 agent，
    // 子进程里 AttachConsole 失败会往日志里扔一坨栈（功能无影响，纯噪音）
    if (this.ptyId && !this.exited) window.spark.kill(this.ptyId)
    // 顺序要紧：先把 WebGL addon 摘掉，再 dispose 终端。
    // 反过来的话，term.dispose() 拆掉 core 之后 addon 的 dispose 回调还要读
    // _terminal._core._store._isDisposed，直接抛 TypeError，把整个关闭流程打断
    // （表现就是：终端被 kill 了，但标签还在，得再点一次才消失）。
    this.disposeWebgl()
    try {
      this.term.dispose()
    } catch (err) {
      console.error('[session] term.dispose 失败：', err)
    }
    this.host.remove()
  }

  /** WebGL addon 的 dispose 幂等化：上下文丢失与主动关闭可能都会走到这里 */
  private disposeWebgl() {
    const addon = this.webgl
    this.webgl = null
    if (!addon) return
    try { addon.dispose() } catch { /* 终端已拆除时忽略 */ }
  }
}
