import { showMenu, type MenuEntry } from './ContextMenu'
import { shortcutLabel } from '../shortcuts/bindings'

/** Horizontal navigation and overflow selection, independent of terminal/session ownership. */
export class TabScroller {
  private previous = document.createElement('button')
  private next = document.createElement('button')
  private list = document.createElement('button')
  private observer: ResizeObserver
  private closeMenu: (() => void) | undefined

  constructor(private viewport: HTMLElement, private entries: () => MenuEntry[]) {
    for (const [button, id, label, icon] of [
      [this.previous, 'btn-tab-prev', '向左滚动标签', '‹'],
      [this.next, 'btn-tab-next', '向右滚动标签', '›'],
      [this.list, 'btn-tab-list', `全部标签 (${shortcutLabel('tab.list')})`, '▾']
    ] as const) {
      button.id = id
      button.className = 'ghost-btn tab-nav-btn'
      button.title = label
      button.setAttribute('aria-label', label)
      button.textContent = icon
    }
    this.list.setAttribute('aria-haspopup', 'menu')
    viewport.before(this.previous)
    viewport.after(this.next, this.list)
    this.previous.addEventListener('click', () => this.scroll(-1))
    this.next.addEventListener('click', () => this.scroll(1))
    this.list.addEventListener('click', () => this.openList())
    viewport.addEventListener('wheel', this.onWheel, { passive: false })
    viewport.addEventListener('scroll', this.update)
    this.observer = new ResizeObserver(this.update)
    this.observer.observe(viewport)
    this.update()
  }

  private scroll(direction: number) {
    this.viewport.scrollLeft += direction * Math.max(120, this.viewport.clientWidth * 0.75)
    this.update()
  }

  private onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || this.viewport.scrollWidth <= this.viewport.clientWidth) return
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (!delta) return
    event.preventDefault()
    const scale = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? this.viewport.clientWidth : 1
    this.viewport.scrollLeft += delta * scale
    this.update()
  }

  private update = () => {
    this.previous.disabled = this.viewport.scrollLeft <= 1
    this.next.disabled = this.viewport.scrollLeft + this.viewport.clientWidth >= this.viewport.scrollWidth - 1
    this.list.disabled = !this.viewport.querySelector('.tab:not(.ghost)')
  }

  refresh(reveal?: HTMLElement | null) {
    if (reveal) {
      const item = reveal.getBoundingClientRect()
      const bounds = this.viewport.getBoundingClientRect()
      if (item.left < bounds.left) this.viewport.scrollLeft += item.left - bounds.left
      else if (item.right > bounds.right) this.viewport.scrollLeft += item.right - bounds.right
    }
    this.update()
  }

  openList() {
    const entries = this.entries()
    if (!entries.length) return
    const rect = this.list.getBoundingClientRect()
    this.closeMenu = showMenu(entries, rect.left, rect.bottom + 4)
  }

  dispose() {
    this.closeMenu?.()
    this.observer.disconnect()
    this.viewport.removeEventListener('wheel', this.onWheel)
    this.viewport.removeEventListener('scroll', this.update)
    this.previous.remove()
    this.next.remove()
    this.list.remove()
  }
}
