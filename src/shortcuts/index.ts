import { ShortcutManager, type Shortcut } from '../core/ShortcutManager'
import { bindings, type ShortcutCommand } from './bindings'

export const shortcuts = new ShortcutManager()

export function registerShortcut(command: ShortcutCommand, options: Omit<Shortcut, 'id' | 'keys'>): () => void {
  return shortcuts.register({ id: command, keys: bindings[command], ...options })
}

/** Scoped form keys keep their command bindings in the same catalog as application shortcuts. */
export function registerInputShortcut(command: ShortcutCommand, element: HTMLElement, run: () => void, instance = ''): () => void {
  return shortcuts.register({
    id: instance ? `${command}:${instance}` : command,
    keys: bindings[command],
    allowInEditable: true,
    priority: 10,
    when: (event) => event.target === element,
    run
  })
}
