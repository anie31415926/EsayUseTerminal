import { registerInputShortcut } from '../shortcuts'
import { shortcutLabel } from '../shortcuts/bindings'

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

  constructor(private send: (text: string) => Promise<boolean>, onTerminal: () => void) {
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
    this.element.append(this.textarea, actions)
    this.element.append(this.error)
    this.unregister = registerInputShortcut('input.submit', this.textarea, () => { void this.submit() }, `editor-${++nextId}`)
  }

  private async submit() {
    if (this.submitting || this.disposed || !this.textarea.value.trim()) return
    this.submitting = true
    this.textarea.readOnly = true
    this.submitButton.disabled = true
    this.error.hidden = true
    try {
      if (await this.send(this.textarea.value) && !this.disposed) {
        // Assigning value starts a fresh edit history; sent drafts cannot be undone into the next prompt.
        this.textarea.value = ''
      } else if (!this.disposed) {
        this.error.textContent = '暂时无法发送，文字已保留'
        this.error.hidden = false
      }
    } catch {
      if (!this.disposed) {
        this.error.textContent = '发送失败，文字已保留'
        this.error.hidden = false
      }
    } finally {
      this.submitting = false
      this.textarea.readOnly = false
      this.submitButton.disabled = false
      if (!this.disposed && !this.element.hidden && this.element.contains(document.activeElement)) this.focus()
    }
  }

  show(visible: boolean) { this.element.hidden = !visible }
  focus() { this.textarea.focus() }
  hasFocus() { return document.activeElement === this.textarea }
  undo() { if (this.hasFocus() && !this.submitting) document.execCommand('undo') }
  redo() { if (this.hasFocus() && !this.submitting) document.execCommand('redo') }

  dispose() {
    this.disposed = true
    this.unregister()
    this.element.remove()
  }
}
