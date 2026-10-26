import { NativeDraftEditor } from '../src/ui/NativeDraftEditor'
import { shortcuts } from '../src/shortcuts'

type Test = (name: string, run: () => void | Promise<void>) => Promise<void>
const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message) }

export async function runNativeDraftTests(test: Test) {
  const sent: { id: string; text: string | null }[] = []
  let fail = false
  let focused = 0
  const editor = new NativeDraftEditor(async (id, text) => {
    if (fail) throw new Error('编辑暂时无法完成')
    sent.push({ id, text })
  }, () => { focused++ })
  const background = new NativeDraftEditor(async () => { throw new Error('Wrong editor') }, () => {})
  const detach = shortcuts.attach(window)
  const input = () => document.querySelector<HTMLTextAreaElement>('.native-draft-editor[open] textarea')!
  const key = (code: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...options })
    input().dispatchEvent(event)
    return event
  }
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  try {
    await test('native draft editing selects the whole multiline input and confirms once without a PTY submit', async () => {
      const text = '第一行 😀\n第二行 ' + 'long text '.repeat(100)
      editor.selectNext()
      editor.open({ id: 'first', text }, true)
      assert(input().value === text && input().selectionStart === 0 && input().selectionEnd === text.length, 'native draft was truncated or not selected')
      document.execCommand('insertText', false, '替换后的内容')
      key('Enter'); key('Enter')
      await settle()
      assert(sent.length === 1 && sent[0].id === 'first' && sent[0].text === '替换后的内容', 'confirmation duplicated or targeted the wrong draft')
      assert(!input() && focused === 1, 'confirmation did not close and restore focus')
    })
    await test('native draft cancellation keeps the original application text and supports IME and multiline editing', async () => {
      editor.open({ id: 'cancel', text: '原稿' }, true)
      input().value = '未确认修改'
      assert(!key('Enter', { shiftKey: true }).defaultPrevented, 'Shift+Enter was consumed')
      assert(!key('Enter', { isComposing: true }).defaultPrevented, 'IME confirmation closed the editor')
      key('Escape')
      await settle()
      assert(sent.at(-1)!.id === 'cancel' && sent.at(-1)!.text === null, 'cancellation overwrote the original draft')
    })
    await test('failed native edits keep the draft editable and inactive sessions wait until shown', async () => {
      editor.open({ id: 'failed', text: '保留草稿' }, false)
      assert(!input(), 'inactive session opened a modal over the active terminal')
      editor.show(true)
      fail = true
      key('Enter'); await settle()
      assert(input().value === '保留草稿' && !input().readOnly, 'failed confirmation lost or locked the draft')
      assert(document.querySelector('.native-draft-editor[open] [role="status"]')!.textContent!.includes('无法完成'), 'edit failure had no feedback')
      fail = false
      key('KeyA', { ctrlKey: true })
      assert(input().selectionStart === 0 && input().selectionEnd === 4, 'Ctrl+A did not reselect the native draft')
      editor.closeRequest('other-request')
      assert(!!input(), 'foreign close event closed the draft')
      editor.closeRequest('failed')
      assert(!input(), 'closing the matching request retained its modal')
    })
    await test('disposing a native draft editor cancels the outstanding request and releases scoped shortcuts', async () => {
      editor.open({ id: 'dispose', text: '未发送' }, true)
      editor.dispose()
      await settle()
      assert(sent.at(-1)!.id === 'dispose' && sent.at(-1)!.text === null, 'disposal did not cancel the application editor')
      const event = new KeyboardEvent('keydown', { code: 'Enter', cancelable: true })
      assert(!shortcuts.handle(event), 'disposed editor retained Enter routing')
    })
  } finally { editor.dispose(); background.dispose(); detach() }
}
