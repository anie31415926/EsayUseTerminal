import type { IMarker, Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'

/** Fits one visible session and preserves the history being read across reflow. */
export class TerminalLayout {
  private observer: ResizeObserver
  private frame: number | null = null
  private anchor: IMarker | null = null
  private followOutput = false
  private disposed = false

  constructor(private host: HTMLElement, private term: Terminal, private fit: FitAddon) {
    this.observer = new ResizeObserver(() => this.schedule())
    this.observer.observe(host)
    document.fonts.addEventListener('loadingdone', this.onFontsLoaded)
  }

  private onFontsLoaded = () => this.schedule()

  private isVisible() {
    return this.host.isConnected && this.host.clientWidth > 0 && this.host.clientHeight > 0
  }

  schedule() {
    if (this.disposed || this.frame !== null || !this.term.element || !this.isVisible()) return
    const buffer = this.term.buffer.active
    this.followOutput = buffer.type === 'normal' && buffer.viewportY === buffer.baseY
    if (buffer.type === 'normal' && !this.followOutput) {
      this.anchor = this.term.registerMarker(buffer.viewportY - buffer.baseY - buffer.cursorY) ?? null
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      try {
        if (!this.isVisible()) return
        this.fit.fit()
        if (this.term.buffer.active === buffer && buffer.type === 'normal') {
          if (this.followOutput) this.term.scrollToBottom()
          else if (this.anchor && !this.anchor.isDisposed) this.term.scrollToLine(this.anchor.line)
        }
        this.term.refresh(0, this.term.rows - 1)
      } finally {
        this.anchor?.dispose()
        this.anchor = null
      }
    })
  }

  setFontSize(size: number) {
    // Capture the viewport before xterm changes font metrics and reflows its buffer.
    this.schedule()
    this.term.options.fontSize = size
  }

  dispose() {
    this.disposed = true
    this.observer.disconnect()
    document.fonts.removeEventListener('loadingdone', this.onFontsLoaded)
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.anchor?.dispose()
    this.anchor = null
  }
}
