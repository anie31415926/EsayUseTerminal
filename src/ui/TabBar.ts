import { bus } from '../core/EventBus'
import { showMenu, type MenuEntry } from './ContextMenu'
import { registerInputShortcut } from '../shortcuts'
import { shortcutLabel } from '../shortcuts/bindings'
import { TabScroller } from './TabScroller'

interface Tab {
  id: string
  /** shell 通过 OSC 0/2 上报的自动标题 */
  autoTitle: string
  /** 用户重命名后的标题；一旦存在就锁定，不再被 shell 覆盖 */
  custom?: string
  dead?: boolean
}

const TITLES_KEY = 'spark.tabTitles'
const TITLE_MAX = 60

/** 自定义标题持久化：key 用 ptyId，渲染进程热重载恢复会话后标题还在 */
function loadTitles(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TITLES_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) out[id] = v
    }
    return out
  } catch {
    return {}
  }
}

const savedTitles = loadTitles()

function persistTitle(id: string, title?: string) {
  const latest = loadTitles()
  if (title) savedTitles[id] = title
  else delete savedTitles[id]
  if (title) latest[id] = title
  else delete latest[id]
  try { localStorage.setItem(TITLES_KEY, JSON.stringify(latest)) } catch { /* 无痕模式忽略 */ }
}

/**
 * TabBar —— 纯视图组件，订阅事件总线渲染标签，不持有会话状态。
 * 交互：左键选中、×关闭、鼠标中键关闭、双击标题重命名、双击空白处新建、拖拽重排、右键菜单。
 * 标题来源分两层：shell 的 OSC 标题（autoTitle）与用户重命名（custom，锁定且持久化）。
 */
export class TabBar {
  private el: HTMLElement
  private tabs: Tab[] = []
  private activeId = ''
  private emptyEl: HTMLDivElement
  private dragId: string | null = null
  private renderScheduled = false
  /** 正在内联编辑的标签 id；非空时暂停整栏重绘，否则输入框会被 innerHTML 冲掉 */
  private editingId = ''
  private renameShortcuts: (() => void)[] = []
  /** 正在启动的会话数：先显示占位标签，pty 起来后再换成真标签 */
  private pending = 0
  /** 上一次按下的标签与时刻：用于自己判定双击（原生 dblclick 会被重绘打断） */
  private lastDownId = ''
  private lastDownAt = 0
  private onClickTab: (id: string) => void
  private onCloseTab: (id: string) => void
  private onNewTab: () => void
  private scroller: TabScroller
  private revealActive = false

  constructor(opts: { onClickTab: (id: string) => void; onCloseTab: (id: string) => void; onNewTab: () => void }) {
    this.el = document.getElementById('tabbar')!
    this.onClickTab = opts.onClickTab
    this.onCloseTab = opts.onCloseTab
    this.onNewTab = opts.onNewTab
    this.scroller = new TabScroller(this.el, () => this.tabs.map((tab) => ({
      label: (tab.id === this.activeId ? '✓ ' : '') + this.displayTitle(tab),
      action: () => this.onClickTab(tab.id)
    })))
    bus.on('tabs:list-request', () => this.scroller.openList())
    window.addEventListener('unload', () => this.scroller.dispose(), { once: true })

    const newTab = document.getElementById('btn-new-tab')!
    newTab.onclick = () => this.onNewTab()
    newTab.title = `新建标签 (${shortcutLabel('tab.new')})`

    // 空状态（无标签时显示引导）
    this.emptyEl = document.createElement('div')
    this.emptyEl.className = 'empty-state'
    this.emptyEl.innerHTML = `
      <div>
        <div style="font-size:32px; margin-bottom:8px;">⚡</div>
        <div>没有打开的终端</div>
        <div style="margin-top:6px;">按 <kbd>${shortcutLabel('tab.new')}</kbd> 或点右上角 <kbd>+</kbd> 新建</div>
      </div>
    `
    document.getElementById('terminal-host')!.appendChild(this.emptyEl)

    bus.on('session:creating', () => {
      this.pending++
      this.requestRender()
    })
    bus.on('session:create-failed', () => {
      this.pending = Math.max(0, this.pending - 1)
      this.requestRender()
    })
    bus.on('session:created', ({ id, title }) => {
      this.pending = Math.max(0, this.pending - 1)
      this.tabs.push({ id, autoTitle: title, custom: savedTitles[id] })
      this.requestRender()
    })
    bus.on('session:active', ({ id }) => {
      // 重复激活同一个标签（点当前标签、双击改名）不用重绘，少一次无谓的 DOM 重建
      if (this.activeId === id) return
      this.activeId = id
      this.revealActive = true
      this.requestRender()
    })
    bus.on('session:closed', ({ id }) => {
      if (this.editingId === id) {
        this.renameShortcuts.forEach((dispose) => dispose())
        this.renameShortcuts = []
        this.editingId = ''
      }
      this.tabs = this.tabs.filter((t) => t.id !== id)
      persistTitle(id, undefined)
      this.requestRender()
    })
    bus.on('session:exited', ({ id }) => {
      const t = this.tabs.find((t) => t.id === id)
      if (!t) return
      t.dead = true
      this.requestRender()
    })
    bus.on('session:title-changed', ({ id, title }) => {
      const t = this.tabs.find((t) => t.id === id)
      if (!t) return
      t.autoTitle = title || t.autoTitle
      // 已重命名则保持锁定（PowerShell 每条命令都会改标题，别把用户起的名字刷掉）
      if (!t.custom) this.requestRender()
    })
    bus.on('tab:rename-request', ({ id }) => {
      const target = id || this.activeId
      if (target) this.beginRename(target)
    })

    // 双击标签栏空白处新建（VSCode 风格）
    this.el.addEventListener('dblclick', (e) => {
      if (this.editingId) return
      if (e.target === this.el) this.onNewTab()
    })
  }

