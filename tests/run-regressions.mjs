import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import process from 'node:process'

{
  const { build } = await import('esbuild')
  const { default: electron } = await import('electron')
  const testDir = await mkdtemp(join(tmpdir(), 'spark-regressions-'))
  try {
    await build({ entryPoints: ['tests/terminal-ui.ts'], bundle: true, outfile: join(testDir, 'regressions.js'), format: 'iife' })
    await build({ entryPoints: ['tests/electron-driver.ts'], bundle: true, outfile: join(testDir, 'driver.cjs'), platform: 'node', format: 'cjs', external: ['electron'] })
    const html = (await readFile('src/index.html', 'utf8'))
      .replace(/<link rel="stylesheet"[^>]+>/g, '')
      .replace('<script type="module" src="./main.ts"></script>', '<script src="./regressions.js"></script>')
      .replace('</head>', `<link rel="stylesheet" href="${pathToFileURL(resolve('src/styles/base.css'))}"><link rel="stylesheet" href="./regressions.css"></head>`)
    await writeFile(join(testDir, 'index.html'), html)
    await writeFile(join(testDir, 'package.json'), JSON.stringify({ main: 'driver.cjs' }))
    const env = { ...process.env, SPARK_TEST_HTML: join(testDir, 'index.html'), SPARK_TEST_DATA: join(testDir, 'profile') }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.SPARK_AUTO_PACK
    const child = spawn(electron, [testDir], { env, stdio: 'inherit', windowsHide: true })
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolve(code ?? 1))
    })
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
}
