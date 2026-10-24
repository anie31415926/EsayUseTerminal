import type { TerminalSession } from '../terminal/TerminalSession'
import { bus } from '../core/EventBus'

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
  private scrollDisposable: { dispose: () => void } | null = null
  private wheelEl: HTMLElement | null = null
  private wheelHandler: (() => void) | null = null

  constructor(host: HTMLElement) {
    this.track = document.createElement('div')
    this.track.className = 'scrollbar-track'
    this.thumb = document.createElement('div')
    this.thumb.className = 'scrollbar-thumb'
    this.track.appendChild(this.thumb)
    host.appendChild(this.track)

    // 拖动滑块
    this.thumb.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.startDrag(e.clientY)
    })
    // 点轨道：跳到对应位置
    this.track.addEventListener('mousedown', (e) => {
      if (e.target === this.thumb) return
      e.preventDefault()
      this.jumpToTrackY(e.clientY)
      this.startDrag(e.clientY) // 接着进入拖动
    })

    // 鼠标停在滚动条上时，滚轮直接滚动终端
    this.track.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return // Ctrl+滚轮 归缩放，别同时滚内容
      e.preventDefault()
      if (!this.current) return
      // deltaY>0 向下滚（看更老的内容），deltaY<0 向上
      const lines = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 30))
      this.current.term.scrollLines(lines)
    }, { passive: false })

    bus.on('term:resize', () => this.update())
    // 窗口尺寸变化后滑块比例要重算
    window.addEventListener('resize', () => this.update())
  }

  /** 当前绑定的 pty 会话 id（main 用它判断会话是否已经关闭） */
  get sessionId(): string {
    return this.current?.ptyId ?? ''
  }

  bind(session: TerminalSession) {
    this.unbind()
    this.current = session
    this.scrollDisposable = session.term.onScroll(() => {
      if (this.current === session) this.update()
    })
    // 兜底：滚轮事件后下一帧再同步一次（WebGL 渲染下 onScroll 时机可能滞后）
    // 必须记住引用，否则每次切标签都会往同一个 element 上叠一层监听
    const el = session.term.element
    if (el) {
      this.wheelHandler = () => requestAnimationFrame(() => this.update())
      this.wheelEl = el
      el.addEventListener('wheel', this.wheelHandler, { passive: true })
    }
    this.update()
  }

  unbind() {
    this.scrollDisposable?.dispose()
    this.scrollDisposable = null
    if (this.wheelEl && this.wheelHandler) {
      this.wheelEl.removeEventListener('wheel', this.wheelHandler)
    }
    this.wheelEl = null
    this.wheelHandler = null
    this.current = null
    this.thumb.style.height = '0px'
    this.thumb.style.transform = 'translateY(0)'
  }

  update() {
    if (!this.current) return
    const buf = this.current.term.buffer.active
    const rows = this.current.term.rows
    const total = buf?.length ?? 0
    if (!buf || total <= 0 || rows <= 0) return
    const maxLine = Math.max(0, total - rows)
    const viewY = buf.viewportY
    const trackH = this.track.clientHeight
    if (trackH === 0) return

    const thumbH = Math.max(24, Math.round((rows / total) * trackH))
    const maxTop = Math.max(0, trackH - thumbH)
    const top = maxLine === 0 ? 0 : Math.round((viewY / maxLine) * maxTop)
    this.thumb.style.height = `${thumbH}px`
    this.thumb.style.transform = `translateY(${top}px)`
    // 轨道常显，不再根据内容多少隐藏
  }

  private startDrag(startClientY: number) {
    if (!this.current) return
    const buf = this.current.term.buffer.active
    const startLine = buf.viewportY
    const maxLine = Math.max(1, buf.length - this.current.term.rows)
    const trackH = this.track.clientHeight
    const thumbH = this.thumb.clientHeight
    const range = Math.max(1, trackH - thumbH)

    const onMove = (ev: MouseEvent) => {
      if (!this.current) return
      const dy = ev.clientY - startClientY
      const lineDelta = (dy / range) * maxLine
      this.current.term.scrollToLine(Math.round(startLine + lineDelta))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  private jumpToTrackY(clientY: number) {
    if (!this.current) return
    const rect = this.track.getBoundingClientRect()
    const buf = this.current.term.buffer.active
    const maxLine = Math.max(1, buf.length - this.current.term.rows)
    const span = Math.max(1, rect.height - this.thumb.clientHeight)
    const ratio = (clientY - rect.top - this.thumb.clientHeight / 2) / span
    this.current.term.scrollToLine(Math.round(Math.min(1, Math.max(0, ratio)) * maxLine))
  }
}
