import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
type TerminalProcess = { pid: number; kill(): void }

/** Keeps the shell alive until Windows has located and terminated its descendants. */
export class ProcessTreeCleanup {
  private pending = new Set<Promise<void>>()

  terminate(proc: TerminalProcess) {
    const cleanup = this.close(proc)
    this.pending.add(cleanup)
    void cleanup.finally(() => this.pending.delete(cleanup))
  }

  private async close(proc: TerminalProcess) {
    try {
      if (process.platform === 'win32' && Number.isInteger(proc.pid) && proc.pid > 0) {
        const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
        await execFileAsync(taskkill, ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 })
      }
    } catch {
      // A terminal may exit naturally while its close request is being processed.
      try {
        process.kill(proc.pid, 0)
        console.error(`[pty:cleanup] Could not terminate process tree ${proc.pid}`)
      } catch { /* The root has already exited. */ }
    } finally {
      try { proc.kill() } catch { /* Release ConPTY even if its shell has already exited. */ }
    }
  }

  async drain() {
    while (this.pending.size) await Promise.all([...this.pending])
  }
}
