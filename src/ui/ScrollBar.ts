import type { TerminalSession } from '../terminal/TerminalSession'

/**
 * 自定义右侧滚动条：
 *  - 滑块高度 = 可视行 / 缓冲总行数
 *  - 拖动滑块 / 点击轨道都能滚动终端
 *  - 跟随 session:active 切换目标，会话关闭后自动 unbind（避免操作已 dispose 的 term）
 */
export class ScrollBar {
  private track: HTMLDivElement
  private thumb: HTMLDivElement
  private current: TerminalSession | null = null
  private disposables: { dispose: () => void }[] = []
  private updateFrame: number | null = null
  private stopDrag: (() => void) | null = null

  constructor(host: HTMLElement) {
    this.track = document.createElement('div')
    this.track.className = 'scrollbar-track'
    this.thumb = document.createElement('div')
    this.thumb.className = 'scrollbar-thumb'
    this.track.appendChild(this.thumb)
    host.appendChild(this.track)
    this.thumb.hidden = true

    // 拖动滑块
    this.thumb.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      this.startDrag(e.clientY)
    })
    // 点轨道：跳到对应位置
    this.track.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target === this.thumb) return
      e.preventDefault()
      this.jumpToTrackY(e.clientY)
      this.startDrag(e.clientY) // 接着进入拖动
    })

    // 鼠标停在滚动条上时，滚轮直接滚动终端
    this.track.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return // Ctrl+滚轮 归缩放，别同时滚内容
      e.preventDefault()
      if (!this.current) return
      if (e.deltaY === 0) return
      // 正数向下（较新的内容），负数向上（历史内容）。
      const lines = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 30))
      this.current.term.scrollLines(lines)
    }, { passive: false })

    new ResizeObserver(() => this.scheduleUpdate()).observe(this.track)
  }

  /** 当前绑定的 pty 会话 id（main 用它判断会话是否已经关闭） */
  get sessionId(): string {
    return this.current?.ptyId ?? ''
  }

  bind(session: TerminalSession) {
    this.unbind()
    this.current = session
    // 内容变化不一定触发滚动；解析、缓冲区切换和尺寸变化都要同步。
    this.disposables = [
      session.term.onScroll(() => this.scheduleUpdate()),
      session.term.onWriteParsed(() => this.scheduleUpdate()),
      session.term.onRender(() => this.scheduleUpdate()),
      session.term.onResize(() => this.scheduleUpdate()),
      session.term.buffer.onBufferChange(() => this.scheduleUpdate())
    ]
    this.update()
  }

  unbind() {
    this.stopDrag?.()
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables = []
    if (this.updateFrame !== null) cancelAnimationFrame(this.updateFrame)
    this.updateFrame = null
    this.current = null
    this.thumb.hidden = true
    this.thumb.style.height = '0px'
    this.thumb.style.transform = 'translateY(0)'
  }

  private scheduleUpdate() {
    if (this.updateFrame !== null) return
    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = null
      this.update()
    })
  }

  update() {
    if (!this.current) return
    const buf = this.current.term.buffer.active
    const rows = this.current.term.rows
    if (rows <= 0) return
    const maxLine = buf.baseY
    const total = maxLine + rows
    const viewY = buf.viewportY
    const trackH = this.track.clientHeight
    if (trackH === 0) return

    const thumbH = Math.min(trackH, Math.max(24, Math.round((rows / total) * trackH)))
    const maxTop = Math.max(0, trackH - thumbH)
    const top = maxLine === 0 ? 0 : Math.round(Math.min(1, Math.max(0, viewY / maxLine)) * maxTop)
    this.thumb.hidden = false
    this.thumb.style.height = `${thumbH}px`
    this.thumb.style.transform = `translateY(${top}px)`
    // 轨道常显，不再根据内容多少隐藏
  }

  private startDrag(startClientY: number) {
    if (!this.current) return
    this.stopDrag?.()
    this.update()
    const session = this.current
    const buf = session.term.buffer.active
    const startLine = buf.viewportY
    const range = this.track.clientHeight - this.thumb.clientHeight
    if (buf.baseY <= 0 || range <= 0) return

    const onMove = (ev: MouseEvent) => {
      if (this.current !== session || session.term.buffer.active !== buf) { onUp(); return }
      const dy = ev.clientY - startClientY
      const lineDelta = (dy / range) * buf.baseY
      session.term.scrollToLine(Math.round(startLine + lineDelta))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
      document.body.style.userSelect = previousUserSelect
      this.stopDrag = null
    }
    const previousUserSelect = document.body.style.userSelect
    this.stopDrag = onUp
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
  }

  private jumpToTrackY(clientY: number) {
    if (!this.current) return
    this.update()
    const rect = this.track.getBoundingClientRect()
    const buf = this.current.term.buffer.active
    const maxLine = buf.baseY
    const span = Math.max(1, rect.height - this.thumb.clientHeight)
    const ratio = (clientY - rect.top - this.thumb.clientHeight / 2) / span
    this.current.term.scrollToLine(Math.round(Math.min(1, Math.max(0, ratio)) * maxLine))
  }
}
