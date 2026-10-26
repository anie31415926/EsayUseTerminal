import { listShortcuts, shortcutLabel } from '../shortcuts/bindings'
import { registerShortcut } from '../shortcuts'

export class ShortcutPanel {
  private dialog = document.createElement('dialog')
  private filter = document.createElement('input')
  private body = document.createElement('tbody')
  private empty = document.createElement('p')
  private unregister: (() => void)[]

  constructor() {
    this.dialog.className = 'shortcut-panel'
    this.dialog.setAttribute('aria-labelledby', 'shortcut-panel-title')
    const header = document.createElement('header')
    const title = document.createElement('h2')
    title.id = 'shortcut-panel-title'
    title.textContent = '快捷键'
    const close = document.createElement('button')
    close.className = 'shortcut-panel-close'
    close.textContent = '×'
    close.title = `关闭 (${shortcutLabel('shortcuts.close')})`
    close.setAttribute('aria-label', '关闭快捷键列表')
    close.addEventListener('click', () => this.close())
    header.append(title, close)
    this.filter.type = 'search'
    this.filter.className = 'shortcut-panel-filter'
    this.filter.placeholder = '搜索操作、按键或生效范围'
    this.filter.setAttribute('aria-label', '搜索快捷键')
    this.filter.addEventListener('input', () => this.render())
    const viewport = document.createElement('div')
    viewport.className = 'shortcut-panel-scroll'
    const table = document.createElement('table')
    table.setAttribute('aria-label', '全部快捷键及生效范围')
    const head = document.createElement('thead')
    const columns = document.createElement('tr')
    for (const text of ['操作', '快捷键', '生效范围']) {
      const th = document.createElement('th')
      th.scope = 'col'
      th.textContent = text
      columns.appendChild(th)
    }
    head.appendChild(columns)
    table.append(head, this.body)
    this.empty.className = 'shortcut-panel-empty'
    this.empty.setAttribute('role', 'status')
    this.empty.textContent = '没有匹配的快捷键'
    viewport.append(table, this.empty)
    this.dialog.append(header, this.filter, viewport)
    document.body.appendChild(this.dialog)
    this.dialog.addEventListener('click', (event) => {
      const rect = this.dialog.getBoundingClientRect()
      if (event.target === this.dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) this.close()
    })
    this.unregister = [
      registerShortcut('shortcuts.toggle', { run: () => this.toggle(), allowInEditable: true, allowInModal: true, repeat: false, priority: 200 }),
      registerShortcut('shortcuts.close', { run: () => this.close(), when: () => this.dialog.open, allowInEditable: true, allowInModal: true, priority: 200 })
    ]
  }

  toggle() {
    if (this.dialog.open) this.close()
    else {
      this.filter.value = ''
      this.render()
      this.dialog.showModal()
      this.filter.focus()
    }
  }

  private render() {
    const normalize = (text: string) => text.toLowerCase().replace(/[\s+]/g, '')
    const query = normalize(this.filter.value)
    const rows = listShortcuts().filter((item) => normalize([item.label, item.scope, item.group, ...item.keys].join(' ')).includes(query))
    this.body.replaceChildren()
    let group = ''
    // Preserve the catalog's group order while keeping related commands together.
    for (const category of new Set(rows.map((row) => row.group))) {
      for (const item of rows.filter((row) => row.group === category)) {
        if (group !== item.group) {
          group = item.group
          const heading = document.createElement('tr')
          heading.className = 'shortcut-panel-group'
          const cell = document.createElement('th')
          cell.colSpan = 3
          cell.textContent = group
          heading.appendChild(cell)
          this.body.appendChild(heading)
        }
        const row = document.createElement('tr')
        row.dataset.command = item.command
        const label = document.createElement('td')
        label.textContent = item.label
        const keys = document.createElement('td')
        const keyList = document.createElement('div')
        keyList.className = 'shortcut-panel-keys'
        for (const key of item.keys) {
          const kbd = document.createElement('kbd')
          kbd.textContent = key
          keyList.appendChild(kbd)
        }
        keys.appendChild(keyList)
        const scope = document.createElement('td')
        scope.textContent = item.scope
        row.append(label, keys, scope)
        this.body.appendChild(row)
      }
    }
    this.empty.hidden = rows.length > 0
  }

  close() { this.dialog.close() }

  dispose() {
    this.close()
    this.unregister.forEach((unregister) => unregister())
    this.dialog.remove()
  }
}
