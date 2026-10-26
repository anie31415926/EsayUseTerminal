import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { buildApp, isBuildCurrent } from './build-cache.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const silent = process.argv.includes('--silent')

try {
  const { default: electron } = await import('electron')
  if (!existsSync(electron)) throw new Error('Electron is missing. Run npm install first.')
  if (!isBuildCurrent(root)) {
    console.log('[launch] Updating application build...')
    await buildApp(root)
    if (!isBuildCurrent(root)) throw new Error('Sources changed during the build. Please launch again.')
  }

  const env = { ...process.env, NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const child = spawn(electron, [root], {
    cwd: root, env, windowsHide: true,
    detached: silent, stdio: silent ? 'ignore' : 'inherit'
  })
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
  if (silent) child.unref()
  else child.once('exit', (code) => { process.exitCode = code ?? 1 })
} catch (error) {
  console.error('[launch]', error)
  writeFileSync(join(root, 'launch-error.log'), `${new Date().toISOString()}\n${error.stack ?? error}\n`)
  process.exitCode = 1
}
