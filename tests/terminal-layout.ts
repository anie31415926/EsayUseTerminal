import { TerminalSession } from '../src/terminal/TerminalSession'

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const settle = async () => { for (let i = 0; i < 5; i++) await frame() }
const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message) }
const write = (session: TerminalSession, text: string) => new Promise<void>((resolve) => session.term.write(text, resolve))

export async function runLayoutTests(test: (name: string, fn: () => void | Promise<void>) => Promise<void>) {
  const host = document.getElementById('terminal-host')!
  const session = new TerminalSession()
  await session.start()
  host.append(session.host)
  session.show()
  await settle()
  const originalFont = session.getFontSize()
  const originalZoom = session.getZoom()
  session.setZoom(1)
  session.setFontSize(13)
  await settle()
  try {
    await test('Windows terminals retain scrollback when ConPTY grows and repaints its viewport', async () => {
      assert(session.term.options.windowsPty?.backend === 'conpty', 'PTY compatibility metadata was not applied')
      session.term.resize(80, 12)
      await write(session, Array.from({ length: 40 }, (_, i) => `conpty ${i}\r\n`).join(''))
      const base = session.term.buffer.active.baseY
      session.term.resize(80, 20)
      assert(session.term.buffer.active.baseY === base, 'growing rows pulled history into the ConPTY repaint area')
      await write(session, '\x1b[H\x1b[2Jnew viewport')
      assert(session.term.buffer.active.getLine(base - 1)!.translateToString(true).startsWith('conpty'), 'ConPTY repaint replaced historical output')
      session.term.reset()
      session.setFontSize(13)
      await settle()
    })
    await write(session, Array.from({ length: 350 }, (_, i) => `history ${i}\r\n`).join(''))
    await settle()
    await test('font changes preserve history position without jumping to either end', async () => {
      session.term.scrollToLine(120)
      await settle()
      const first = session.term.buffer.active.getLine(session.term.buffer.active.viewportY)!.translateToString(true)
      for (const size of [18, 25, 11, 16, 13]) {
        session.setFontSize(size)
        await settle()
        const buffer = session.term.buffer.active
        assert(buffer.getLine(buffer.viewportY)!.translateToString(true) === first, `font ${size} moved history to ${buffer.viewportY}: ${buffer.getLine(buffer.viewportY)!.translateToString(true)}`)
      }
    })
    await test('hidden sessions never resize their PTY to an invisible viewport', async () => {
      const rows = session.term.rows
      const cols = session.term.cols
      session.hide()
      session.setFontSize(20)
      await settle()
      assert(session.term.rows === rows && session.term.cols === cols, `hidden terminal resized to ${session.term.cols}x${session.term.rows}`)
      session.show()
      await settle()
    })
    session.show()
    session.setFontSize(13)
    await settle()
    await test('resizing the draft reserves space for every terminal row and keeps the status bar visible', async () => {
      session.enableInputEditor()
      await settle()
      const editor = document.querySelector<HTMLTextAreaElement>('.input-editor:not([hidden]) textarea')!
      for (const height of [140, 220, 76]) {
        editor.style.height = `${height}px`
        await settle()
        const screen = session.host.querySelector<HTMLElement>('.xterm-screen')!.getBoundingClientRect()
        const draft = editor.closest('.input-editor')!.getBoundingClientRect()
        const status = document.getElementById('statusbar')!.getBoundingClientRect()
        assert(screen.bottom <= draft.top, `terminal bottom ${screen.bottom} overlaps draft top ${draft.top}`)
        assert(status.bottom <= innerHeight, 'status bar was pushed below the window')
        assert(session.term.rows === session.fit.proposeDimensions()?.rows, 'terminal rows did not follow the resized draft')
      }
    })
    await test('resizing the viewport preserves a historical line while the terminal is not following output', async () => {
      session.term.scrollToLine(100)
      await settle()
      const first = session.term.buffer.active.getLine(session.term.buffer.active.viewportY)!.translateToString(true)
      for (const height of [280, 400, 320]) {
        host.style.flex = 'none'
        host.style.height = `${height}px`
        await settle()
        const buffer = session.term.buffer.active
        assert(buffer.getLine(buffer.viewportY)!.translateToString(true) === first, 'resizing moved the history being read')
        assert(session.term.rows === session.fit.proposeDimensions()?.rows, 'terminal rows are stale after resize')
      }
    })
    host.style.flex = ''
    host.style.height = ''
    await settle()
    await test('rapid font changes fit once per frame and keep the latest prompt visible', async () => {
      session.term.scrollToBottom()
      await settle()
      let resizes = 0
      const listener = session.term.onResize(() => resizes++)
      try {
        for (const size of [14, 17, 22, 24, 18]) session.setFontSize(size)
        await settle()
        assert(resizes === 1, `slider triggered ${resizes} terminal resizes in one frame`)
        assert(session.term.buffer.active.viewportY === session.term.buffer.active.baseY, 'latest output is no longer visible')
        const screen = session.host.querySelector<HTMLElement>('.xterm-screen')!.getBoundingClientRect()
        assert(screen.bottom <= session.host.getBoundingClientRect().bottom, 'final font size clips the bottom rows')
      } finally { listener.dispose() }
    })
    await test('alternate-screen applications resize without restoring an old normal-buffer position', async () => {
      await write(session, '\x1b[?1049h')
      session.setFontSize(15)
      await settle()
      assert(session.term.buffer.active.type === 'alternate' && session.term.buffer.active.viewportY === 0, 'layout scrolled the alternate screen')
      await write(session, '\x1b[?1049l')
      await settle()
    })
    await test('wrapped history follows its original line when the viewport width changes', async () => {
      await write(session, Array.from({ length: 80 }, (_, i) => `wrapped ${i} ${'detail '.repeat(35)}\r\n`).join(''))
      let line = session.term.buffer.active.baseY - 80
      while (line > 0 && session.term.buffer.active.getLine(line)?.isWrapped) line--
      session.term.scrollToLine(line)
      await settle()
      const first = session.term.buffer.active.getLine(session.term.buffer.active.viewportY)!.translateToString(true).slice(0, 20)
      try {
        for (const inset of [180, 40, 16]) {
          session.host.style.right = `${inset}px`
          await settle()
          const buffer = session.term.buffer.active
          assert(buffer.getLine(buffer.viewportY)!.translateToString(true).startsWith(first), `width reflow lost ${first}: ${buffer.getLine(buffer.viewportY)!.translateToString(true)}`)
          assert(session.term.cols === session.fit.proposeDimensions()?.cols, 'terminal columns are stale')
        }
      } finally { session.host.style.right = '' }
    })
  } finally {
    session.setFontSize(originalFont)
    session.setZoom(originalZoom)
    session.dispose()
    host.style.flex = ''
    host.style.height = ''
    host.replaceChildren()
  }
}
