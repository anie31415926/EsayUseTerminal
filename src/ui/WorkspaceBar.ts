import { registerInputShortcut } from '../shortcuts'

/** The view delegates directory validation and terminal creation to its caller. */
export class WorkspaceBar {
  private input: HTMLInputElement
  private buttons: HTMLButtonElement[]
  private error: HTMLElement
  private busy = false

  constructor(private onApply: (cwd: string) => Promise<string>, initial = '') {
    const bar = document.getElementById('workspace-bar')!
    this.input = bar.querySelector('input')!
    this.input.value = initial
    this.buttons = [...bar.querySelectorAll<HTMLButtonElement>('[data-act]')]
    this.error = document.getElementById('workspace-error')!
    this.input.addEventListener('input', () => this.clearError())
    bar.querySelector('[data-act="browse"]')!.addEventListener('click', async () => {
      try {
        const picked = await window.spark.pickFolder()
        if (picked) { this.input.value = picked; await this.apply() }
      } catch (error) { this.showError(error) }
    })
    bar.querySelector('[data-act="go"]')!.addEventListener('click', () => void this.apply())
    registerInputShortcut('workspace.save', this.input, () => void this.apply())
  }

  showError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    this.error.textContent = message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
    this.error.hidden = false
    this.input.setAttribute('aria-invalid', 'true')
  }

  private clearError() {
    this.error.hidden = true
    this.error.textContent = ''
    this.input.removeAttribute('aria-invalid')
  }

  private async apply() {
    if (this.busy) return
    this.busy = true
    this.clearError()
    this.input.disabled = true
    for (const button of this.buttons) button.disabled = true
    try { this.input.value = await this.onApply(this.input.value) }
    catch (error) { this.showError(error) }
    finally {
      this.busy = false
      this.input.disabled = false
      for (const button of this.buttons) button.disabled = false
    }
  }
}
