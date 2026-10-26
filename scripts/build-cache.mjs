import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'

const entries = ['out/main/index.js', 'out/preload/index.cjs', 'out/renderer/index.html']
const cacheFile = 'out/.startup-cache.json'

function snapshot(root, paths) {
  const files = []
  function visit(path) {
    const absolute = join(root, path)
    if (!existsSync(absolute)) return
    const stat = statSync(absolute)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute)) visit(join(path, entry))
    } else if (stat.isFile()) {
      files.push([relative(root, absolute).replaceAll('\\', '/'), stat.size, stat.mtimeMs])
    }
  }
  for (const path of paths) visit(path)
  return files.sort(([a], [b]) => a.localeCompare(b))
}

export function snapshotInputs(root) {
  return snapshot(root, [
    'src', 'electron', 'scripts', 'build', 'package.json', 'package-lock.json',
    'tsconfig.json', 'electron.vite.config.ts',
    ...readdirSync(root).filter((name) => name === '.env' || name.startsWith('.env.'))
  ])
}

function snapshotOutputs(root) {
  return snapshot(root, ['out/main', 'out/preload', 'out/renderer'])
}

export function isBuildCurrent(root) {
  try {
    if (entries.some((path) => !existsSync(join(root, path)))) return false
    const saved = JSON.parse(readFileSync(join(root, cacheFile), 'utf8'))
    return saved.version === 1 &&
      JSON.stringify(saved.inputs) === JSON.stringify(snapshotInputs(root)) &&
      JSON.stringify(saved.outputs) === JSON.stringify(snapshotOutputs(root))
  } catch { return false }
}

export function recordBuild(root, inputs = snapshotInputs(root)) {
  if (entries.some((path) => !existsSync(join(root, path)))) throw new Error('Build output is incomplete')
  mkdirSync(join(root, 'out'), { recursive: true })
  writeFileSync(join(root, cacheFile), JSON.stringify({ version: 1, inputs, outputs: snapshotOutputs(root) }))
}

export async function buildApp(root) {
  const inputs = snapshotInputs(root)
  process.chdir(root)
  const { build } = await import('electron-vite')
  await build()
  // Snapshot before building: edits made during the build must invalidate the cache.
  recordBuild(root, inputs)
}
