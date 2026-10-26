import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { WindowManager } from '../electron/WindowManager'
import { killAllSessions, registerPtyIpc } from '../electron/ptyService'

app.disableHardwareAcceleration()
app.setPath('userData', process.env.SPARK_TEST_DATA!)

app.whenReady().then(async () => {
  const timeout = setTimeout(() => { killAllSessions(); app.exit(1) }, 20000)
  const manager = new WindowManager(() => new BrowserWindow({
    width: 640, height: 420, show: false,
    webPreferences: { preload: process.env.SPARK_TEST_PRELOAD!, sandbox: true, contextIsolation: true, backgroundThrottling: false }
  }))
  registerPtyIpc()
  const evaluate = <T>(win: BrowserWindow, code: string): Promise<T> => win.webContents.executeJavaScript(code)
  const waitFor = async (check: () => Promise<boolean>) => {
    const deadline = Date.now() + 5000
    while (!await check()) {
      assert.ok(Date.now() < deadline, 'native window test timed out')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  try {
    const first = manager.create('first-pack')
    const second = manager.create('second-pack')
    await first.loadURL('data:text/html,<title>First window</title>')
    await second.loadURL('data:text/html,<title>Second window</title>')
    const one = await evaluate<{ id: string }>(first, 'window.spark.spawn({ cols: 80, rows: 24 })')
    const two = await evaluate<{ id: string }>(second, 'window.spark.spawn({ cols: 80, rows: 24 })')
    assert.notEqual(one.id, two.id)
    assert.deepEqual(await evaluate(first, '(async () => (await window.spark.listSessions()).map(s => s.id))()'), [one.id])
    assert.deepEqual(await evaluate(second, '(async () => (await window.spark.listSessions()).map(s => s.id))()'), [two.id])
    assert.equal(manager.autoPackFor(first.webContents.id), 'first-pack')
    assert.equal(manager.autoPackFor(second.webContents.id), 'second-pack')
    console.log('PASS native windows own separate terminals and startup content packs')

    await evaluate(first, `window.windowTestOutput = ''; window.spark.onData(${JSON.stringify(one.id)}, data => { window.windowTestOutput += data }); undefined`)
    await evaluate(second, `window.spark.write(${JSON.stringify(one.id)}, 'FOREIGN_INPUT'); window.spark.kill(${JSON.stringify(one.id)})`)
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.deepEqual(await evaluate(first, '(async () => (await window.spark.listSessions()).map(s => s.id))()'), [one.id])
    assert.equal(await evaluate(first, "window.windowTestOutput.includes('FOREIGN_INPUT')"), false)
    console.log('PASS one window cannot write to or kill another window terminal')

    const ownerId = first.webContents.id
    first.destroy()
    assert.equal(manager.autoPackFor(ownerId), '')
    assert.deepEqual(await evaluate(second, '(async () => (await window.spark.listSessions()).map(s => s.id))()'), [two.id])
    await evaluate(second, `window.windowTestOutput = ''; window.spark.onData(${JSON.stringify(two.id)}, data => { window.windowTestOutput += data }); window.spark.write(${JSON.stringify(two.id)}, 'OWNER_INPUT')`)
    await waitFor(() => evaluate(second, "window.windowTestOutput.includes('OWNER_INPUT')"))
    console.log('PASS closing one window leaves another window terminal alive and accepting input')
    const cwd = join(process.env.SPARK_TEST_DATA!, '..', "workspace 中文's folder")
    mkdirSync(cwd, { recursive: true })
    const quotedCwd = `"${cwd}"`
    assert.equal(await evaluate(second, `window.spark.resolveCwd(${JSON.stringify(quotedCwd)})`), cwd)
    assert.equal(await evaluate(second, "window.spark.resolveCwd('')"), homedir())
    assert.equal(await evaluate(second, "window.spark.resolveCwd('默认（用户主目录）')"), homedir())
    const shells = await evaluate<string[]>(second, 'window.spark.detectShells()')
    const shell = shells.find((candidate) => /(?:pwsh|powershell)(?:\.exe)?$/i.test(candidate))!
    assert.ok(shell, 'PowerShell is required for the native workspace test')
    const workspace = await evaluate<{ id: string }>(second, `window.spark.spawn(${JSON.stringify({ shell, cwd: quotedCwd })})`)
    await evaluate(second, `window.cwdOutput = ''; window.spark.onData(${JSON.stringify(workspace.id)}, data => { window.cwdOutput += data }); undefined`)
    await waitFor(() => evaluate(second, "window.cwdOutput.includes('>')"))
    await evaluate(second, `window.spark.write(${JSON.stringify(workspace.id)}, ${JSON.stringify("Write-Output ('CWD_'+'RESULT=' + (Get-Location).Path)\r")})`)
    await waitFor(() => evaluate(second, `window.cwdOutput.includes(${JSON.stringify('CWD_RESULT=' + cwd)})`))
    console.log('PASS real PowerShell starts in the selected directory including spaces, Chinese and apostrophes')
    await assert.rejects(evaluate(second, `window.spark.spawn(${JSON.stringify({ cwd: join(cwd, 'missing') })})`), /工作区目录不存在/)
    await assert.rejects(evaluate(second, "window.spark.resolveCwd('relative-path')"), /绝对路径/)
    assert.equal((await evaluate<unknown[]>(second, 'window.spark.listSessions()')).length, 2)
    console.log('PASS invalid workspace paths fail explicitly without spawning a terminal in the home directory')
    const shimDir = join(process.env.SPARK_TEST_DATA!, '..', 'codex-shim')
    mkdirSync(shimDir)
    writeFileSync(join(shimDir, 'codex.ps1'), "Write-Output ('INTEGRATION_'+'ARGS=' + ($args -join '|'))\n")
    const previousPath = process.env.PATH
    let integrated: { id: string }
    try {
      process.env.PATH = `${shimDir};${previousPath ?? ''}`
      integrated = await evaluate<{ id: string }>(second, `window.spark.spawn(${JSON.stringify({ shell, cwd })})`)
    } finally { process.env.PATH = previousPath }
    await evaluate(second, `window.integrationOutput = ''; window.spark.onData(${JSON.stringify(integrated.id)}, data => { window.integrationOutput += data }); undefined`)
    await waitFor(() => evaluate(second, "window.integrationOutput.includes('>')"))
    await evaluate(second, `window.spark.write(${JSON.stringify(integrated.id)}, ${JSON.stringify('codex resume fake-thread\r')})`)
    await waitFor(() => evaluate(second, "window.integrationOutput.includes('INTEGRATION_ARGS=')"))
    const integrationOutput = await evaluate<string>(second, 'window.integrationOutput')
    assert.match(integrationOutput, /INTEGRATION_ARGS=--no-alt-screen\|-c\|tui\.alternate_screen="?never"?\|-c\|tui\.fullscreen_transcript=false\|resume\|fake-thread/)
    console.log('PASS PowerShell Codex integration preserves resume arguments and disables application-owned transcript scrolling')
    await evaluate(second, `window.integrationOutput = ''; window.spark.write(${JSON.stringify(integrated.id)}, ${JSON.stringify('codex --no-alt-screen --cd "C:\\folder with spaces"\r')})`)
    await waitFor(() => evaluate(second, "window.integrationOutput.includes('INTEGRATION_ARGS=')"))
    const argumentsLine = (await evaluate<string>(second, 'window.integrationOutput')).split('\n').find((line) => line.includes('INTEGRATION_ARGS='))!
    assert.equal(argumentsLine.split('--no-alt-screen').length - 1, 1)
    assert.ok(argumentsLine.includes('C:\\folder with spaces'))
    console.log('PASS content pack flags are not duplicated and quoted Codex arguments remain intact')
    second.destroy()
    clearTimeout(timeout)
    killAllSessions()
    app.exit(0)
  } catch (error) {
    console.error(error)
    clearTimeout(timeout)
    killAllSessions()
    app.exit(1)
  }
})
