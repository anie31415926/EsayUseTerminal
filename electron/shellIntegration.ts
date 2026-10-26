import { CODEX_SCROLLBACK_ARGS } from '../src/shared/codex'

const powershellOptions = CODEX_SCROLLBACK_ARGS.slice(1).map((arg) => `'${arg.replace(/'/g, "''")}'`).join(', ')

/** Keep Codex transcript ownership in the terminal, including resumed sessions. */
const codexIntegration = `
if (-not (Test-Path Function:\\codex) -and -not (Test-Path Alias:\\codex)) {
  function global:codex {
    $sparkCodexCommand = Get-Command codex -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $sparkCodexCommand) { Write-Error 'Codex is not installed or is not on PATH'; return }
    $sparkCodexOptions = @(${powershellOptions})
    if ($args -notcontains '--no-alt-screen') { $sparkCodexOptions = @('--no-alt-screen') + $sparkCodexOptions }
    & $sparkCodexCommand.Source @sparkCodexOptions @args
  }
}
`

/** Load normal PowerShell profiles first, then install session-local command adapters. */
export function shellArguments(shellPath: string): string[] {
  return /(?:^|[\\/])(?:pwsh|powershell)(?:\.exe)?$/i.test(shellPath)
    ? ['-NoExit', '-Command', codexIntegration]
    : []
}