  private displayTitle(t: Tab | undefined): string {
    if (!t) return ''
    return (t.dead ? '[已退出] ' : '') + (t.custom || t.autoTitle || '终端')
  }

  // 事件帧合批：shell 改标题很频繁（PowerShell 每条命令都会改），一帧只渲一次
  private requestRender() {
    if (this.renderScheduled) return
    this.renderScheduled = true
    requestAnimationFrame(() => { this.renderScheduled = false; this.render() })
  }

  private render() {
    if (this.editingId) return // 编辑中冻结整栏，输入框不能被重建
    const scrollLeft = this.el.scrollLeft
    this.el.innerHTML = ''
    for (const t of this.tabs) {
      const display = this.displayTitle(t)
      const tab = document.createElement('div')
      tab.className = 'tab' + (t.id === this.activeId ? ' active' : '') + (t.dead ? ' dead' : '')
      tab.draggable = true
      tab.dataset.id = t.id
      tab.title = `${display}\n双击标题或 ${shortcutLabel('tab.rename')} 重命名`

      const titleEl = document.createElement('span')
      titleEl.className = 'tab-title' + (t.custom ? ' renamed' : '')
      titleEl.textContent = display

      const closeBtn = document.createElement('button')
      closeBtn.className = 'tab-close'
      closeBtn.title = '关闭'
      closeBtn.textContent = '×'

      tab.append(titleEl, closeBtn)

      // 点标签任意位置选中（中键关闭）；双击标题进入重命名
      tab.addEventListener('mousedown', (e) => {
        if (e.button === 1) { e.preventDefault(); this.onCloseTab(t.id); return }
        if (e.button !== 0) return
        this.onClickTab(t.id)

        // 自己判双击：激活标签会触发整栏重绘，两次点击落在不同 DOM 节点上，
        // 浏览器原生 dblclick 不会派发（实测「双击改名」就是这么失效的）
        const now = performance.now()
        if (this.lastDownId === t.id && now - this.lastDownAt < 380) {
          this.lastDownId = ''
          this.lastDownAt = 0
          // 关键：不让 mousedown 走默认的焦点处理，否则刚 focus 的输入框会被立刻 blur，
          // blur 又触发提交 + 重绘，看起来就是「双击没反应」
          e.preventDefault()
          this.beginRename(t.id)
          return
        }
        this.lastDownId = t.id
        this.lastDownAt = now
      })
      closeBtn.addEventListener('mousedown', (e) => e.stopPropagation())
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onCloseTab(t.id)
      })

