import type { Terminal } from '@xterm/xterm'
import { InputEditor } from '../ui/InputEditor'

/** Adapts a local draft editor to a live terminal without exposing PTY details to the UI. */
export class SessionInput {
  private editor: InputEditor | null = null
  private enabled = false
  private active = false
  private disposed = false
  private cancelSend: (() => void) | null = null

  constructor(private term: Terminal, private write: (data: string) => void, private isAlive: () => boolean) {}

  enable(active: boolean) {
    if (this.disposed) return
    if (!this.editor) {
      this.editor = new InputEditor((text) => this.submit(text), () => this.toggle())
      document.getElementById('statusbar')!.before(this.editor.element)
    }
    this.enabled = true
    this.show(active)
    if (active) this.editor.focus()
  }

  toggle() {
    if (!this.editor || !this.enabled) this.enable(this.active)
    else {
      this.enabled = false
      this.editor.show(false)
      this.term.focus()
    }
  }

  show(active: boolean) {
    this.active = active
    this.editor?.show(active && this.enabled)
  }

  focus(): boolean {
    if (!this.enabled || !this.editor) return false
    this.editor.focus()
    return true
  }

  hasFocus() { return !!this.editor?.hasFocus() && this.enabled }
  undo() { this.editor?.undo() }
  redo() { this.editor?.redo() }

  private async submit(text: string): Promise<boolean> {
    if (this.disposed || !this.isAlive()) return false
    const bracketed = this.term.modes.bracketedPasteMode
    if (!bracketed && /[\r\n]/.test(text)) return false
    this.term.paste(text)
    // Enter must be a separate input event, after the application consumes the bracketed paste.
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { this.cancelSend = null; resolve(true) }, 250)
      this.cancelSend = () => { clearTimeout(timer); this.cancelSend = null; resolve(false) }
    })
    if (!ready || this.disposed || !this.isAlive() || this.term.modes.bracketedPasteMode !== bracketed) return false
    this.write('\r')
    return true
  }

  dispose() {
    this.disposed = true
    this.cancelSend?.()
    this.editor?.dispose()
  }
}
