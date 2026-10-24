import { bus } from '../core/EventBus'

interface Tab { id: string; title: string; dead?: boolean }

/**
 * TabBar —— 纯视图组件，订阅事件总线渲染标签，不持有会话状态。
 * 交互：左键选中、×关闭、鼠标中键关闭、双击空白处新建、拖拽重排。
 * 会话退出后标签变灰并标注「已退出」。
 */
export class TabBar {
  private el: HTMLElement
  private tabs: Tab[] = []
  private activeId = ''
  private emptyEl: HTMLDivElement
  private dragId: string | null = null
  private renderScheduled = false
  private onClickTab: (id: string) => void
  private onCloseTab: (id: string) => void
  private onNewTab: () => void

  constructor(opts: { onClickTab: (id: string) => void; onCloseTab: (id: string) => void; onNewTab: () => void }) {
    this.el = document.getElementById('tabbar')!
    this.onClickTab = opts.onClickTab
    this.onCloseTab = opts.onCloseTab
    this.onNewTab = opts.onNewTab

    document.getElementById('btn-new-tab')!.onclick = () => this.onNewTab()

    // 空状态（无标签时显示引导）
    this.emptyEl = document.createElement('div')
    this.emptyEl.className = 'empty-state'
    this.emptyEl.innerHTML = `
      <div>
        <div style="font-size:32px; margin-bottom:8px;">⚡</div>
        <div>没有打开的终端</div>
        <div style="margin-top:6px;">按 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> 或点右上角 <kbd>+</kbd> 新建</div>
      </div>
    `
    document.getElementById('terminal-host')!.appendChild(this.emptyEl)

    bus.on('session:created', ({ id, title }) => {
      this.tabs.push({ id, title })
      this.requestRender()
    })
    bus.on('session:active', ({ id }) => { this.activeId = id; this.requestRender() })
    bus.on('session:closed', ({ id }) => {
      this.tabs = this.tabs.filter((t) => t.id !== id)
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
      if (t) { t.title = title; this.requestRender() }
    })

    // 双击标签栏空白处新建（VSCode 风格）
    this.el.addEventListener('dblclick', (e) => {
      if (e.target === this.el) this.onNewTab()
    })
  }

  // 事件帧合批：shell 改标题很频繁（PowerShell 每条命令都会改），一帧只渲一次
  private requestRender() {
    if (this.renderScheduled) return
    this.renderScheduled = true
    requestAnimationFrame(() => { this.renderScheduled = false; this.render() })
  }

  private render() {
    this.el.innerHTML = ''
    for (const t of this.tabs) {
      const tab = document.createElement('div')
      tab.className = 'tab' + (t.id === this.activeId ? ' active' : '') + (t.dead ? ' dead' : '')
      tab.draggable = true
      tab.innerHTML = `<span class="tab-title"></span><button class="tab-close" title="关闭">×</button>`
      const titleEl = tab.querySelector('.tab-title') as HTMLElement
      titleEl.textContent = (t.dead ? '[已退出] ' : '') + (t.title || '终端')

      // 点标签任意位置选中（中键关闭）
      tab.addEventListener('mousedown', (e) => {
        if (e.button === 1) { e.preventDefault(); this.onCloseTab(t.id); return }
        if (e.button === 0) this.onClickTab(t.id)
      })
      tab.querySelector('.tab-close')!.addEventListener('mousedown', (e) => e.stopPropagation())
      tab.querySelector('.tab-close')!.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onCloseTab(t.id)
      })

      // 拖拽重排
      tab.addEventListener('dragstart', (e) => {
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
    this.emptyEl.style.display = this.tabs.length === 0 ? 'grid' : 'none'
  }

  private commitOrder() {
    bus.emit('tabs:reorder', { ids: this.tabs.map((t) => t.id) })
  }
}
