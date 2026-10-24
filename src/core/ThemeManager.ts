/**
 * 主题管理器：所有视觉参数都来自 ThemeManager 应用到 documentElement 的 CSS 变量，
 * 新增主题 = 在 core/themes.ts 的 THEMES 里加一条即可，业务代码零改动。
 */
import { THEMES, THEME_KEY } from './themes'

const VALID_VAR = /^--[a-z0-9-]+$/

export type Theme = {
  id: string
  label: string
  /** 应用到 documentElement 的 UI 配色变量 */
  vars: Record<string, string>
  /** xterm 色板 */
  xterm: {
    background: string; foreground: string; cursor: string
    black: string; red: string; green: string; yellow: string
    blue: string; magenta: string; cyan: string; white: string
    brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string
    brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string
  }
}

export class ThemeManager {
  current: Theme = THEMES[0]

  constructor() {
    // 恢复上次选择的主题
    try {
      const saved = localStorage.getItem(THEME_KEY)
      const found = saved ? THEMES.find((t) => t.id === saved) : undefined
      if (found) this.current = found
    } catch { /* 无痕模式忽略 */ }
  }

  list(): Theme[] {
    return THEMES
  }

  apply(theme: Theme) {
    this.current = theme
    const root = document.documentElement.style
    for (const [k, v] of Object.entries(theme.vars)) {
      if (VALID_VAR.test(k)) root.setProperty(k, v)
    }
    root.setProperty('--term-bg', theme.xterm.background)
    root.setProperty('--term-fg', theme.xterm.foreground)
    root.setProperty('--term-cursor', theme.xterm.cursor)
    // 窗口原生底色同步，避免缩放/弹窗闪白
    window.spark?.window?.setBg?.(theme.xterm.background)
    // 已打开的 xterm 实例换色（旧实例的主题是构造时写入的）
    try { localStorage.setItem(THEME_KEY, theme.id) } catch { /* 忽略 */ }
  }

  applyById(id: string): Theme | undefined {
    const t = THEMES.find((t) => t.id === id)
    if (t) this.apply(t)
    return t
  }

  xtermTheme() {
    return { ...this.current.xterm }
  }
}

export const themeManager = new ThemeManager()
