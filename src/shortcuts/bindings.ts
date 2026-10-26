import type { KeyBinding } from '../core/ShortcutManager'

const mod = (code: string, shift = false): KeyBinding => ({ code, mod: true, shift })
const ctrl = (code: string, shift = false): KeyBinding => ({ code, ctrl: true, shift })

/** All keyboard assignments live here; components only register command handlers. */
export const bindings = {
  'tab.new': [mod('KeyT', true)],
  'tab.close': [mod('KeyW', true)],
  'tab.rename': [{ code: 'F2' }],
  'tab.next': [mod('Tab')],
  'tab.previous': [mod('Tab', true)],
  'tab.select': Array.from({ length: 9 }, (_, i) => mod(`Digit${i + 1}`)),
  'search.toggle': [mod('KeyF')],
  'zoom.in': [mod('Equal'), mod('Equal', true), mod('NumpadAdd')],
  'zoom.out': [mod('Minus'), mod('NumpadSubtract')],
  'zoom.reset': [mod('Digit0'), mod('Numpad0')],
  'terminal.copyOrInterrupt': [ctrl('KeyC')],
  'terminal.copy': [ctrl('KeyC', true)],
  'terminal.paste': [ctrl('KeyV'), ctrl('KeyV', true)],
  'terminal.clear': [ctrl('KeyL')],
  'terminal.undo': [ctrl('KeyZ')],
  'terminal.redo': [ctrl('KeyY'), ctrl('KeyZ', true)],
  'input.toggle': [ctrl('KeyE', true)],
  'input.submit': [{ code: 'Enter' }],
  'search.next': [{ code: 'Enter' }],
  'search.previous': [{ code: 'Enter', shift: true }],
  'search.close': [{ code: 'Escape' }],
  'rename.confirm': [{ code: 'Enter' }],
  'rename.cancel': [{ code: 'Escape' }],
  'workspace.save': [{ code: 'Enter' }],
  'pack.launch': [{ code: 'Enter' }],
  'menu.close': [{ code: 'Escape' }],
  'shortcuts.toggle': [{ code: 'F1' }],
  'shortcuts.close': [{ code: 'Escape' }]
} satisfies Record<string, readonly KeyBinding[]>

export type ShortcutCommand = keyof typeof bindings

export function formatKeyBinding(key: KeyBinding): string {
  const names: Record<string, string> = { Equal: '=', Minus: '-', Escape: 'Esc', NumpadAdd: '小键盘 +', NumpadSubtract: '小键盘 -', Numpad0: '小键盘 0' }
  const code = names[key.code] ?? key.code.replace(/^Key|^Digit/, '')
  return [key.mod || key.ctrl ? 'Ctrl' : '', key.meta ? 'Meta' : '', key.shift ? 'Shift' : '', key.alt ? 'Alt' : '', code].filter(Boolean).join('+')
}

export function shortcutLabel(command: ShortcutCommand): string {
  return formatKeyBinding(bindings[command][0])
}

interface ShortcutDescription {
  label: string
  group: string
  scope: string
}

/** Descriptions are exhaustive: adding a binding requires its visible help entry. */
export const shortcutDescriptions: Record<ShortcutCommand, ShortcutDescription> = {
  'tab.new': { label: '新建标签', group: '标签', scope: '窗口内' },
  'tab.close': { label: '关闭当前标签', group: '标签', scope: '窗口内' },
  'tab.rename': { label: '重命名当前标签', group: '标签', scope: '非文本编辑状态' },
  'tab.next': { label: '下一个标签', group: '标签', scope: '窗口内' },
  'tab.previous': { label: '上一个标签', group: '标签', scope: '窗口内' },
  'tab.select': { label: '切换到对应标签（9 为最后一个）', group: '标签', scope: '窗口内' },
  'search.toggle': { label: '打开 / 关闭查找', group: '查找', scope: '窗口内' },
  'search.next': { label: '下一个匹配', group: '查找', scope: '查找输入框' },
  'search.previous': { label: '上一个匹配', group: '查找', scope: '查找输入框' },
  'search.close': { label: '关闭查找', group: '查找', scope: '查找输入框' },
  'zoom.in': { label: '放大字体', group: '显示', scope: '窗口内' },
  'zoom.out': { label: '缩小字体', group: '显示', scope: '窗口内' },
  'zoom.reset': { label: '复位字体缩放', group: '显示', scope: '窗口内' },
  'terminal.copyOrInterrupt': { label: '复制选中文字；无选中时中断命令', group: '终端与输入', scope: '终端区域' },
  'terminal.copy': { label: '复制选中文字', group: '终端与输入', scope: '终端区域' },
  'terminal.paste': { label: '粘贴', group: '终端与输入', scope: '终端区域' },
  'terminal.clear': { label: '清屏', group: '终端与输入', scope: '终端区域' },
  'terminal.undo': { label: '撤销未发送文字', group: '终端与输入', scope: 'PowerShell / 独立输入框' },
  'terminal.redo': { label: '重做未发送文字', group: '终端与输入', scope: 'PowerShell / 独立输入框' },
  'input.toggle': { label: '显示 / 隐藏独立输入框', group: '终端与输入', scope: '窗口内' },
  'input.submit': { label: '发送草稿', group: '终端与输入', scope: '独立输入框' },
  'rename.confirm': { label: '确认重命名', group: '表单与面板', scope: '标签名称输入框' },
  'rename.cancel': { label: '取消重命名', group: '表单与面板', scope: '标签名称输入框' },
  'workspace.save': { label: '保存工作区路径', group: '表单与面板', scope: '工作区路径输入框' },
  'pack.launch': { label: '启动所选内容包', group: '表单与面板', scope: '内容包选择框' },
  'menu.close': { label: '关闭右键菜单', group: '表单与面板', scope: '右键菜单打开时' },
  'shortcuts.toggle': { label: '打开 / 关闭快捷键列表', group: '表单与面板', scope: '窗口内' },
  'shortcuts.close': { label: '关闭快捷键列表', group: '表单与面板', scope: '快捷键列表打开时' }
}

export function listShortcuts() {
  const commands = (Object.keys(bindings) as ShortcutCommand[]).map((command) => ({
    command,
    ...shortcutDescriptions[command],
    keys: bindings[command].map(formatKeyBinding)
  }))
  return [...commands, ...nativeShortcuts]
}

// Native editing and mouse gestures do not register keydown handlers.
const nativeShortcuts = [
  { command: 'native.input.newline', label: '草稿换行', group: '终端与输入', scope: '独立输入框', keys: ['Shift+Enter'] },
  { command: 'gesture.zoom', label: '缩放字体', group: '显示', scope: '终端区域', keys: ['Ctrl+鼠标滚轮'] }
]
