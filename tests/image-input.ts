import type { ImageAttachment } from '../src/shared/images'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP438DwHwAGgAJ/MhsQdQAAAABJRU5ErkJggg=='
const preview = `data:image/png;base64,${png}`
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const settle = async () => { for (let i = 0; i < 4; i++) await frame() }
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message) }
type Test = (name: string, run: () => void | Promise<void>) => Promise<void>

export async function runImageInputTests(test: Test, dataHandlers: Map<string, (data: string) => void>, writes: { id: string; text: string }[]) {
  const previous = window.spark.images
  let nextImage = 0
  const released: string[] = []
  const retained: string[] = []
  const makeImage = (): ImageAttachment => ({ id: `image-${++nextImage}`, path: `C:\\截图缓存 with spaces\\${nextImage}.png`, preview, width: 1280, height: 720 })
  let deferred: ((image: ImageAttachment) => void) | null = null
  let delayLoad = false
  window.spark.images = {
    paste: async () => makeImage(),
    add: async () => delayLoad ? new Promise((resolve) => { deferred = resolve }) : makeImage(),
    preview: async () => preview,
    release: async (ids) => { released.push(...ids) },
    retain: async (ids) => { retained.push(...ids) }
  }
  document.getElementById('btn-new-tab')!.click()
  await settle()
  const id = document.querySelector<HTMLElement>('.tab.active')!.dataset.id!
  const host = document.getElementById('terminal-host')!
  const terminal = host.querySelector<HTMLTextAreaElement>('.session-host:not([style*="display: none"]) textarea')!
  const draft = () => document.querySelector<HTMLTextAreaElement>('.input-editor:not([hidden]) textarea')!
  const key = (target: HTMLElement, code: string, options: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...options }))
  const paste = () => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], 'screenshot.png', { type: 'image/png' }))
    transfer.setData('text/plain', 'clipboard text that should not replace the screenshot')
    const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
    draft().dispatchEvent(event)
    return event
  }
  try {
    await test('terminal Ctrl+V opens a screenshot draft without sending image paths to the PTY', async () => {
      const start = writes.length
      terminal.focus()
      key(terminal, 'KeyV', { ctrlKey: true })
      await settle()
      assert(!!draft() && document.activeElement === draft(), 'screenshot did not open and focus the local composer')
      assert(document.querySelectorAll('.input-image').length === 1 && writes.length === start, 'pasting a screenshot wrote to the PTY')
    })
    await test('clipboard image files become attachments while mixed clipboard text leaves the caption untouched', async () => {
      draft().value = '查看报错'
      const event = paste()
      await settle()
      assert(event.defaultPrevented, 'image paste used the textarea text path')
      assert(document.querySelectorAll('.input-image').length === 2 && draft().value === '查看报错', 'mixed clipboard text corrupted the caption or lost an image')
    })
    await test('screenshot previews open and removing an attachment releases only that image', async () => {
      document.querySelector<HTMLButtonElement>('.input-image-open')!.click()
      await settle()
      const dialog = document.querySelector<HTMLDialogElement>('.image-preview')!
      assert(dialog.open && !!dialog.querySelector('img')!.src, 'full screenshot preview did not open')
      dialog.close()
      document.querySelector<HTMLButtonElement>('.input-image-remove')!.click()
      await settle()
      assert(released.includes('image-1') && document.querySelectorAll('.input-image').length === 1, 'removing a screenshot lost the wrong attachment')
    })
    await test('Codex receives native image path paste, caption and exactly one separate Enter', async () => {
      dataHandlers.get(id)!('\x1b[?2004h\x1b]7501;state=idle:app=codex\x1b\\')
      await settle()
      const start = writes.length
      key(draft(), 'Enter')
      key(draft(), 'Enter')
      await pause(600)
      const sent = writes.slice(start).map((item) => item.text)
      assert(sent.length === 3 && sent[0].startsWith('\x1b[200~"C:') && sent[0].endsWith('2.png"\x1b[201~'), 'image was not pasted as one quoted path')
      assert(sent[1] === '\x1b[200~查看报错\x1b[201~' && sent[2] === '\r', 'caption and submission were combined or sent twice')
      assert(retained.includes('image-2') && !draft().value && !document.querySelector('.input-image'), 'successful send lost its cached file or retained the draft')
    })
    await test('an image-only draft is submitted and retained for Codex to read', async () => {
      paste()
      await settle()
      const start = writes.length
      key(draft(), 'Enter')
      await pause(600)
      assert(writes.length === start + 2 && writes.at(-1)!.text === '\r', 'image-only message was ignored or added empty text')
      assert(retained.includes('image-3') && !released.includes('image-3'), 'sent image was deleted before Codex could read it')
    })
    await test('screenshots are never executed as shell commands and failed sends preserve the whole draft', async () => {
      dataHandlers.get(id)!('\x1b[?2004l')
      await settle()
      paste()
      await settle()
      draft().value = '保留说明'
      const start = writes.length
      key(draft(), 'Enter')
      await settle()
      assert(writes.length === start && draft().value === '保留说明' && !!document.querySelector('.input-image'), 'unsupported shell received an image path or lost the draft')
      assert(document.querySelector('.input-editor-error')!.textContent!.includes('Codex'), 'unsupported target had no useful feedback')
      document.querySelector<HTMLButtonElement>('.input-image-remove')!.click()
      draft().value = ''
      dataHandlers.get(id)!('\x1b[?2004h\x1b]7501;state=idle:app=codex\x1b\\')
      await settle()
    })
    await test('Enter waits for a pending screenshot import before submitting an image-only draft', async () => {
      delayLoad = true
      paste()
      const start = writes.length
      key(draft(), 'Enter')
      await settle()
      assert(writes.length === start && draft().readOnly, 'pending screenshot was skipped or sent early')
      const image = makeImage()
      deferred!(image)
      await pause(600)
      assert(writes.length === start + 2 && retained.includes(image.id), 'pending screenshot was not included in the submitted message')
    })
    await test('closing a session during screenshot import releases the late attachment without sending input', async () => {
      paste()
      await settle()
      const start = writes.length
      key(draft(), 'KeyW', { ctrlKey: true, shiftKey: true })
      const image = makeImage()
      deferred!(image)
      await settle()
      assert(released.includes(image.id) && writes.length === start && !document.querySelector('.input-image'), 'closed composer leaked a screenshot or sent deferred input')
    })
  } finally {
    window.spark.images = previous
  }
}
