import type { TerminalSession } from '../terminal/TerminalSession'
import { bus } from '../core/EventBus'

/**
 * 终端右键菜单：复制 / 粘贴 / 清屏 / 新建标签。
 * 每次右键动态创建一个浮层，点别处即销毁。
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

    const menu = document.createElement('div')
    menu.className = 'context-menu'
    menu.innerHTML = `
      <button data-act="copy">复制 <span class="shortcut">Ctrl+Shift+C</span></button>
      <button data-act="paste">粘贴 <span class="shortcut">Ctrl+Shift+V</span></button>
      <button data-act="find">查找 <span class="shortcut">Ctrl+F</span></button>
      <div class="separator"></div>
      <button data-act="clear">清屏 <span class="shortcut">Ctrl+L</span></button>
      <div class="separator"></div>
      <button data-act="newtab">新建标签 <span class="shortcut">Ctrl+Shift+T</span></button>
    `
    // 视口边缘自动翻转
    const x = Math.min(e.clientX, window.innerWidth - 180)
    const y = Math.min(e.clientY, window.innerHeight - 200)
    menu.style.left = `${x}px`
    menu.style.top = `${y}px`
    document.body.appendChild(menu)

    const close = () => { menu.remove(); document.removeEventListener('mousedown', onDoc, true) }
    const onDoc = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node)) close() }
    setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0)

    menu.addEventListener('click', async (ev) => {
      const act = (ev.target as HTMLElement).closest('button')?.dataset.act
      close()
      const term = session.term
      if (act === 'copy') {
        const sel = term.getSelection()
        if (sel) await navigator.clipboard.writeText(sel)
      } else if (act === 'paste') {
        const text = await navigator.clipboard.readText()
        session.term.paste(text)
      } else if (act === 'clear') {
        session.term.clear()
      } else if (act === 'find') {
        bus.emit('search:toggle', { needle: session.term.getSelection() })
      } else if (act === 'newtab') {
        onNewTab()
      }
    })
  })
}
