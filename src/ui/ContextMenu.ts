import type { TerminalSession } from '../terminal/TerminalSession'
import { bus } from '../core/EventBus'

export interface MenuItem {
  label: string
  shortcut?: string
  action: () => void
  disabled?: boolean
}
export type MenuEntry = MenuItem | 'separator'

/**
 * 通用浮层菜单：靠视口边缘自动夹取，点外部 / Esc / 窗口缩放即关闭。
 * 终端右键菜单与标签右键菜单共用同一套样式与关闭逻辑，避免两份实现漂移。
 */
export function showMenu(entries: MenuEntry[], x: number, y: number) {
  document.querySelectorAll('.context-menu').forEach((el) => el.remove())

  const menu = document.createElement('div')
  menu.className = 'context-menu'
  menu.style.visibility = 'hidden'
  menu.style.left = '0px'
  menu.style.top = '0px'

  for (const entry of entries) {
    if (entry === 'separator') {
      const sep = document.createElement('div')
      sep.className = 'separator'
      menu.appendChild(sep)
      continue
    }
    const btn = document.createElement('button')
    const label = document.createElement('span')
    label.textContent = entry.label
    btn.appendChild(label)
    if (entry.shortcut) {
      const sc = document.createElement('span')
      sc.className = 'shortcut'
      sc.textContent = entry.shortcut
      btn.appendChild(sc)
    }
    if (entry.disabled) {
      btn.disabled = true
    } else {
      btn.addEventListener('click', () => { close(); entry.action() })
    }
    menu.appendChild(btn)
  }

  document.body.appendChild(menu)

  // 先挂到 DOM 量真实尺寸，再夹进视口（右侧 / 底部自动翻转）
  const w = menu.offsetWidth
  const h = menu.offsetHeight
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 8))}px`
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 8))}px`
  menu.style.visibility = ''

  function close() {
    menu.remove()
    document.removeEventListener('mousedown', onDoc, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', close)
    window.removeEventListener('blur', close)
  }
  function onDoc(ev: MouseEvent) {
    if (!menu.contains(ev.target as Node)) close()
  }
  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') { ev.stopPropagation(); close() }
  }
  setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)

  return close
}

/**
 * 终端右键菜单：复制 / 粘贴 / 查找 / 清屏 / 新建标签。
 */
export function attachContextMenu(
  hostEl: HTMLElement,
  getActiveSession: () => TerminalSession | undefined,
  onNewTab: () => void
) {
  hostEl.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const session = getActiveSession()
    if (!session) return

    const selection = session.term.getSelection()
    showMenu([
      {
        label: '复制',
        shortcut: 'Ctrl+Shift+C',
        disabled: !selection,
        action: () => {
          if (!selection) return
          navigator.clipboard.writeText(selection).catch(() => { /* 剪贴板不可用 */ })
        }
      },
      {
        label: '粘贴',
        shortcut: 'Ctrl+Shift+V',
        action: async () => {
          try {
            const text = await navigator.clipboard.readText()
            if (text) session.term.paste(text)
          } catch { /* 剪贴板不可用时忽略 */ }
        }
      },
      {
        label: '查找',
        shortcut: 'Ctrl+F',
        action: () => bus.emit('search:toggle', { needle: session.term.getSelection() })
      },
      'separator',
      { label: '清屏', shortcut: 'Ctrl+L', action: () => session.term.clear() },
      'separator',
      { label: '新建标签', shortcut: 'Ctrl+Shift+T', action: onNewTab }
    ], e.clientX, e.clientY)
  })
}
