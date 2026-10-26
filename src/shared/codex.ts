/** Shared by shell integration and content packs; contains no renderer or Node APIs. */
export const CODEX_EDITOR_CAPABILITY_OSC = 7502

export const CODEX_SCROLLBACK_ARGS = [
  '--no-alt-screen',
  '-c', 'tui.alternate_screen=never',
  '-c', 'tui.fullscreen_transcript=false'
] as const
