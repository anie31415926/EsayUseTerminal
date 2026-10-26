import { Terminal } from '@xterm/xterm'
import { launchPack } from '../src/presets/launch'
import { BUILTIN_PACKS } from '../src/presets/builtin'
import type { InjectionPack } from '../src/presets/types'
import type { TerminalController } from '../src/terminal/TerminalController'
import type { TerminalSession } from '../src/terminal/TerminalSession'
import { bus } from '../src/core/EventBus'

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const write = (term: Terminal, text: string) => new Promise<void>((resolve) => term.write(text, resolve))
const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message) }

export async function runPackTests() {
  const results: { name: string; ok: boolean; error?: string }[] = []
  const test = async (name: string, run: () => Promise<void>) => {
    try { await run(); results.push({ name, ok: true }) }
    catch (error) { results.push({ name, ok: false, error: String(error) }) }
  }
  const originalWrite = window.spark.write
  let counter = 0
  function setup(overrides: Partial<InjectionPack> = {}) {
    const term = new Terminal({ cols: 40, rows: 24, allowProposedApi: true })
    const element = document.createElement('div')
    document.body.appendChild(element)
    term.open(element)
    const writes: string[] = []
    const session = { ptyId: `pack-${++counter}`, term, shellPath: 'powershell.exe', isExited: () => false, focus: () => {} } as unknown as TerminalSession
    let alive = true
    const controller = {
      create: async () => session.ptyId,
      all: () => alive ? [session] : [],
      active: () => session
    } as unknown as TerminalController
    const data = term.onData((text) => writes.push(text))
    window.spark.write = (id, text) => { assert(id === session.ptyId, 'wrote to the wrong terminal'); writes.push(text) }
    const pack: InjectionPack = {
      id: 'test', name: 'test', launchCommand: 'codex --no-alt-screen',
      inputReadyPattern: '^\\s*›\\s*$', injectText: 'first line\r\n中文 "quoted" $value `literal`', readyTimeoutMs: 2500,
      ...overrides
    }
    const close = () => { alive = false; bus.emit('session:closed', { id: session.ptyId }) }
    return {
      term, writes, session, pack, controller, close,
      dispose: () => { close(); data.dispose(); term.dispose(); element.remove(); window.spark.write = originalWrite }
    }
  }
  await test('pack waits for shell and app readiness, pastes once, then submits separately', async () => {
    const state = setup()
    const running = launchPack(state.controller, 'powershell.exe', state.pack)
    try {
      await write(state.term, 'Starting profile...\r\n'); await pause(450)
      assert(state.writes.length === 0, 'command was typed before shell prompt')
      await write(state.term, `PS C:\\${'long-path-'.repeat(8)}> `); await pause(450)
      assert(state.writes.join('') === state.pack.launchCommand + '\r', 'launch command was not submitted exactly once')
      await write(state.term, '\r\nLoading Codex...\r\n\x1b[?2004h› 1. Trust this directory'); await pause(450)
      assert(state.writes.length === 2, 'prompt was injected into a confirmation screen')
      await write(state.term, '\r\x1b[2K› ')
      await running
      assert(state.writes.length === 4, 'expected command, Enter, one paste and one Enter')
      const pasted = '\x1b[200~' + state.pack.injectText!.replace(/\r?\n/g, '\r') + '\x1b[201~'
      assert(state.writes[2] === pasted, 'multiline prompt was not sent as one bracketed paste')
      assert(state.writes[3] === '\r', 'prompt remained in input without submission')
    } finally { state.dispose(); await running }
  })
  await test('closing a pack terminal cancels pending injection', async () => {
    const state = setup()
    const running = launchPack(state.controller, 'powershell.exe', state.pack)
    try {
      await write(state.term, 'PS C:\\work> '); await pause(450)
      state.close(); await running
      await write(state.term, '\r\n\x1b[?2004h› '); await pause(450)
      assert(state.writes.length === 2, 'closed terminal received delayed input')
    } finally { state.dispose() }
  })
  await test('closing during paste prevents the deferred Enter', async () => {
    const state = setup({ launchCommand: undefined })
    const running = launchPack(state.controller, '', state.pack)
    try {
      await write(state.term, '\x1b[?2004hPS C:\\work> '); await pause(190)
      assert(state.writes.length === 1, 'prompt paste did not start')
      state.close(); await running
      assert(state.writes.length === 1, 'Enter was sent after closing the terminal')
    } finally { state.dispose() }
  })
  await test('readiness timeout sends no input and displays an error', async () => {
    const state = setup({ readyTimeoutMs: 80 })
    try {
      await launchPack(state.controller, '', state.pack)
      await pause(30)
      assert(state.writes.length === 0, 'timeout still sent a command')
      const lines = Array.from({ length: state.term.buffer.active.length }, (_, i) => state.term.buffer.active.getLine(i)?.translateToString(true)).join('')
      assert(lines.includes('超时'), 'timeout did not show an error in the terminal')
    } finally { state.dispose() }
  })
  await test('multiline injection is refused if bracketed paste is unavailable', async () => {
    const state = setup({ launchCommand: undefined })
    try {
      await write(state.term, 'PS C:\\work> ')
      await launchPack(state.controller, '', state.pack)
      assert(state.writes.length === 0, 'raw multiline input reached the shell')
    } finally { state.dispose() }
  })
  await test('built-in packs submit automatically', async () => {
    assert(BUILTIN_PACKS.every((pack) => pack.autoSubmit !== false), 'a built-in pack still stops at the input box')
  })
  return results
}
