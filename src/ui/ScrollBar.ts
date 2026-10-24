import type { TerminalSession } from '../terminal/TerminalSession'
import { bus } from '../core/EventBus'

/**
 * 自定义右侧滚动条：
 *  - 滑块高度 = 可视行 / 缓冲总行数
 *  - 拖动滑块 / 点击轨道都能滚动终端
 *  - 无内容可滚时自动隐藏
 *  - 跟随 session:active / term:resize 切换目标
 */
export class ScrollBar {
  private track: HTMLDivElement
  private thumb: HTMLDivElement
  private current: TerminalSession | null = null
  private scrollDisposable: { dispose: () => void } | null = null

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
      e.preventDefault()
      if (!this.current) return
      // deltaY>0 向下滚（看更老的内容），deltaY<0 向上
      const lines = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 30))
      this.current.term.scrollLines(lines)
    }, { passive: false })

    // 会话切换后重新绑定
    bus.on('session:active', ({ id }) => {
      // 由外部通过 bind() 注入当前 session
      void id
    })
    bus.on('term:resize', () => this.update())
  }

  bind(session: TerminalSession) {
    // 先摘掉上一个会话的 onScroll（IEvent 挂载会累积回调，不摘就一直触发）
    this.scrollDisposable?.dispose()
    this.current = session
    this.scrollDisposable = session.term.onScroll(() => {
      if (this.current === session) this.update()
    })
    // 兜底：滚轮事件后下一帧再同步一次（WebGL 渲染下 onScroll 时机可能滞后）
    session.term.element?.addEventListener('wheel', () => {
      requestAnimationFrame(() => this.update())
    }, { passive: true })
    this.update()
  }

  update() {
    if (!this.current) return
    const buf = this.current.term.buffer.active
    const total = buf.length
    const rows = this.current.term.rows
    const maxLine = Math.max(0, total - rows)
    const viewY = buf.viewportY
    const trackH = this.track.clientHeight
    if (trackH === 0) return

    const thumbH = Math.max(24, Math.round((rows / total) * trackH))
    const maxTop = trackH - thumbH
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
      const dy = ev.clientY - startClientY
      const lineDelta = (dy / range) * maxLine
      this.current!.term.scrollToLine(Math.round(startLine + lineDelta))
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
    const ratio = (clientY - rect.top - this.thumb.clientHeight / 2) / (rect.height - this.thumb.clientHeight)
    this.current.term.scrollToLine(Math.round(ratio * maxLine))
  }
}
