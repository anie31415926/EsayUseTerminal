import { CODEX_SCROLLBACK_ARGS, CODEX_EDITOR_CAPABILITY_OSC } from '../src/shared/codex'

const powershellOptions = CODEX_SCROLLBACK_ARGS.slice(1).map((arg) => `'${arg.replace(/'/g, "''")}'`).join(', ')

/** Keep Codex transcript ownership in the terminal, including resumed sessions. */
const codexIntegration = `
if (-not (Test-Path Function:\\codex) -and -not (Test-Path Alias:\\codex)) {
  function global:codex {
    $sparkCodexCommand = Get-Command codex -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $sparkCodexCommand) { Write-Error 'Codex is not installed or is not on PATH'; return }
    $sparkCodexOptions = @(${powershellOptions})
    if ($args -notcontains '--no-alt-screen') { $sparkCodexOptions = @('--no-alt-screen') + $sparkCodexOptions }
    $sparkPreviousVisual = $env:VISUAL
    try {
      if ($env:SPARK_CODEX_EDITOR) {
        $env:VISUAL = $env:SPARK_CODEX_EDITOR
        [Console]::Write([char]27 + ']${CODEX_EDITOR_CAPABILITY_OSC};editor=spark' + [char]7)
      }
      & $sparkCodexCommand.Source @sparkCodexOptions @args
    } finally {
      $env:VISUAL = $sparkPreviousVisual
      [Console]::Write([char]27 + ']${CODEX_EDITOR_CAPABILITY_OSC};editor=' + [char]7)
    }
  }
}
`

/** Load normal PowerShell profiles first, then install session-local command adapters. */
export function shellArguments(shellPath: string): string[] {
  return /(?:^|[\\/])(?:pwsh|powershell)(?:\.exe)?$/i.test(shellPath)
    ? ['-NoExit', '-Command', codexIntegration]
    : []
}
