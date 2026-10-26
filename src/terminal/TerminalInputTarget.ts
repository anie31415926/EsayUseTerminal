import type { Terminal } from '@xterm/xterm'

/** Tracks application capabilities separately from shell identity and input UI. */
export class TerminalInputTarget {
  private app = ''
  private disposables: { dispose(): void }[]

  constructor(private term: Terminal) {
    this.disposables = [
      term.parser.registerOscHandler(7501, (data) => {
        const fields = new Map(data.split(':').map((part) => part.split('=', 2) as [string, string]))
        this.app = fields.get('app') ?? ''
        return false
      }),
      term.onWriteParsed(() => { if (!term.modes.bracketedPasteMode) this.app = '' })
    ]
  }

  supportsImages() { return this.app === 'codex' && this.term.modes.bracketedPasteMode }
  dispose() { this.disposables.forEach((item) => item.dispose()) }
}
