import { themeManager } from '../core/ThemeManager'
import { bus } from '../core/EventBus'
import { FONT_MIN, FONT_MAX } from '../terminal/TerminalSession'

export interface SettingsAccess {
  getFontSize: () => number
  setFontSize: (size: number) => void
}

/**
 * 设置面板：字号滑杆 + 主题切换。从状态栏齿轮打开，点外部关闭。
 * 字号改动即时生效并持久化（localStorage），主题切换立即应用整窗配色。
 */
export class SettingsPanel {
  private el: HTMLDivElement
  private open = false
  private access: SettingsAccess
  private fontSlider: HTMLInputElement
  private fontValue: HTMLSpanElement
  private themeSelect: HTMLSelectElement

  constructor(access: SettingsAccess) {
    this.access = access
    this.el = document.createElement('div')
    this.el.className = 'settings-panel'
    this.el.style.display = 'none'
    document.body.appendChild(this.el)

    // -- 字号行
    const fontRow = document.createElement('div')
    fontRow.className = 'settings-row'
    this.fontValue = document.createElement('span')
    this.fontValue.className = 'settings-value'
    this.fontSlider = document.createElement('input')
    this.fontSlider.type = 'range'
    this.fontSlider.min = String(FONT_MIN)
    this.fontSlider.max = String(FONT_MAX)
    this.fontSlider.step = '1'
    this.fontSlider.className = 'settings-slider'
    this.fontSlider.addEventListener('input', () => {
      const n = Number(this.fontSlider.value)
      this.access.setFontSize(n)
      this.fontValue.textContent = String(n)
    })
    fontRow.appendChild(this.labelWith('字号', this.fontValue))
    fontRow.appendChild(this.fontSlider)

    // -- 主题行
    const themeRow = document.createElement('div')
    themeRow.className = 'settings-row'
    this.themeSelect = document.createElement('select')
    this.themeSelect.className = 'settings-select'
    for (const t of themeManager.list()) {
      const opt = document.createElement('option')
      opt.value = t.id
      opt.textContent = t.label
      this.themeSelect.appendChild(opt)
    }
    this.themeSelect.addEventListener('change', () => {
      if (themeManager.applyById(this.themeSelect.value)) {
        bus.emit('theme:changed', { id: this.themeSelect.value })
      }
    })
    themeRow.appendChild(this.labelWith('主题'))
    themeRow.appendChild(this.themeSelect)

    const hint = document.createElement('div')
    hint.className = 'settings-hint'
    hint.textContent = '字号改动立即生效并自动保存 · Ctrl+滚轮 也可缩放'

    this.el.appendChild(fontRow)
    this.el.appendChild(themeRow)
    this.el.appendChild(hint)

    // 点面板外关闭
    document.addEventListener('mousedown', (e) => {
      if (!this.open) return
      const target = e.target as Node
      const btn = document.getElementById('btn-settings')
      if (this.el.contains(target) || btn?.contains(target)) return
      this.close()
    })
  }

  private labelWith(text: string, extra?: HTMLElement): HTMLDivElement {
    const label = document.createElement('div')
    label.className = 'settings-key'
    label.textContent = text
    const wrap = document.createElement('div')
    wrap.className = 'settings-key-wrap'
    wrap.appendChild(label)
    if (extra) wrap.appendChild(extra)
    return wrap
  }

  private sync() {
    const cur = this.access.getFontSize()
    this.fontSlider.value = String(cur)
    this.fontValue.textContent = String(cur)
    this.themeSelect.value = themeManager.current.id
  }

  toggle(anchor: HTMLElement) {
    if (this.open) this.close()
    else {
      this.sync()
      this.open = true
      const r = anchor.getBoundingClientRect()
      this.el.style.display = 'block'
      this.el.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - this.el.offsetWidth - 8)}px`
      this.el.style.bottom = `${window.innerHeight - r.top + 6}px`
    }
  }

  private close() {
    this.open = false
    this.el.style.display = 'none'
  }
}
