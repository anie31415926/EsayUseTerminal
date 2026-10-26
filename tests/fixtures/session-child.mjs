import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const [, , mode, stateFile] = process.argv
if (mode === 'parent') {
  spawn(process.execPath, [fileURLToPath(import.meta.url), 'child', stateFile], { stdio: 'ignore', windowsHide: true, detached: true })
} else {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => {
    writeFileSync(stateFile, JSON.stringify({ parent: process.ppid, child: process.pid, port: server.address().port }))
  })
}
