import type { Terminal } from '@xterm/xterm'
import { InputEditor } from '../ui/InputEditor'
import { TerminalInputTarget } from './TerminalInputTarget'
import type { InputDraft } from '../shared/images'

/** Adapts a local draft editor to a live terminal without exposing PTY details to the UI. */
export class SessionInput {
  private editor: InputEditor | null = null
  private enabled = false
  private active = false
  private disposed = false
  private cancelSend: (() => void) | null = null
  private target: TerminalInputTarget

  constructor(private term: Terminal, private write: (data: string) => void, private isAlive: () => boolean) {
    this.target = new TerminalInputTarget(term)
  }

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

  async pasteScreenshot(): Promise<boolean> {
    let image
    try { image = await window.spark.images?.paste() }
    catch (error) {
      if (!this.disposed && this.isAlive()) {
        this.enable(this.active)
        this.editor!.showError(error instanceof Error ? error.message : '无法读取截图，请重新复制后粘贴')
      }
      return true
    }
    if (!image) return false
    if (this.disposed || !this.isAlive()) {
      void window.spark.images.release([image.id]).catch(() => {})
      return true
    }
    this.enable(this.active)
    this.editor!.addImage(image)
    return true
  }

  private async submit({ text, images }: InputDraft): Promise<boolean> {
    if (this.disposed || !this.isAlive()) return false
    const bracketed = this.term.modes.bracketedPasteMode
    if (!bracketed && /[\r\n]/.test(text)) return false
    if (images.length && !this.target.supportsImages()) throw new Error('请先进入 Codex 再发送截图，图片和文字已保留')
    for (const image of images) {
      if (!this.target.supportsImages() || this.disposed || !this.isAlive()) return false
      // Codex's composer recognizes a single quoted image path as a native attachment.
      this.term.paste(`"${image.path}"`)
      if (!await this.waitForPaste()) return false
    }
    if (this.disposed || !this.isAlive() || this.term.modes.bracketedPasteMode !== bracketed) return false
    if (text) this.term.paste(text)
    if (!await this.waitForPaste()) return false
    if (this.disposed || !this.isAlive() || this.term.modes.bracketedPasteMode !== bracketed) return false
    if (images.length) {
      if (!this.target.supportsImages()) return false
      await window.spark.images.retain(images.map((image) => image.id))
      if (this.disposed || !this.isAlive() || !this.target.supportsImages()) return false
    }
    this.write('\r')
    return true
  }

  private waitForPaste(): Promise<boolean> {
    // Enter must be a separate input event, after the application consumes the bracketed paste.
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { this.cancelSend = null; resolve(true) }, 250)
      this.cancelSend = () => { clearTimeout(timer); this.cancelSend = null; resolve(false) }
    })
  }

  dispose() {
    this.disposed = true
    this.cancelSend?.()
    this.target.dispose()
    this.editor?.dispose()
  }
}
