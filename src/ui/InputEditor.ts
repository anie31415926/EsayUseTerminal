import { registerInputShortcut } from '../shortcuts'
import { shortcutLabel } from '../shortcuts/bindings'
import { ImageAttachments } from './ImageAttachments'
import type { ImageAttachment, InputDraft } from '../shared/images'

let nextId = 0

/** Owns only the unsent draft. The host decides where and how submitted text is delivered. */
export class InputEditor {
  readonly element = document.createElement('div')
  readonly textarea = document.createElement('textarea')
  private submitButton = document.createElement('button')
  private unregister: () => void
  private submitting = false
  private disposed = false
  private error = document.createElement('div')
  private images: ImageAttachments

  constructor(private send: (draft: InputDraft) => Promise<boolean>, onTerminal: () => void) {
    this.images = new ImageAttachments((message) => this.showError(message), () => { this.error.hidden = true })
    this.element.className = 'input-editor'
    this.element.hidden = true
    this.textarea.className = 'input-editor-text'
    this.textarea.placeholder = '输入消息…'
    this.textarea.setAttribute('aria-label', '待发送文字')
    this.textarea.rows = 3
    this.textarea.spellcheck = false
    this.submitButton.className = 'input-editor-send'
    this.submitButton.textContent = '发送'
    this.submitButton.title = shortcutLabel('input.submit')
    this.submitButton.addEventListener('click', () => { void this.submit() })
    const terminal = document.createElement('button')
    terminal.className = 'input-editor-terminal'
    terminal.textContent = '终端输入'
    terminal.title = shortcutLabel('input.toggle')
    terminal.addEventListener('click', onTerminal)
    const actions = document.createElement('div')
    actions.className = 'input-editor-actions'
    actions.append(this.submitButton, terminal)
    this.error.className = 'input-editor-error'
    this.error.setAttribute('role', 'status')
    this.error.hidden = true
    this.element.append(this.images.element, this.textarea, actions)
    this.element.append(this.error)
    this.textarea.addEventListener('paste', (event) => this.images.handlePaste(event))
    this.textarea.addEventListener('input', () => { this.error.hidden = true })
    this.unregister = registerInputShortcut('input.submit', this.textarea, () => { void this.submit() }, `editor-${++nextId}`)
  }

  private async submit() {
    if (this.submitting || this.disposed || (!this.textarea.value.trim() && !this.images.items.length && !this.images.loading)) return
    this.submitting = true
    this.textarea.readOnly = true
    this.submitButton.disabled = true
    this.images.setDisabled(true)
    this.error.hidden = true
    try {
      await this.images.ready()
      if (this.disposed) return
      if (!this.textarea.value.trim() && !this.images.items.length) return
      if (await this.send({ text: this.textarea.value, images: [...this.images.items] }) && !this.disposed) {
        // Assigning value starts a fresh edit history; sent drafts cannot be undone into the next prompt.
        this.textarea.value = ''
        this.images.clear()
      } else if (!this.disposed) {
        this.showError('暂时无法发送，内容已保留')
      }
    } catch (error) {
      if (!this.disposed) {
        this.showError(error instanceof Error ? error.message : '发送失败，内容已保留')
      }
    } finally {
      this.submitting = false
      this.textarea.readOnly = false
      this.submitButton.disabled = false
      this.images.setDisabled(false)
      if (!this.disposed && !this.element.hidden && this.element.contains(document.activeElement)) this.focus()
    }
  }

  showError(message: string) { this.error.textContent = message; this.error.hidden = false }
  addImage(image: ImageAttachment) { this.images.add(image) }

  show(visible: boolean) { this.element.hidden = !visible }
  focus() { this.textarea.focus() }
  hasFocus() { return document.activeElement === this.textarea }
  undo() { if (this.hasFocus() && !this.submitting) document.execCommand('undo') }
  redo() { if (this.hasFocus() && !this.submitting) document.execCommand('redo') }

  dispose() {
    this.disposed = true
    this.unregister()
    this.images.dispose()
    this.element.remove()
  }
}
