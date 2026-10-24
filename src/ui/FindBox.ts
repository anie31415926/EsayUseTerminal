import type { TerminalSession } from '../terminal/TerminalSession'
import { bus } from '../core/EventBus'

/**
 * 查找框（Ctrl+F / 右键菜单"查找"）：
 * 输入即查、Enter 下一个、Shift+Enter 上一个、Esc 关闭并清除高亮。
 * 目标会话由 main 在 session:active 时注入。
 */
export class FindBox {
  private el: HTMLDivElement
  private input: HTMLInputElement
  private session: TerminalSession | null = null
  private visible = false

  constructor() {
    this.el = document.createElement('div')
    this.el.className = 'findbar'
    this.el.style.display = 'none'
    this.el.innerHTML = `
      <input class="findbar-input" placeholder="查找…" spellcheck="false" />
      <button class="findbar-btn" data-act="prev" title="上一个 (Shift+Enter)">↑</button>
      <button class="findbar-btn" data-act="next" title="下一个 (Enter)">↓</button>
      <button class="findbar-btn" data-act="close" title="关闭 (Esc)">✕</button>
    `
    document.body.appendChild(this.el)
    this.input = this.el.querySelector('.findbar-input')!

    this.input.addEventListener('input', () => this.find(this.input.value, 'next'))
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.find(this.input.value, e.shiftKey ? 'prev' : 'next')
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.close()
      }
    })

    this.el.addEventListener('click', (ev) => {
      const act = (ev.target as HTMLElement).closest('button')?.dataset.act
      if (act === 'next') this.find(this.input.value, 'next')
      else if (act === 'prev') this.find(this.input.value, 'prev')
      else if (act === 'close') this.close()
    })

    bus.on('search:toggle', () => this.toggle())
  }

  /** 供 main 在会话切换时更新目标 */
  setSession(session: TerminalSession | null) {
    this.session = session
  }

  /** 当前绑定的 pty 会话 id（main 用它判断会话是否已经关闭） */
  get sessionId(): string {
    return this.session?.ptyId ?? ''
  }

  toggle() {
    if (this.visible) this.close()
    else this.open()
  }

  private open() {
    const sel = this.session?.term.getSelection()
    if (!this.session) return
    this.visible = true
    this.el.style.display = 'flex'
    if (sel) this.input.value = sel
    this.input.select()
    if (this.input.value) this.find(this.input.value, 'next')
  }

  private close() {
    this.visible = false
    this.el.style.display = 'none'
    this.session?.search.clearDecorations()
    this.session?.term.focus()
  }

  private find(term_: string, dir: 'next' | 'prev') {
    if (!this.session) return
    // decoration 参数为 ISearchOptions 必填项，给高亮色让命中项可见
    const opts = {
      decorations: {
        matchOverviewRuler: '#a3e635',
        activeMatchColorOverviewRuler: '#8b5cf6',
        matchBorder: '#a3e635',
        activeMatchBorder: '#8b5cf6'
      }
    }
    try {
      if (dir === 'next') this.session.search.findNext(term_, opts)
      else this.session.search.findPrevious(term_, opts)
    } catch { /* addon 未就绪时忽略 */ }
  }
}
