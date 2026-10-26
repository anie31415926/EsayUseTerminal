import type { ImageAttachment } from '../shared/images'

/** Draft attachment ownership, clipboard loading and previews; no terminal knowledge. */
export class ImageAttachments {
  readonly element = document.createElement('div')
  private attachments: ImageAttachment[] = []
  private pending = new Set<Promise<void>>()
  private tail: Promise<void> = Promise.resolve()
  private pasteError: Error | null = null
  private disposed = false
  private disabled = false
  private preview: HTMLDialogElement | null = null

  constructor(private onError: (message: string) => void, private onChange: () => void) {
    this.element.className = 'input-images'
    this.element.hidden = true
  }

  get items(): readonly ImageAttachment[] { return this.attachments }
  get loading() { return this.pending.size > 0 }

  private async queue(load: () => Promise<void>) {
    this.pasteError = null
    const operation = this.tail.then(load).catch((error: unknown) => {
      this.pasteError = error instanceof Error ? error : new Error(String(error))
      if (!this.disposed) this.onError(this.pasteError.message)
    }).finally(() => this.pending.delete(operation))
    this.pending.add(operation)
    this.tail = operation
    await operation
  }

  async ready() {
    await Promise.all([...this.pending])
    const error = this.pasteError
    this.pasteError = null
    if (error) throw error
  }

  add(image: ImageAttachment) {
    if (this.disposed) { void window.spark.images.release([image.id]).catch(() => {}); return }
    this.attachments.push(image)
    this.render()
  }

  async pasteClipboard(): Promise<boolean> {
    let found = false
    // Observe failures immediately, even while an earlier paste is still loading.
    const request = window.spark.images.paste().then((image) => ({ image }), (error: unknown) => ({ error }))
    await this.queue(async () => {
      const result = await request
      if ('error' in result) throw result.error
      const { image } = result
      if (image) { found = true; this.add(image) }
    })
    return found
  }

  handlePaste(event: ClipboardEvent) {
    const data = event.clipboardData
    if (!data) return
    const files = [...data.files].filter((file) => file.type.startsWith('image/'))
    if (!files.length && data.types.length > 0 && ![...data.types].some((type) => type.startsWith('image/'))) return
    event.preventDefault()
    if (this.disabled) return
    if (files.length) {
      void this.queue(async () => {
        for (const file of files) this.add(await window.spark.images.add(new Uint8Array(await file.arrayBuffer())))
      })
    } else void this.pasteClipboard()
  }

  private render() {
    this.onChange()
    this.element.hidden = this.attachments.length === 0
    this.element.replaceChildren()
    this.attachments.forEach((image, index) => {
      const item = document.createElement('div')
      item.className = 'input-image'
      const open = document.createElement('button')
      open.type = 'button'
      open.className = 'input-image-open'
      open.title = `查看截图 ${index + 1} (${image.width} × ${image.height})`
      const thumbnail = document.createElement('img')
      thumbnail.src = image.preview
      thumbnail.alt = `截图 ${index + 1}`
      open.append(thumbnail)
      open.addEventListener('click', () => { void this.showPreview(image) })
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'input-image-remove'
      remove.textContent = '\u00d7'
      remove.title = `移除截图 ${index + 1}`
      remove.setAttribute('aria-label', remove.title)
      remove.disabled = this.disabled
      remove.addEventListener('click', () => {
        this.attachments = this.attachments.filter((entry) => entry.id !== image.id)
        void window.spark.images.release([image.id]).catch(() => {})
        this.render()
      })
      item.append(open, remove)
      this.element.append(item)
    })
  }

  private async showPreview(image: ImageAttachment) {
    try {
      const source = await window.spark.images.preview(image.id)
      if (this.disposed) return
      this.preview?.remove()
      const dialog = document.createElement('dialog')
      dialog.className = 'image-preview'
      dialog.setAttribute('aria-label', '截图预览')
      const img = document.createElement('img')
      img.src = source
      img.alt = '截图原图'
      const close = document.createElement('button')
      close.textContent = '\u00d7'
      close.title = '关闭预览'
      close.setAttribute('aria-label', close.title)
      close.addEventListener('click', () => dialog.close())
      dialog.append(close, img)
      dialog.addEventListener('close', () => { dialog.remove(); if (this.preview === dialog) this.preview = null })
      document.body.append(dialog)
      this.preview = dialog
      dialog.showModal()
    } catch (error) { if (!this.disposed) this.onError(error instanceof Error ? error.message : String(error)) }
  }

  setDisabled(disabled: boolean) {
    this.disabled = disabled
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('.input-image-remove')) button.disabled = disabled
  }

  clear() { this.attachments = []; this.render() }

  dispose() {
    this.disposed = true
    this.preview?.remove()
    void window.spark.images?.release(this.attachments.map((image) => image.id)).catch(() => {})
    this.attachments = []
    this.element.remove()
  }
}
