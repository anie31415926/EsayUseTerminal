import type { Terminal } from '@xterm/xterm'
import { CODEX_EDITOR_CAPABILITY_OSC } from '../shared/codex'

/** Tracks application capabilities separately from shell identity and input UI. */
export class TerminalInputTarget {
  private app = ''
  private editor = false
  private disposables: { dispose(): void }[]

  constructor(private term: Terminal) {
    this.disposables = [
      term.parser.registerOscHandler(CODEX_EDITOR_CAPABILITY_OSC, (data) => { this.editor = data === 'editor=spark'; return true }),
      term.parser.registerOscHandler(7501, (data) => {
        const fields = new Map(data.split(':').map((part) => part.split('=', 2) as [string, string]))
        this.app = fields.get('app') ?? ''
        return false
      }),
      term.onWriteParsed(() => { if (!term.modes.bracketedPasteMode) this.app = '' })
    ]
  }

  supportsImages() { return this.app === 'codex' && this.term.modes.bracketedPasteMode }
  supportsDraftEditor() { return this.app === 'codex' && this.editor }
  dispose() { this.disposables.forEach((item) => item.dispose()) }
}
