/**
 * 极简类型安全的事件总线。
 * UI 组件与终端核心通过它通信，避免互相直接引用——这是可扩展性的关键解耦点。
 */
type Handler<T> = (payload: T) => void

export class EventBus<Events extends object> {
  private map = new Map<keyof Events, Set<Handler<never>>>()

  on<K extends keyof Events>(event: K, fn: Handler<Events[K]>): () => void {
    if (!this.map.has(event)) this.map.set(event, new Set())
    const set = this.map.get(event)! as Set<Handler<never>>
    set.add(fn as Handler<never>)
    return () => this.off(event, fn)
  }

  off<K extends keyof Events>(event: K, fn: Handler<Events[K]>) {
    this.map.get(event)?.delete(fn as Handler<never>)
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]) {
    this.map.get(event)?.forEach((fn) => (fn as Handler<Events[K]>)(payload))
  }
}

/** 全局事件表。新增可扩展点时只在这里登记类型。 */
export interface AppEvents {
  'session:created':    { id: string; title: string }
  /** 会话正在创建（pty 还没起来）：先挂一个占位标签，避免点 + 后界面无反应 */
  'session:creating':   { shellPath?: string }
  /** 会话创建失败：撤掉占位标签 */
  'session:create-failed': { reason?: string }
  'session:active':     { id: string }
  'session:closed':     { id: string }
  'session:title-changed': { id: string; title: string }
  'session:exited':     { id: string }
  'zoom:changed':       { factor: number }
  'term:resize':        { id: string; cols: number; rows: number }
  'theme:changed':      { id: string }
  'search:toggle':      { needle?: string }
  'tabs:reorder':       { ids: string[] }
  'tabs:list-request':  Record<string, never>
  /** 请求重命名标签；id 省略时作用于当前激活标签（F2 / 菜单触发） */
  'tab:rename-request': { id?: string }
}

export const bus = new EventBus<AppEvents>()
