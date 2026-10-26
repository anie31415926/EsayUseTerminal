import { registerShortcut } from '../shortcuts'
import { shortcutLabel } from '../shortcuts/bindings'

let nextEditor = 0

/** Edits the application's real draft, without reconstructing text from terminal output. */
export class NativeDraftEditor {
  private dialog = document.createElement('dialog')
  private textarea = document.createElement('textarea')
  private error = document.createElement('div')
  private save = document.createElement('button')
  private cancel = document.createElement('button')
  private request: { id: string; text: string } | null = null
  private selectOnOpen = false
  private pending = false
  private selectionTimer: ReturnType<typeof setTimeout> | null = null
  private unregister: (() => void)[]

  constructor(private complete: (id: string, text: string | null) => Promise<void>, private restoreFocus: () => void) {
    const id = `native-draft-${++nextEditor}`
    this.dialog.className = 'native-draft-editor'
    this.dialog.setAttribute('aria-labelledby', id)
    const title = document.createElement('h2')
    title.id = id
    title.textContent = '编辑 Codex 输入'
    this.textarea.setAttribute('aria-label', 'Codex 未发送文字')
    this.textarea.spellcheck = false
    this.save.textContent = '确认'
    this.save.title = shortcutLabel('nativeEdit.apply')
    this.cancel.textContent = '取消'
    this.cancel.title = shortcutLabel('nativeEdit.cancel')
    this.save.onclick = () => { void this.finish(this.textarea.value) }
    this.cancel.onclick = () => { void this.finish(null) }
    this.error.setAttribute('role', 'status')
    this.error.className = 'input-editor-error'
    this.error.hidden = true
    const actions = document.createElement('footer')
    actions.append(this.cancel, this.save)
    this.dialog.append(title, this.textarea, this.error, actions)
    document.body.append(this.dialog)
    this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); void this.finish(null) })
    const register = (command: 'nativeEdit.apply' | 'nativeEdit.cancel' | 'input.selectAll', run: () => void) => registerShortcut(command, {
      run, when: () => this.dialog.open && (command === 'nativeEdit.cancel' ? this.dialog.contains(document.activeElement) : document.activeElement === this.textarea),
      allowInEditable: true, allowInModal: true, priority: 300
    }, id)
    this.unregister = [
      register('nativeEdit.apply', () => { void this.finish(this.textarea.value) }),
      register('nativeEdit.cancel', () => { void this.finish(null) }),
      register('input.selectAll', () => this.textarea.select())
    ]
  }

  selectNext(): boolean {
    if (this.selectionTimer || this.request) return false
    this.selectOnOpen = true
    this.selectionTimer = setTimeout(() => { this.selectOnOpen = false; this.selectionTimer = null }, 10000)
    return true
  }

  open(request: { id: string; text: string }, active: boolean) {
    if (this.selectionTimer) clearTimeout(this.selectionTimer)
    this.selectionTimer = null
    this.request = request
    this.textarea.value = request.text
    this.error.hidden = true
    this.show(active)
  }

  show(active: boolean) {
    if (!this.request || !active || this.dialog.open) return
    this.dialog.showModal()
    this.textarea.focus()
    if (this.selectOnOpen) this.textarea.select()
    else this.textarea.setSelectionRange(this.textarea.value.length, this.textarea.value.length)
    this.selectOnOpen = false
  }

  closeRequest(id: string) {
    if (this.request?.id !== id) return
    this.request = null
    this.dialog.close()
    this.restoreFocus()
  }

  private async finish(text: string | null) {
    if (!this.request || this.pending) return
    this.pending = true
    this.textarea.readOnly = true
    this.save.disabled = this.cancel.disabled = true
    try {
      const id = this.request.id
      await this.complete(id, text)
      this.closeRequest(id)
    } catch (error) {
      this.error.textContent = error instanceof Error ? error.message : String(error)
      this.error.hidden = false
    } finally {
      this.pending = false
      this.textarea.readOnly = false
      this.save.disabled = this.cancel.disabled = false
    }
  }

  dispose() {
    if (this.selectionTimer) clearTimeout(this.selectionTimer)
    this.selectionTimer = null
    if (this.request) void this.complete(this.request.id, null).catch(() => {})
    this.unregister.forEach((off) => off())
    this.request = null
    this.dialog.remove()
  }
}
