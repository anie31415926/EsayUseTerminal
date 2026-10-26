export interface KeyBinding {
  code: string
  mod?: boolean
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
}

export interface Shortcut {
  id: string
  keys: readonly KeyBinding[]
  run: (event: KeyboardEvent) => void
  when?: (event: KeyboardEvent) => boolean
  allowInEditable?: boolean
  allowInModal?: boolean
  repeat?: boolean
  priority?: number
}

function matches(event: KeyboardEvent, key: KeyBinding): boolean {
  const modifier = key.mod
    ? (event.ctrlKey || event.metaKey) && !event.altKey
    : event.ctrlKey === !!key.ctrl && event.metaKey === !!key.meta
  return event.code === key.code && modifier && event.shiftKey === !!key.shift && event.altKey === !!key.alt
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target.closest('.xterm')) return false
  return !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
}

/** Shared routing for DOM and xterm: exact modifiers, focus scopes, and one execution per event. */
export class ShortcutManager {
  private entries = new Map<string, Shortcut>()
  private handled = new WeakSet<KeyboardEvent>()
  private detach: (() => void) | null = null

  register(shortcut: Shortcut): () => void {
    if (this.entries.has(shortcut.id)) throw new Error(`Duplicate shortcut: ${shortcut.id}`)
    this.entries.set(shortcut.id, shortcut)
    return () => { if (this.entries.get(shortcut.id) === shortcut) this.entries.delete(shortcut.id) }
  }

  handle(event: KeyboardEvent): boolean {
    if (this.handled.has(event)) return true
    if (event.type !== 'keydown' || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph')) return false
    const entries = [...this.entries.values()].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    const modalOpen = !!document.querySelector('dialog:modal')
    for (const entry of entries) {
      if (modalOpen && !entry.allowInModal) continue
      if (!entry.keys.some((key) => matches(event, key)) || (entry.when && !entry.when(event))) continue
      if (!entry.allowInEditable && isEditable(event.target)) continue
      this.handled.add(event)
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat || entry.repeat !== false) entry.run(event)
      return true
    }
    return false
  }

  attach(target: Window): () => void {
    this.detach?.()
    const listener = (event: KeyboardEvent) => { this.handle(event) }
    target.addEventListener('keydown', listener, true)
    const detach = () => {
      target.removeEventListener('keydown', listener, true)
      if (this.detach === detach) this.detach = null
    }
    this.detach = detach
    return detach
  }

  dispose() {
    this.detach?.()
    this.entries.clear()
  }
}
