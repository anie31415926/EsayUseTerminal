import { ShortcutManager } from '../src/core/ShortcutManager'

type Test = (name: string, fn: () => void | Promise<void>) => Promise<void>
const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message) }
const key = (options: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, cancelable: true, ...options })

export async function runShortcutTests(test: Test) {
  await test('shortcut routing executes once across DOM and xterm dispatch', () => {
    const manager = new ShortcutManager()
    let calls = 0
    manager.register({ id: 'undo', keys: [{ code: 'KeyZ', ctrl: true }], run: () => { calls++ } })
    const event = key()
    assert(manager.handle(event) && manager.handle(event), 'handled event was not consumed on both paths')
    assert(calls === 1 && event.defaultPrevented, `command executed ${calls} times`)
  })
  await test('shortcuts require exact modifiers and preserve IME input', () => {
    const manager = new ShortcutManager()
    let calls = 0
    manager.register({ id: 'undo', keys: [{ code: 'KeyZ', ctrl: true }], run: () => { calls++ } })
    for (const options of [{ altKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }]) {
      const event = key(options)
      assert(!manager.handle(event) && !event.defaultPrevented, 'unrelated combination was consumed')
    }
    assert(calls === 0, 'unrelated combination invoked undo')
  })
  await test('shortcut scopes, priority, repeat, and unregister release handlers', () => {
    const manager = new ShortcutManager()
    const calls: string[] = []
    let enabled = false
    manager.register({ id: 'base', keys: [{ code: 'KeyZ', ctrl: true }], run: () => calls.push('base') })
    const off = manager.register({ id: 'scoped', keys: [{ code: 'KeyZ', ctrl: true }], priority: 10, repeat: false, when: () => enabled, run: () => calls.push('scoped') })
    manager.handle(key())
    enabled = true
    manager.handle(key())
    assert(manager.handle(key({ repeat: true })), 'repeat should be consumed without re-executing')
    off(); manager.handle(key())
    assert(calls.join(',') === 'base,scoped,base', `wrong routing: ${calls}`)
    manager.dispose()
    assert(!manager.handle(key()), 'disposed manager retained bindings')
  })
  await test('native text fields retain Ctrl+Z and manager detaches its listener', () => {
    const manager = new ShortcutManager()
    const input = document.createElement('input')
    document.body.appendChild(input)
    const detach = manager.attach(window)
    let calls = 0
    manager.register({ id: 'undo', keys: [{ code: 'KeyZ', ctrl: true }], run: () => { calls++ } })
    try {
      const native = key({ bubbles: true })
      input.dispatchEvent(native)
      assert(!native.defaultPrevented && calls === 0, 'native text undo was intercepted')
      const global = key()
      window.dispatchEvent(global)
      assert(global.defaultPrevented && Number(calls) === 1, 'global command did not run')
      detach()
      window.dispatchEvent(key())
      assert(Number(calls) === 1, 'detached listener ran again')
    } finally { manager.dispose(); input.remove() }
  })
}
