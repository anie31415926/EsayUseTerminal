import type { TerminalController } from '../terminal/TerminalController'
import { bus } from '../core/EventBus'
import { registerShortcut } from './index'
import type { ShortcutCommand } from './bindings'

export function registerAppShortcuts(controller: TerminalController, newTab: () => void): () => void {
  const disposers: (() => void)[] = []
  const app = (command: ShortcutCommand, run: (event: KeyboardEvent) => void, repeat = true) => {
    disposers.push(registerShortcut(command, { run, repeat, allowInEditable: command !== 'tab.rename' }))
  }
  const terminal = (command: ShortcutCommand, run: () => void) => {
    disposers.push(registerShortcut(command, { run, when: () => !!controller.active()?.hasFocus() }))
  }
  app('window.new', () => { void window.spark.window.newWindow() }, false)
  app('tab.new', newTab, false)
  app('tab.list', () => bus.emit('tabs:list-request', {}), false)
  app('tab.close', () => { const id = controller.active()?.ptyId; if (id) controller.close(id) }, false)
  app('tab.rename', () => { const id = controller.active()?.ptyId; if (id) bus.emit('tab:rename-request', { id }) }, false)
  const cycle = (step: number) => {
    const all = controller.all()
    if (all.length < 2) return
    const index = all.findIndex((s) => s === controller.active())
    controller.activate(all[(index + step + all.length) % all.length].ptyId)
  }
  app('tab.next', () => cycle(1))
  app('tab.previous', () => cycle(-1))
  app('tab.select', (event) => {
    const all = controller.all()
    const n = Number(event.code.slice(5))
    const target = all[n === 9 ? all.length - 1 : n - 1]
    if (target) controller.activate(target.ptyId)
  })
  app('search.toggle', () => bus.emit('search:toggle', {}), false)
  app('zoom.in', () => { const s = controller.active(); if (s) s.setZoom(s.getZoom() + 0.1) })
  app('zoom.out', () => { const s = controller.active(); if (s) s.setZoom(s.getZoom() - 0.1) })
  app('zoom.reset', () => controller.active()?.setZoom(1))
  terminal('terminal.copyOrInterrupt', () => controller.active()?.copyOrInterrupt())
  terminal('terminal.copy', () => controller.active()?.copySelection())
  terminal('terminal.paste', () => { void controller.active()?.pasteFromClipboard() })
  terminal('terminal.clear', () => controller.active()?.term.clear())
  for (const [command, action] of [
    ['terminal.undo', () => controller.active()?.undoInput()],
    ['terminal.redo', () => controller.active()?.redoInput()]
  ] as const) {
    disposers.push(registerShortcut(command, { run: action, allowInEditable: true, when: () => !!controller.active()?.hasInputFocus() }))
  }
  app('input.toggle', () => controller.active()?.toggleInputEditor(), false)
  return () => disposers.forEach((dispose) => dispose())
}
