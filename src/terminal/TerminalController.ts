import { TerminalSession } from './TerminalSession'
import { bus } from '../core/EventBus'

/**
 * TerminalController —— 会话与标签的总管。
 * 不直接操作 DOM（除了把 host 挂到容器），标签 UI 由 TabBar 订阅事件总线渲染。
 */
export class TerminalController {
  private sessions = new Map<string, TerminalSession>()
  private activeId = ''
  private hostEl: HTMLElement
  private counter = 0

  constructor(hostEl: HTMLElement) {
    this.hostEl = hostEl
  }

  private nextTitle(): string {
    return `终端 ${++this.counter}`
  }

  async create(shellPath?: string, cwd?: string): Promise<string> {
    const s = new TerminalSession({ shellPath })
    try {
      await s.start(cwd)
    } catch (err) {
      // 起不来就别留一个空 xterm + 幽灵标签：彻底回收后再报错
      console.error('[create] 启动会话失败：', err)
      s.dispose()
      return ''
    }
    this.hostEl.appendChild(s.host)
    const id = s.ptyId
    this.sessions.set(id, s)
    bus.emit('session:created', { id, title: this.nextTitle() })
    this.activate(id)
    return id
  }

  /** 热重载恢复：接管主管里仍活着的 pty 会话（只重建视图，不 spawn） */
  async restore(): Promise<boolean> {
    if (typeof window.spark.listSessions !== 'function') return false
    const alive = await window.spark.listSessions()
    let any = false
    for (const { id, shellPath } of alive) {
      if (this.sessions.has(id)) continue
      const s = new TerminalSession({ shellPath })
      await s.adopt(id, shellPath)
      this.hostEl.appendChild(s.host)
      this.sessions.set(id, s)
      bus.emit('session:created', { id, title: this.nextTitle() })
      any = true
      this.activeId = id // 先都取最后一个，激活放循环外
    }
    if (any && this.activeId) this.activate(this.activeId)
    // 序号接着恢复的会话往下排，否则热重载后会出现两个「终端 1」
    if (any) this.counter = Math.max(this.counter, this.sessions.size)
    return any
  }

  /** TabBar 拖拽重排后同步会话顺序（切换邻居 / Ctrl+Tab 依赖此顺序） */
  reorder(ids: string[]) {
    const next = new Map<string, TerminalSession>()
    for (const id of ids) {
      const s = this.sessions.get(id)
      if (s) next.set(id, s)
    }
    for (const [id, s] of this.sessions) {
      if (!next.has(id)) next.set(id, s)
    }
    this.sessions = next
  }

  activate(id: string) {
    for (const [sid, s] of this.sessions) {
      if (sid === id) s.show()
      else s.hide()
    }
    this.activeId = id
    const s = this.sessions.get(id)
    if (s) {
      s.focus()
      bus.emit('session:active', { id })
    }
  }

  close(id: string) {
    const s = this.sessions.get(id)
    if (!s) return
    // 关闭当前标签后激活同序号的标签：优先右侧，末尾时回退左侧
    const wasActive = this.activeId === id
    const idx = [...this.sessions.keys()].indexOf(id)
    s.dispose()
    this.sessions.delete(id)
    bus.emit('session:closed', { id })
    if (wasActive) {
      const remaining = [...this.sessions.keys()]
      const next = remaining[Math.min(idx, remaining.length - 1)]
      if (next) this.activate(next)
    }
  }

  active(): TerminalSession | undefined {
    return this.sessions.get(this.activeId)
  }

  currentId(): string {
    return this.activeId
  }

  all(): TerminalSession[] { return [...this.sessions.values()] }
  size() { return this.sessions.size }
}
