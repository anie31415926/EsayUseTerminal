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
    await test('switching from the draft to terminal input keeps the latest output visible', async () => {
      for (let i = 0; i < 3; i++) {
        session.enableInputEditor()
        await settle()
        session.term.scrollToBottom()
        await settle()
        const button = document.querySelector<HTMLButtonElement>('.input-editor:not([hidden]) .input-editor-terminal')!
        button.focus()
        button.click()
        await settle()
        const buffer = session.term.buffer.active
        assert(buffer.viewportY === buffer.baseY, `input switch moved latest output to ${buffer.viewportY}/${buffer.baseY}`)
        assert(session.hasFocus(), 'input switch did not focus the terminal')
      }
    })
    await test('input mode switches preserve the historical line being read and retain the draft', async () => {
      session.enableInputEditor()
      await settle()
      const draft = document.querySelector<HTMLTextAreaElement>('.input-editor:not([hidden]) textarea')!
      draft.value = 'unsent draft'
      for (let i = 0; i < 3; i++) {
        session.term.scrollToLine(100)
        await settle()
        const buffer = session.term.buffer.active
        const first = buffer.getLine(buffer.viewportY)!.translateToString(true)
        session.toggleInputEditor()
        await settle()
        assert(buffer.getLine(buffer.viewportY)!.translateToString(true) === first, `hiding draft moved history to ${buffer.viewportY}`)
        session.toggleInputEditor()
        await settle()
        assert(buffer.getLine(buffer.viewportY)!.translateToString(true) === first, `showing draft moved history to ${buffer.viewportY}`)
        assert(draft.value === 'unsent draft' && document.activeElement === draft, 'mode switch lost the draft or input focus')
      }
    })
    await test('input mode switches restore history after a native focus scroll during the layout change', async () => {
      session.enableInputEditor()
      await settle()
      session.term.scrollToLine(100)
      await settle()
      const buffer = session.term.buffer.active
      const first = buffer.getLine(buffer.viewportY)!.translateToString(true)
      let focusScroll = false
      const focus = session.term.focus
      session.term.focus = () => { focus.call(session.term); focusScroll = true; session.term.scrollToTop() }
      try {
        document.querySelector<HTMLButtonElement>('.input-editor:not([hidden]) .input-editor-terminal')!.click()
        await settle()
        assert(focusScroll, 'focus scroll scenario was not exercised')
        assert(buffer.getLine(buffer.viewportY)!.translateToString(true) === first, `focus scroll was captured as the new history position ${buffer.viewportY}`)
      } finally {
        session.term.focus = focus
        session.enableInputEditor()
        await settle()
      }
    })
    await test('switching input at the bottom restores follow-output even if focus resets the viewport', async () => {
      session.enableInputEditor()
      await settle()
      session.term.scrollToBottom()
      await settle()
      const focus = session.term.focus
      session.term.focus = () => { focus.call(session.term); session.term.scrollToTop() }
      try {
        session.toggleInputEditor()
        await settle()
        const buffer = session.term.buffer.active
        assert(buffer.baseY > 0 && buffer.viewportY === buffer.baseY, `switching input lost bottom position: ${buffer.viewportY}/${buffer.baseY}`)
        await write(session, 'latest output after input switch\r\n')
        await settle()
        assert(buffer.viewportY === buffer.baseY, 'input switch stopped following new output')
      } finally {
        session.term.focus = focus
        session.enableInputEditor()
        await settle()
      }
    })
    await test('sending from the application input restores the latest output position', async () => {
      session.term.scrollToBottom()
      session.enableInputEditor()
      await settle()
      const draft = document.querySelector<HTMLTextAreaElement>('.input-editor:not([hidden]) textarea')!
      draft.value = 'submitted prompt'
      draft.dispatchEvent(new Event('input', { bubbles: true }))
      draft.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 300))
      await write(session, Array.from({ length: 80 }, (_, i) => `submitted output ${i}\r\n`).join(''))
      await settle()
      const buffer = session.term.buffer.active
      assert(buffer.viewportY === buffer.baseY, `application submit left latest output at ${buffer.viewportY}/${buffer.baseY}`)
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
