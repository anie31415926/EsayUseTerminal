import type { Theme } from './ThemeManager'

/**
 * 主题：每个主题自带完整 CSS 变量表 + xterm 色板。
 * 新增主题 = 在 THEMES 加一条（无需新 CSS 文件），设置面板自动出现新选项。
 */
export const THEMES: Theme[] = [
  {
    id: 'neon',
    label: 'Neon Pop',
    vars: {
      '--bg': '#0e1116',
      '--bg-elev': '#161b22',
      '--bg-hover': '#1f2630',
      '--fg': '#e6edf3',
      '--fg-dim': '#8b949e',
      '--border': '#21262d',
      '--accent': '#a3e635',
      '--accent-2': '#8b5cf6'
    },
    xterm: {
      background: '#0e1116', foreground: '#e6edf3', cursor: '#a3e635',
      black: '#1b1f24', red: '#ff7b72', green: '#7ee787', yellow: '#e3b341',
      blue: '#79c0ff', magenta: '#d2a8ff', cyan: '#39c5cf', white: '#e6edf3',
      brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341',
      brightBlue: '#a5d6ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#ffffff'
    }
  },
  {
    id: 'midnight',
    label: 'Midnight 冰蓝',
    vars: {
      '--bg': '#0b1220',
      '--bg-elev': '#101a2e',
      '--bg-hover': '#1a2740',
      '--fg': '#dbe7ff',
      '--fg-dim': '#7d8fb5',
      '--border': '#1d2a45',
      '--accent': '#5eead4',
      '--accent-2': '#7dd3fc'
    },
    xterm: {
      background: '#0b1220', foreground: '#dbe7ff', cursor: '#5eead4',
      black: '#131c2e', red: '#fb7185', green: '#86efac', yellow: '#fcd34d',
      blue: '#7dd3fc', magenta: '#c4b5fd', cyan: '#67e8f9', white: '#dbe7ff',
      brightBlack: '#64748b', brightRed: '#fda4af', brightGreen: '#bbf7d0', brightYellow: '#fde68a',
      brightBlue: '#bae6fd', brightMagenta: '#ddd6fe', brightCyan: '#a5f3fc', brightWhite: '#f8fafc'
    }
  }
]

export const THEME_KEY = 'spark.theme'
