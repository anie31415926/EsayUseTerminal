import { app } from 'electron'
import { createConnection, createServer, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const maxBytes = 2 * 1024 * 1024

/** A session-local editor transport. Only text crosses IPC; the helper owns Codex's file. */
export class DraftEditorBridge {
  readonly pipe = `\\\\.\\pipe\\spark-draft-${randomUUID()}`
  private server = createServer((socket) => this.accept(socket))
  private sockets = new Set<Socket>()
  private pending = new Map<string, Socket>()
  private disposed = false

  constructor(private onOpen: (request: { id: string; text: string }) => void, private onClose: (id: string) => void) {
    this.server.on('error', (error) => console.error('[draft-editor]', error.message))
    this.server.listen(this.pipe)
  }

  private accept(socket: Socket) {
    this.sockets.add(socket)
    let buffer = ''
    let requestId = ''
    socket.setEncoding('utf8')
    socket.on('data', (data: string) => {
      if (requestId) return
      buffer += data
      if (Buffer.byteLength(buffer) > maxBytes) { socket.destroy(); return }
      if (!buffer.includes('\n')) return
      try {
        const message: unknown = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
        if (!message || typeof message !== 'object' || !('text' in message) || typeof message.text !== 'string') throw new Error('Invalid draft')
        requestId = randomUUID()
        this.pending.set(requestId, socket)
        this.onOpen({ id: requestId, text: message.text })
      } catch { socket.destroy() }
    })
    socket.on('error', () => {})
    socket.on('close', () => {
      this.sockets.delete(socket)
      if (requestId) { this.pending.delete(requestId); this.onClose(requestId) }
    })
  }

  complete(id: string, text: string | null) {
    if (text !== null && (typeof text !== 'string' || Buffer.byteLength(text) > maxBytes / 2)) throw new Error('输入内容过长')
    const socket = this.pending.get(id)
    if (!socket) throw new Error('编辑请求已结束')
    this.pending.delete(id)
    socket.end(JSON.stringify({ text }) + '\n')
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const socket of this.sockets) socket.destroy()
    this.pending.clear()
    this.server.close()
  }
}

export function draftEditorEnvironment(): Record<string, string> {
  const command = [process.execPath, ...(app.isPackaged ? [] : [app.getAppPath()]), '--spark-edit']
  return { SPARK_CODEX_EDITOR: command.map((part) => `"${part}"`).join(' ') }
}

/** Launched by Codex as VISUAL; exiting returns the edited draft to its native composer. */
export async function runDraftEditorHelper() {
  const pipe = process.env.SPARK_DRAFT_PIPE
  const file = process.argv.at(-1)
  if (!pipe?.startsWith('\\\\.\\pipe\\spark-draft-') || !file || file === '--spark-edit') throw new Error('Missing draft editor context')
  const seed = await readFile(file, 'utf8')
  if (Buffer.byteLength(seed) > maxBytes / 2) throw new Error('Draft is too large')
  const text = await new Promise<string | null>((resolve, reject) => {
    const socket = createConnection(pipe)
    let buffer = ''
    let received = false
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(JSON.stringify({ text: seed }) + '\n'))
    socket.on('data', (data: string) => {
      buffer += data
      if (Buffer.byteLength(buffer) > maxBytes) { socket.destroy(new Error('Draft is too large')); return }
      if (!buffer.includes('\n')) return
      try {
        const response = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
        if (response.text !== null && typeof response.text !== 'string') throw new Error('Invalid edited draft')
        received = true
        resolve(response.text)
        socket.end()
      } catch (error) { reject(error); socket.destroy() }
    })
    socket.on('error', reject)
    socket.on('close', () => { if (!received) reject(new Error('Draft editor closed')) })
  })
  if (text !== null) await writeFile(file, text, 'utf8')
}
