import { app, clipboard, ipcMain, nativeImage, type NativeImage, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { unlinkSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ImageAttachment } from '../src/shared/images'

interface StoredImage { ownerId: number; path: string; retained: boolean }

/** Normalizes Windows PNG/DIB clipboard images and owns only the files it creates. */
export class ClipboardImages {
  private root: string
  private files = new Map<string, StoredImage>()
  private owners = new Set<number>()
  private closedOwners = new Set<number>()
  private pendingWrites = 0

  constructor(root = join(app.getPath('temp'), `spark-terminal-images-${randomUUID()}`)) {
    this.root = root
  }

  private track(sender: WebContents) {
    if (sender.isDestroyed() || this.closedOwners.has(sender.id)) throw new Error('窗口已关闭')
    if (this.owners.has(sender.id)) return
    const ownerId = sender.id
    this.owners.add(ownerId)
    sender.once('destroyed', () => {
      this.closedOwners.add(ownerId)
      for (const [id, file] of this.files) {
        if (file.ownerId === ownerId) this.remove(id)
      }
      this.owners.delete(ownerId)
      this.removeEmptyRoot()
    })
  }

  private removeEmptyRoot() {
    if (this.files.size || this.pendingWrites) return
    try { rmdirSync(this.root) } catch { /* Pending writes can still own the directory. */ }
  }

  private remove(id: string) {
    const file = this.files.get(id)
    if (!file) return
    try { unlinkSync(file.path) } catch { /* The OS may already have removed a temporary file. */ }
    this.files.delete(id)
  }

  private async store(sender: WebContents, image: NativeImage): Promise<ImageAttachment> {
    this.track(sender)
    const ownerId = sender.id
    if (image.isEmpty()) throw new Error('剪贴板中的图片无法读取')
    const { width, height } = image.getSize()
    const id = randomUUID()
    const path = join(this.root, `${id}.png`)
    const png = image.toPNG()
    if (png.length > 32 * 1024 * 1024) throw new Error('截图过大，请缩小后重试')
    this.pendingWrites++
    try {
      await mkdir(this.root, { recursive: true })
      await writeFile(path, png)
      this.files.set(id, { ownerId, path, retained: false })
    } catch (error) {
      try { unlinkSync(path) } catch { /* A failed write may not have created a file. */ }
      throw error
    } finally {
      this.pendingWrites--
      this.removeEmptyRoot()
    }
    if (sender.isDestroyed() || this.closedOwners.has(ownerId)) {
      this.remove(id)
      this.removeEmptyRoot()
      throw new Error('窗口已关闭')
    }
    const scale = Math.min(1, 160 / width, 96 / height)
    const preview = image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }).toDataURL()
    return { id, path, preview, width, height }
  }

  async paste(sender: WebContents): Promise<ImageAttachment | null> {
    this.track(sender)
    const image = clipboard.readImage()
    return image.isEmpty() ? null : this.store(sender, image)
  }

  async add(sender: WebContents, bytes: Uint8Array): Promise<ImageAttachment> {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 32 * 1024 * 1024) throw new Error('图片数据无效或过大')
    return this.store(sender, nativeImage.createFromBuffer(Buffer.from(bytes)))
  }

  async preview(ownerId: number, id: string): Promise<string> {
    const file = this.files.get(id)
    if (!file || file.ownerId !== ownerId) throw new Error('截图已移除')
    return `data:image/png;base64,${(await readFile(file.path)).toString('base64')}`
  }

  retain(ownerId: number, ids: string[]) {
    for (const id of ids) {
      if (this.files.get(id)?.ownerId !== ownerId) throw new Error('截图已移除，请重新粘贴')
    }
    for (const id of ids) this.files.get(id)!.retained = true
  }

  release(ownerId: number, ids: string[]) {
    for (const id of ids) {
      const file = this.files.get(id)
      if (file?.ownerId === ownerId && !file.retained) this.remove(id)
    }
    this.removeEmptyRoot()
  }
}

export function registerClipboardImageIpc() {
  const images = new ClipboardImages()
  ipcMain.handle('images:paste', (event) => images.paste(event.sender))
  ipcMain.handle('images:add', (event, bytes: Uint8Array) => images.add(event.sender, bytes))
  ipcMain.handle('images:preview', (event, id: string) => images.preview(event.sender.id, id))
  ipcMain.handle('images:retain', (event, ids: string[]) => images.retain(event.sender.id, ids))
  ipcMain.handle('images:release', (event, ids: string[]) => images.release(event.sender.id, ids))
}