      // 右键菜单：重命名 / 恢复自动标题 / 关闭
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const entries: MenuEntry[] = [
          { label: '重命名标签', shortcut: shortcutLabel('tab.rename'), action: () => this.beginRename(t.id) }
        ]
        if (t.custom) {
          entries.push({
            label: '恢复自动标题',
            action: () => {
              t.custom = undefined
              persistTitle(t.id, undefined)
              this.requestRender()
            }
          })
        }
        entries.push('separator', {
          label: '关闭标签',
          shortcut: shortcutLabel('tab.close'),
          action: () => this.onCloseTab(t.id)
        })
        showMenu(entries, e.clientX, e.clientY)
      })

      // 拖拽重排
      tab.addEventListener('dragstart', (e) => {
        if (this.editingId) { e.preventDefault(); return }
        this.dragId = t.id
        e.dataTransfer?.setData('text/plain', t.id)
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
      })
      tab.addEventListener('dragend', () => {
        if (this.dragId) this.commitOrder()
        this.dragId = null
      })
      tab.addEventListener('dragover', (e) => {
        if (!this.dragId || this.dragId === t.id) return
        e.preventDefault()
        const others = this.tabs.map((x) => x.id)
        const from = others.indexOf(this.dragId)
        const to = others.indexOf(t.id)
        if (from === to) return
        const moved = this.tabs.splice(from, 1)[0]
        this.tabs.splice(to, 0, moved)
        this.render()
      })
      tab.addEventListener('drop', (e) => {
        e.preventDefault()
        this.commitOrder()
      })

      this.el.appendChild(tab)
    }

    // 占位标签：pty 还在启动，先把位置占住，点击 + 立刻有反馈
    for (let i = 0; i < this.pending; i++) {
      const ghost = document.createElement('div')
      ghost.className = 'tab ghost'
      ghost.title = '终端启动中…'
      const title = document.createElement('span')
      title.className = 'tab-title'
      title.textContent = '启动中…'
      ghost.appendChild(title)
      this.el.appendChild(ghost)
    }

    this.emptyEl.style.display = this.tabs.length === 0 && this.pending === 0 ? 'grid' : 'none'
    this.el.scrollLeft = scrollLeft
    this.scroller.refresh(this.revealActive ? this.el.querySelector<HTMLElement>('.tab.active') : null)
    this.revealActive = false
  }

  /** 把标题换成输入框：Enter / 失焦提交，Esc 取消 */
  private beginRename(id: string) {
    if (this.editingId) this.finishRename(this.editingId, true)
    const t = this.tabs.find((x) => x.id === id)
    const tabEl = this.el.querySelector<HTMLElement>(`.tab[data-id="${CSS.escape(id)}"]`)
    const titleEl = tabEl?.querySelector('.tab-title')
    if (!t || !tabEl || !titleEl) return

    this.editingId = id
    this.scroller.refresh(tabEl)
    tabEl.draggable = false
    tabEl.classList.add('editing')

    const input = document.createElement('input')
    input.className = 'tab-rename'
    input.type = 'text'
    input.value = t.custom ?? t.autoTitle ?? ''
    input.maxLength = TITLE_MAX
    input.spellcheck = false
    input.setAttribute('aria-label', '标签名称')
    titleEl.replaceWith(input)

    // 输入框里的操作不应触发选中 / 拖拽 / 再次双击重命名
    for (const type of ['mousedown', 'click', 'dblclick', 'dragstart'] as const) {
      input.addEventListener(type, (e) => e.stopPropagation())
    }
    this.renameShortcuts = [
      registerInputShortcut('rename.confirm', input, () => this.finishRename(id, true)),
      registerInputShortcut('rename.cancel', input, () => this.finishRename(id, false))
    ]
    input.addEventListener('blur', () => this.finishRename(id, true))

    input.focus()
    input.select()
  }

  private finishRename(id: string, commit: boolean) {
    if (this.editingId !== id) return // blur 与 Enter 双触发去重
    this.renameShortcuts.forEach((dispose) => dispose())
    this.renameShortcuts = []
    const t = this.tabs.find((x) => x.id === id)
    const input = this.el.querySelector<HTMLInputElement>('.tab-rename')
    const raw = input?.value ?? ''
    this.editingId = ''

    if (t && commit) {
      const title = raw.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
      if (!title || title === t.autoTitle) {
        // 清空 = 解除锁定，回落到 shell 自动标题
        t.custom = undefined
        persistTitle(id, undefined)
      } else {
        t.custom = title
        persistTitle(id, title)
      }
    }

    this.render()
    // 焦点还给终端，别让键盘输入卡在标签栏
    if (id === this.activeId) this.onClickTab(id)
  }

  private commitOrder() {
    bus.emit('tabs:reorder', { ids: this.tabs.map((t) => t.id) })
  }
}
