import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { isBuildCurrent, recordBuild, snapshotInputs } from '../scripts/build-cache.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'spark-build-cache-'))
  // Only remove the exact temporary fixture created here.
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, content = 'original') => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  for (const path of ['src/main.ts', 'electron/main.ts', 'scripts/launch.mjs', 'package.json', 'out/main/index.js', 'out/preload/index.cjs', 'out/renderer/index.html', 'out/renderer/assets/app.js']) put(path)
  recordBuild(root)
  return { root, put }
}

test('unchanged source and output reuse the build', (t) => {
  const { root } = fixture(t)
  assert.equal(isBuildCurrent(root), true)
})

test('edited, new and deleted source files require a rebuild', (t) => {
  const { root, put } = fixture(t)
  put('src/main.ts', 'edited source')
  assert.equal(isBuildCurrent(root), false)
  recordBuild(root)
  put('src/new.ts')
  assert.equal(isBuildCurrent(root), false)
  recordBuild(root)
  rmSync(join(root, 'src/new.ts'))
  assert.equal(isBuildCurrent(root), false)
})

test('development output and missing renderer assets invalidate the build', (t) => {
  const { root, put } = fixture(t)
  put('out/main/index.js', 'development output')
  assert.equal(isBuildCurrent(root), false)
  recordBuild(root)
  rmSync(join(root, 'out/renderer/assets/app.js'))
  assert.equal(isBuildCurrent(root), false)
})

test('missing or corrupt cache and missing entry points require a rebuild', (t) => {
  const { root, put } = fixture(t)
  put('out/.startup-cache.json', 'invalid JSON')
  assert.equal(isBuildCurrent(root), false)
  recordBuild(root)
  rmSync(join(root, 'out/preload/index.cjs'))
  assert.equal(isBuildCurrent(root), false)
})

test('changes during a build are not marked as current', (t) => {
  const { root, put } = fixture(t)
  const inputs = snapshotInputs(root)
  put('src/main.ts', 'edited during build')
  recordBuild(root, inputs)
  assert.equal(isBuildCurrent(root), false)
})

test('environment and launcher changes invalidate the build', (t) => {
  const { root, put } = fixture(t)
  put('.env.production', 'RENDERER_VITE_SETTING=new')
  assert.equal(isBuildCurrent(root), false)
  recordBuild(root)
  put('scripts/launch.mjs', 'updated launcher')
  assert.equal(isBuildCurrent(root), false)
})
