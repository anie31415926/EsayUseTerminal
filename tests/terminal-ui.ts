import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { ScrollBar } from '../src/ui/ScrollBar'
import type { TerminalSession } from '../src/terminal/TerminalSession'
import { BUILTIN_PACKS } from '../src/presets/builtin'
import { runPackTests } from './pack-launch'
import { runShortcutTests } from './shortcuts'
import { listShortcuts } from '../src/shortcuts/bindings'
import { bus } from '../src/core/EventBus'
import { showMenu } from '../src/ui/ContextMenu'
import { runLayoutTests } from './terminal-layout'

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const settle = async () => { await frame(); await frame() }
const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message) }
const write = (term: Terminal, text: string) => new Promise<void>((resolve) => term.write(text, resolve))
const output = (count: number) => Array.from({ length: count }, (_, i) => `line ${i}\r\n`).join('')

async function runRegressionTests() {
  const results: { name: string; ok: boolean; error?: string }[] = []
  const test = async (name: string, fn: () => void | Promise<void>) => {
    try { await fn(); results.push({ name, ok: true }) }
    catch (error) { results.push({ name, ok: false, error: String(error) }) }
  }
  const host = document.getElementById('terminal-host')!
  await runShortcutTests(test)
  const makeTerm = () => {
    const el = document.createElement('div')
    el.className = 'session-host'
    host.appendChild(el)
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
    term.open(el)
    return term
  }
  const term = makeTerm()
  const session = { ptyId: 'first', term } as TerminalSession
  const bar = new ScrollBar(host)
  bar.bind(session)
  const track = host.querySelector<HTMLElement>('.scrollbar-track')!
  const thumb = track.querySelector<HTMLElement>('.scrollbar-thumb')!
  await test('output grows history and shrinks the thumb without wheel input', async () => {
    await write(term, output(200)); await settle()
    assert(thumb.clientHeight < track.clientHeight / 2, `thumb=${thumb.clientHeight}, track=${track.clientHeight}`)
  })
  await test('history keeps updating while viewport stays at the top', async () => {
    term.scrollToTop(); await settle()
    const previous = thumb.clientHeight
    await write(term, output(300)); await settle()
    assert(thumb.clientHeight < previous, 'thumb did not shrink while reading history')
    assert(term.buffer.active.viewportY === 0, 'output moved the viewport')
  })
  await test('alternate screen resets thumb and normal screen restores it', async () => {
    try {
      await write(term, '\x1b[?1049h'); await settle()
      assert(thumb.clientHeight === track.clientHeight, 'alternate screen retained stale thumb')
    } finally {
      await write(term, '\x1b[?1049l'); await settle()
    }
    assert(thumb.clientHeight < track.clientHeight, 'normal history was not restored')
  })
  await test('track click reaches oldest and newest history', async () => {
    const rect = track.getBoundingClientRect()
    for (const [y, expected] of [[rect.top, 0], [rect.bottom - 1, term.buffer.active.baseY]]) {
      track.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientY: y, bubbles: true }))
      window.dispatchEvent(new MouseEvent('mouseup'))
      await settle()
      assert(term.buffer.active.viewportY === expected, `viewport=${term.buffer.active.viewportY}, expected=${expected}`)
    }
  })
  await test('dragging thumb moves the viewport', async () => {
    term.scrollToTop(); await settle()
    const rect = thumb.getBoundingClientRect()
    thumb.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientY: rect.top + 2, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientY: rect.top + 100 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    await settle()
    assert(term.buffer.active.viewportY > 0, 'drag did not move terminal history')
  })
  await test('native viewport scrolling synchronizes the thumb', async () => {
    term.scrollToBottom(); await settle()
    const viewport = term.element!.querySelector<HTMLElement>('.xterm-viewport')!
    viewport.scrollTop = 0; await settle()
    assert(term.buffer.active.viewportY === 0, 'native viewport did not scroll')
    assert(Math.abs(thumb.getBoundingClientRect().top - track.getBoundingClientRect().top) < 1, 'native scroll left thumb at old position')
  })
  await test('switching session cancels an in-progress drag', async () => {
    const second = makeTerm()
    await write(second, output(200)); second.scrollToTop(); await settle()
    const rect = thumb.getBoundingClientRect()
    thumb.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientY: rect.top + 2, bubbles: true }))
    bar.bind({ ptyId: 'second', term: second } as TerminalSession)
    window.dispatchEvent(new MouseEvent('mousemove', { clientY: rect.top + 100 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    await settle()
    assert(second.buffer.active.viewportY === 0, 'old drag scrolled the newly active session')
    bar.bind(session)
    second.dispose()
  })
  await test('host resize updates thumb even when terminal row count is unchanged', async () => {
    try {
      host.style.flex = 'none'; host.style.height = '360px'; await settle()
      term.scrollToBottom(); await settle()
      host.style.height = '500px'; await settle()
      const expectedHeight = Math.max(24, Math.round(term.rows / (term.buffer.active.baseY + term.rows) * track.clientHeight))
      const expectedTop = Math.round(term.buffer.active.viewportY / term.buffer.active.baseY * (track.clientHeight - expectedHeight))
      assert(thumb.clientHeight === expectedHeight, `thumb height=${thumb.clientHeight}, expected=${expectedHeight}`)
      assert(Math.abs(thumb.getBoundingClientRect().top - track.getBoundingClientRect().top - expectedTop) < 1, 'thumb position does not match resized track')
    } finally { host.style.flex = ''; host.style.height = '' }
  })
  await test('clear resets thumb to full track height', async () => {
    term.clear(); await settle()
    assert(thumb.clientHeight === track.clientHeight, 'clear retained stale history geometry')
  })
  await test('unbinding removes the thumb and cancels drag state', async () => {
    bar.unbind(); await settle()
    assert(thumb.getBoundingClientRect().height === 0, 'CSS minimum height left a ghost thumb')
    assert(document.body.style.userSelect !== 'none', 'drag left selection disabled')
  })
  term.dispose()
  host.replaceChildren()

  let spawnCount = 0
  let newWindowCount = 0
  let pickedFolder: string | null = null
  let failSpawn = false
  const spawnOptions: { cwd?: string }[] = []
  const dataHandlers = new Map<string, (data: string) => void>()
  const writes: { id: string; text: string }[] = []
  Object.assign(window, { spark: {
    spawn: async (opts: { cwd?: string }) => {
      if (failSpawn) throw new Error('spawn denied')
      spawnOptions.push(opts)
      return { id: `mock-${++spawnCount}`, shellPath: 'test.exe', candidates: ['test.exe'], windowsPty: { backend: 'conpty', buildNumber: 26100 } }
    },
    pickFolder: async () => pickedFolder,
    resolveCwd: async (cwd: string) => {
      if (cwd === 'invalid') throw new Error("Error invoking remote method 'workspace:resolve': Error: 工作区目录不存在")
      return cwd || 'C:\\Users\\Test'
    },
    write: (id: string, text: string) => { writes.push({ id, text }) }, resize: () => {}, kill: () => {},
    detectShells: async () => ['test.exe'], listSessions: async () => [], getAutoPack: async () => '',
    onData: (id: string, callback: (data: string) => void) => { dataHandlers.set(id, callback); return () => dataHandlers.delete(id) },
    onExit: () => () => {},
    window: { setBg: async () => {}, newWindow: async () => { newWindowCount++ } }
  } })
  await runLayoutTests(test)
  spawnCount = 0
  spawnOptions.length = 0
  writes.length = 0
  await import('../src/main')
  await settle()
  const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!
  assert(!!textarea, 'main app did not create a terminal')
  const press = (code: string, options: KeyboardEventInit = {}) => {
    textarea.focus()
    textarea.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...options }))
  }
  await test('new-window button and centralized Ctrl+Shift+N request independent windows', () => {
    const start = writes.length
    document.getElementById('btn-new-window')!.click()
    press('KeyN', { ctrlKey: true, shiftKey: true })
    assert(newWindowCount === 2, 'new-window controls did not reach the window service exactly once')
    assert(writes.length === start, 'new-window shortcut leaked into the terminal')
  })
  await test('terminal pointer is an arrow and preserves link and column-selection cursors', () => {
    const element = host.querySelector<HTMLElement>('.xterm')!
    assert(getComputedStyle(element).cursor === 'default', 'terminal retained the I-beam')
    try {
      element.classList.add('xterm-cursor-pointer')
      assert(getComputedStyle(element).cursor === 'pointer', 'link cursor was overridden')
      element.classList.remove('xterm-cursor-pointer')
      element.classList.add('column-select', 'focus')
      assert(getComputedStyle(element).cursor === 'crosshair', 'column-selection cursor was overridden')
    } finally { element.classList.remove('xterm-cursor-pointer', 'column-select') }
  })
  await test('Ctrl+Z and redo aliases reach only the focused terminal once', () => {
    const start = writes.length
    press('KeyZ', { ctrlKey: true })
    press('KeyZ', { ctrlKey: true, shiftKey: true })
    press('KeyY', { ctrlKey: true })
    assert(writes.slice(start).map((item) => item.text).join('') === '\x1a\x19\x19', 'undo/redo was missing, doubled, or sent the wrong control code')
    const input = document.querySelector<HTMLInputElement>('#workspace-bar input')!
    input.focus()
    const event = new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    assert(!event.defaultPrevented && writes.length === start + 3, 'workspace undo leaked into PTY')
    textarea.focus()
  })
  await test('Ctrl+F toggles once without leaking control input to PTY', () => {
    const start = writes.length
    press('KeyF', { ctrlKey: true })
    const find = document.querySelector<HTMLElement>('.findbar')!
    assert(find.style.display !== 'none', 'search toggled twice or did not open')
    const input = find.querySelector('input')!
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true }))
    assert(find.style.display === 'none', 'scoped Escape did not close search')
    assert(writes.length === start, 'search shortcuts leaked into PTY')
  })
  await test('F2 renames once and its scoped keys are cleaned up after confirmation', async () => {
    const start = writes.length
    localStorage.setItem('spark.tabTitles', JSON.stringify({ ...JSON.parse(localStorage.getItem('spark.tabTitles') ?? '{}'), 'another-window': 'Another window title' }))
    for (const name of ['renamed one', 'renamed two']) {
      press('F2')
      const input = document.querySelector<HTMLInputElement>('.tab-rename')!
      assert(!!input, 'F2 did not open rename')
      input.value = name
      input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true }))
      await settle()
      assert(document.querySelector('.tab.active .tab-title')!.textContent === name, 'rename did not commit')
    }
    assert(writes.length === start, 'F2 or rename Enter leaked into PTY')
    assert(JSON.parse(localStorage.getItem('spark.tabTitles')!)['another-window'] === 'Another window title', 'renaming overwrote another window title')
  })
  await test('F1 opens the full shortcut catalog with every alternative key and scope', () => {
    const start = writes.length
    press('F1')
    const panel = document.querySelector<HTMLDialogElement>('.shortcut-panel')!
    assert(panel.open, 'F1 did not open shortcut help')
    assert(document.activeElement === panel.querySelector('input'), 'shortcut search did not receive focus')
    assert(panel.querySelectorAll('tr[data-command]').length === listShortcuts().length, 'shortcut catalog is incomplete')
    for (const item of listShortcuts()) {
      const row = panel.querySelector<HTMLElement>(`tr[data-command="${item.command}"]`)!
      assert(!!row && row.textContent!.includes(item.scope), `missing scope for ${item.command}`)
      assert(JSON.stringify([...row.querySelectorAll('kbd')].map((key) => key.textContent)) === JSON.stringify(item.keys), `missing alternative keys for ${item.command}`)
    }
    assert(writes.length === start, 'F1 leaked into PTY')
  })
  await test('shortcut search matches names, key combinations and scopes with an empty state', () => {
    const panel = document.querySelector<HTMLDialogElement>('.shortcut-panel')!
    const filter = panel.querySelector<HTMLInputElement>('input')!
    for (const query of ['重做', 'ctrl + shift + z', '独立输入框', 'Shift+Enter']) {
      filter.value = query
      filter.dispatchEvent(new Event('input'))
      assert(panel.querySelectorAll('tr[data-command]').length > 0, `search found no shortcut for ${query}`)
      assert(panel.querySelector<HTMLElement>('.shortcut-panel-empty')!.hidden, 'empty state remained visible with matches')
    }
    filter.value = 'no-matching-command'
    filter.dispatchEvent(new Event('input'))
    assert(panel.querySelectorAll('tr[data-command]').length === 0, 'search did not filter rows')
    assert(!panel.querySelector<HTMLElement>('.shortcut-panel-empty')!.hidden, 'empty search gave no feedback')
  })
  await test('shortcut modal protects underlying tabs and Escape restores terminal focus', () => {
    const panel = document.querySelector<HTMLDialogElement>('.shortcut-panel')!
    const filter = panel.querySelector<HTMLInputElement>('input')!
    const start = writes.length
    const tabs = document.querySelectorAll('.tab').length
    for (const code of ['KeyT', 'KeyW']) {
      filter.dispatchEvent(new KeyboardEvent('keydown', { code, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    }
    assert(document.querySelectorAll('.tab').length === tabs && writes.length === start, 'modal shortcut changed an underlying session')
    filter.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true }))
    assert(!panel.open && document.activeElement === textarea, 'closing help did not restore terminal focus')
  })
  await test('status bar and settings both open shortcut help, which also toggles with F1', () => {
    const panel = document.querySelector<HTMLDialogElement>('.shortcut-panel')!
    document.getElementById('btn-shortcuts')!.click()
    assert(panel.open, 'status bar shortcut entry did not open help')
    panel.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { code: 'F1', bubbles: true, cancelable: true }))
    assert(!panel.open, 'F1 did not close help')
    document.getElementById('btn-settings')!.click()
    document.querySelector<HTMLButtonElement>('.settings-shortcuts')!.click()
    assert(panel.open && document.querySelector<HTMLElement>('.settings-panel')!.style.display === 'none', 'settings did not open shortcut help and close itself')
    panel.querySelector<HTMLButtonElement>('.shortcut-panel-close')!.click()
    assert(!panel.open, 'close button did not close help')
    textarea.focus()
  })
  await test('Ctrl+number beyond existing tabs does not throw', async () => {
    let caught = ''
    const onError = (event: ErrorEvent) => { caught = event.message; event.preventDefault() }
    window.addEventListener('error', onError)
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit8', ctrlKey: true, bubbles: true, cancelable: true }))
      assert(!caught, caught)
      assert(document.querySelectorAll('.tab.active').length === 1, 'lost the active tab')
    } finally { window.removeEventListener('error', onError) }
  })
  await test('Ctrl+wheel zoom is consumed before terminal wheel handlers', async () => {
    let reachedTerminal = false
    const onWheel = () => { reachedTerminal = true }
    textarea.addEventListener('wheel', onWheel)
    const zoomBefore = document.getElementById('status-zoom')!.textContent
    try {
      textarea.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true }))
      assert(!reachedTerminal, 'Ctrl+wheel reached terminal scrolling handlers')
      assert(document.getElementById('status-zoom')!.textContent !== zoomBefore, 'font zoom did not change')
    } finally { textarea.removeEventListener('wheel', onWheel) }
  })
  await test('fitted terminal stays inside visible bounds and clear of scrollbar', async () => {
    await settle()
    const screen = host.querySelector<HTMLElement>('.xterm-screen')!.getBoundingClientRect()
    const bounds = host.getBoundingClientRect()
    const barRect = host.querySelector<HTMLElement>('.scrollbar-track')!.getBoundingClientRect()
    assert(screen.bottom <= bounds.bottom, `terminal bottom ${screen.bottom} exceeds host ${bounds.bottom}`)
    assert(screen.right <= barRect.left, `terminal right ${screen.right} overlaps scrollbar ${barRect.left}`)
  })
  await test('Codex content pack preserves terminal history', () => {
    assert(BUILTIN_PACKS.filter((pack) => pack.launchCommand?.startsWith('codex ')).every((pack) => pack.launchCommand!.includes('--no-alt-screen')), 'Codex pack enables alternate screen without scrollback')
    assert(BUILTIN_PACKS.filter((pack) => pack.launchCommand?.startsWith('codex ')).every((pack) => pack.launchCommand!.includes('tui.alternate_screen=never') && pack.launchCommand!.includes('tui.fullscreen_transcript=false')), 'Codex pack allows resumed threads to take over transcript scrolling')
  })
  await test('selecting a content pack and clicking launch starts and submits its full prompt', async () => {
    const waitUntil = async (check: () => boolean) => {
      const deadline = Date.now() + 3000
      while (!check()) {
        assert(Date.now() < deadline, 'content pack button flow timed out')
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
      }
    }
    const pack = BUILTIN_PACKS[0]
    const select = document.getElementById('pack-select') as HTMLSelectElement
    select.value = pack.id
    document.getElementById('pack-launch')!.click()
    await waitUntil(() => dataHandlers.has('mock-2'))
    const emit = dataHandlers.get('mock-2')!
    emit('PS C:\\work> ')
    await waitUntil(() => writes.filter((item) => item.id === 'mock-2').length >= 2)
    emit('\r\n\x1b[?2004h› ')
    await waitUntil(() => writes.filter((item) => item.id === 'mock-2').length >= 4)
    const sent = writes.filter((item) => item.id === 'mock-2').map((item) => item.text)
    assert(spawnCount === 2, 'one click created multiple terminals')
    assert(sent[0] === pack.launchCommand && sent[1] === '\r', 'launch command was not executed')
    assert(sent[2] === '\x1b[200~' + pack.injectText!.replace(/\r?\n/g, '\r') + '\x1b[201~', 'full prompt was not pasted in one operation')
    assert(sent[3] === '\r', 'button left content in the input box instead of submitting')
  })
  const draft = () => document.querySelector<HTMLTextAreaElement>('.input-editor:not([hidden]) textarea')!
  const draftKey = (code: string, options: KeyboardEventInit = {}) => {
    draft().dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...options }))
  }
  await test('Codex local draft supports Chinese text undo/redo before any PTY write', () => {
    const editor = draft()
    assert(!!editor && document.activeElement === editor, 'Codex pack did not focus its draft editor')
    const start = writes.length
    document.execCommand('insertText', false, '检查这个项目')
    assert(editor.value === '检查这个项目', 'browser did not insert draft text')
    draftKey('KeyZ', { ctrlKey: true })
    assert(editor.value === '', 'Ctrl+Z did not undo the local draft')
    draftKey('KeyY', { ctrlKey: true })
    assert(editor.value === '检查这个项目', 'Ctrl+Y did not redo the local draft')
    draftKey('KeyZ', { ctrlKey: true })
    draftKey('KeyZ', { ctrlKey: true, shiftKey: true })
    assert(editor.value === '检查这个项目', 'Ctrl+Shift+Z did not redo the local draft')
    assert(writes.length === start, 'unsent draft edits leaked to Codex')
  })
  await test('draft Enter submits once and cannot undo already-sent text', async () => {
    const editor = draft()
    const start = writes.length
    draftKey('Enter')
    draftKey('Enter')
    assert(editor.readOnly, 'draft remained editable during submission')
    await new Promise<void>((resolve) => setTimeout(resolve, 300))
    assert(writes.length === start + 2, 'draft Enter submitted twice or did not submit')
    assert(writes[start].text === '\x1b[200~检查这个项目\x1b[201~' && writes[start + 1].text === '\r', 'draft was not pasted and submitted separately')
    assert(editor.value === '' && !editor.readOnly, 'sent draft was not reset')
    draftKey('KeyZ', { ctrlKey: true })
    assert(editor.value === '', 'undo restored an already-sent draft')
  })
  await test('draft newline and IME confirmation are not consumed as submit shortcuts', () => {
    const start = writes.length
    for (const options of [{ shiftKey: true }, { isComposing: true }]) {
      const event = new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true, ...options })
      draft().dispatchEvent(event)
      assert(!event.defaultPrevented, 'newline or IME confirmation was intercepted')
    }
    assert(writes.length === start, 'newline or composition sent input to the application')
  })
  await test('multiline draft is retained when the application stops accepting bracketed paste', async () => {
    dataHandlers.get('mock-2')!('\x1b[?2004l')
    await settle()
    const editor = draft()
    editor.value = '第一行\n第二行'
    const start = writes.length
    draftKey('Enter')
    await settle()
    assert(writes.length === start, 'unbracketed multiline draft was sent as multiple commands')
    assert(editor.value === '第一行\n第二行' && !editor.readOnly, 'refused draft was lost or left locked')
    assert(!document.querySelector<HTMLElement>('.input-editor-error')!.hidden, 'failed submit gave no feedback')
    dataHandlers.get('mock-2')!('\x1b[?2004h')
    await settle()
    editor.value = ''
  })
  await test('drafts survive tab switches and local editing never targets another PTY', async () => {
    document.execCommand('insertText', false, '未发送草稿')
    draftKey('KeyT', { ctrlKey: true, shiftKey: true })
    await settle()
    assert(!draft(), 'background draft remained visible')
    const activeText = host.querySelector<HTMLTextAreaElement>('.session-host:not([style*="display: none"]) textarea')!
    activeText.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', ctrlKey: true, bubbles: true, cancelable: true }))
    await settle()
    assert(draft()?.value === '未发送草稿' && document.activeElement === draft(), 'switching tabs lost the draft or its focus')
  })
  await test('closing a draft session cancels its pending submit and removes scoped shortcuts', async () => {
    const start = writes.length
    draftKey('Enter')
    draftKey('KeyW', { ctrlKey: true, shiftKey: true })
    await new Promise<void>((resolve) => setTimeout(resolve, 300))
    assert(!document.querySelector('.input-editor'), 'closed session retained its editor')
    assert(writes.length === start + 1 && writes[start].text.startsWith('\x1b[200~'), 'closing a draft sent a deferred Enter')
  })
  await test('overflowing tabs keep the new active tab and window controls visible', async () => {
    for (let i = 0; i < 10; i++) document.getElementById('btn-new-tab')!.click()
    await settle()
    const tabs = document.getElementById('tabbar')!
    const bounds = tabs.getBoundingClientRect()
    const active = tabs.querySelector<HTMLElement>('.tab.active')!.getBoundingClientRect()
    assert(tabs.scrollWidth > tabs.clientWidth && tabs.scrollLeft > 0, 'tabs did not overflow and reveal the newest tab')
    assert(active.left >= bounds.left - 1 && active.right <= bounds.right + 1, 'new active tab is clipped')
    for (const id of ['btn-new-tab', 'btn-new-window', 'win-close']) {
      const rect = document.getElementById(id)!.getBoundingClientRect()
      assert(rect.left >= 0 && rect.right <= innerWidth, `${id} was pushed outside the window`)
    }
  })
  await test('tab wheel and navigation buttons reach offscreen tabs without changing the active session', async () => {
    const tabs = document.getElementById('tabbar')!
    const activeId = tabs.querySelector<HTMLElement>('.tab.active')!.dataset.id!
    tabs.scrollLeft = 0
    tabs.dispatchEvent(new WheelEvent('wheel', { deltaY: 150, cancelable: true }))
    assert(tabs.scrollLeft > 0, 'vertical wheel did not scroll tabs horizontally')
    document.getElementById('btn-tab-next')!.click()
    const afterNext = tabs.scrollLeft
    document.getElementById('btn-tab-prev')!.click()
    assert(tabs.scrollLeft < afterNext, 'tab navigation arrows did not scroll')
    tabs.scrollLeft = 0
    bus.emit('session:title-changed', { id: activeId, title: 'Updated while browsing tabs' })
    await settle()
    assert(tabs.scrollLeft === 0, 'title update unexpectedly jumped back to the active tab')
    assert(tabs.querySelector<HTMLElement>('.tab.active')!.dataset.id === activeId, 'scrolling changed the active session')
  })
  await test('all-tabs menu selects hidden tabs and reveals keyboard-selected tabs', async () => {
    const tabs = document.getElementById('tabbar')!
    const first = tabs.querySelector<HTMLElement>('.tab')!.dataset.id!
    document.getElementById('btn-tab-list')!.click()
    const menu = document.querySelector<HTMLElement>('.context-menu')!
    assert(menu.querySelectorAll('button').length === tabs.querySelectorAll('.tab').length, 'all-tabs menu omitted hidden tabs')
    menu.querySelector<HTMLButtonElement>('button')!.click()
    await settle()
    assert(tabs.querySelector<HTMLElement>('.tab.active')!.dataset.id === first && tabs.scrollLeft === 0, 'menu did not activate and reveal the first tab')
    press('Digit9', { ctrlKey: true })
    await settle()
    const bounds = tabs.getBoundingClientRect()
    const active = tabs.querySelector<HTMLElement>('.tab.active')!.getBoundingClientRect()
    assert(tabs.scrollLeft > 0 && active.right <= bounds.right + 1, 'keyboard-selected last tab stayed offscreen')
    press('KeyA', { ctrlKey: true, shiftKey: true })
    assert(!!document.querySelector('.context-menu'), 'centralized all-tabs shortcut did not open the menu')
    document.querySelector<HTMLButtonElement>('.context-menu button')!.click()
    await settle()
  })
  await test('shrinking the tab strip keeps the active terminal visible', async () => {
    const strip = document.querySelector<HTMLElement>('.tab-strip')!
    document.querySelector<HTMLElement>('#tabbar .tab:last-child')!.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
    await settle()
    try {
      strip.style.maxWidth = '340px'
      await settle()
      const viewport = document.getElementById('tabbar')!.getBoundingClientRect()
      const active = document.querySelector<HTMLElement>('#tabbar .tab.active')!.getBoundingClientRect()
      assert(active.left >= viewport.left - 1 && active.right <= viewport.right + 1, 'resizing left the active tab outside the visible strip')
    } finally { strip.style.maxWidth = ''; await settle() }
  })
  await test('long tab menus scroll within the window and keep the last item selectable', () => {
    let selected = -1
    const close = showMenu(Array.from({ length: 80 }, (_, i) => ({ label: `Terminal ${i + 1}`, action: () => { selected = i } })), innerWidth - 20, 40)
    try {
      const menu = document.querySelector<HTMLElement>('.context-menu')!
      const rect = menu.getBoundingClientRect()
      assert(rect.top >= 0 && rect.bottom <= innerHeight && menu.scrollHeight > menu.clientHeight, 'long menu overflows the window instead of scrolling')
      menu.scrollTop = menu.scrollHeight
      const last = menu.querySelector<HTMLButtonElement>('button:last-child')!
      assert(last.getBoundingClientRect().bottom <= rect.bottom, 'last menu item cannot be scrolled into view')
      last.click()
      assert(Number(selected) === 79, 'last menu item could not be selected')
    } finally { close() }
  })
  await test('applying a workspace opens and activates a terminal there and preserves existing sessions', async () => {
    const before = spawnCount
    const existing = [...document.querySelectorAll<HTMLElement>('.tab')].map((tab) => tab.dataset.id)
    const input = document.querySelector<HTMLInputElement>('#workspace-bar input')!
    assert(input.value === '', 'default label was stored as an editable path')
    input.value = "C:\\workspace 中文's folder"
    document.querySelector<HTMLButtonElement>('[data-act="go"]')!.click()
    document.querySelector<HTMLButtonElement>('[data-act="go"]')!.click()
    await settle()
    assert(spawnCount === before + 1, 'apply did not create exactly one terminal')
    assert(spawnOptions.at(-1)?.cwd === input.value, 'actual terminal spawn ignored the selected workspace')
    assert(document.querySelector<HTMLElement>('.tab.active')!.dataset.id === `mock-${spawnCount}`, 'new workspace terminal was not activated')
    assert(existing.every((id) => !!document.querySelector(`.tab[data-id="${id}"]`)), 'workspace change closed an existing terminal')
    assert(localStorage.getItem('spark.cwd') === input.value, 'workspace was not persisted after success')
    document.getElementById('btn-new-tab')!.click()
    await settle()
    assert(spawnOptions.at(-1)?.cwd === input.value, 'later tabs did not inherit the workspace')
  })
  await test('invalid workspace reports an error without changing sessions or the saved directory', async () => {
    const before = spawnCount
    const saved = localStorage.getItem('spark.cwd')
    const active = document.querySelector<HTMLElement>('.tab.active')!.dataset.id
    const input = document.querySelector<HTMLInputElement>('#workspace-bar input')!
    input.value = 'invalid'
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true }))
    await settle()
    assert(!document.getElementById('workspace-error')!.hidden && input.getAttribute('aria-invalid') === 'true', 'invalid path failed silently')
    assert(document.getElementById('workspace-error')!.textContent === '工作区目录不存在', 'workspace error exposed IPC implementation details')
    assert(spawnCount === before && document.querySelector<HTMLElement>('.tab.active')!.dataset.id === active, 'invalid path changed the terminal')
    assert(localStorage.getItem('spark.cwd') === saved, 'invalid path replaced the saved workspace')
  })
  await test('folder selection applies immediately and cancellation has no effect', async () => {
    const before = spawnCount
    pickedFolder = 'C:\\picked folder'
    document.querySelector<HTMLButtonElement>('[data-act="browse"]')!.click()
    await settle()
    assert(spawnCount === before + 1 && spawnOptions.at(-1)?.cwd === pickedFolder, 'selected folder was only displayed without opening a terminal')
    assert(document.getElementById('workspace-error')!.hidden, 'successful retry retained stale error')
    pickedFolder = null
    document.querySelector<HTMLButtonElement>('[data-act="browse"]')!.click()
    await settle()
    assert(spawnCount === before + 1, 'cancelling folder selection created a terminal')
  })
  await test('workspace spawn failure preserves the saved directory and removes its loading tab', async () => {
    const saved = localStorage.getItem('spark.cwd')
    const count = document.querySelectorAll('.tab').length
    const active = document.querySelector<HTMLElement>('.tab.active')!.dataset.id
    const input = document.querySelector<HTMLInputElement>('#workspace-bar input')!
    input.value = 'C:\\denied'
    failSpawn = true
    try {
      document.querySelector<HTMLButtonElement>('[data-act="go"]')!.click()
      await settle()
      assert(localStorage.getItem('spark.cwd') === saved, 'failed spawn committed the workspace')
      assert(document.querySelectorAll('.tab').length === count && !document.querySelector('.tab.loading'), 'failed spawn left a ghost tab')
      assert(document.querySelector<HTMLElement>('.tab.active')!.dataset.id === active, 'failed spawn changed the active terminal')
      assert(!document.getElementById('workspace-error')!.hidden && !input.disabled, 'failed spawn did not report or recover')
    } finally { failSpawn = false }
  })
  return [...results, ...await runPackTests()]
}

Object.assign(window, { runRegressionTests })
