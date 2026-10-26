import { app, BrowserWindow, nativeImage } from 'electron'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { WindowManager } from '../electron/WindowManager'
import { killAllSessions, registerPtyIpc } from '../electron/ptyService'
import { registerClipboardImageIpc } from '../electron/clipboardImages'
import type { ImageAttachment } from '../src/shared/images'

app.disableHardwareAcceleration()
app.setPath('userData', process.env.SPARK_TEST_DATA!)
// Keep Electron alive until the explicit ConPTY drain at the end of the suite.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  const timeout = setTimeout(() => {
    console.error('Native window regression tests timed out')
    killAllSessions()
    app.exit(1)
  }, 45000)
  const manager = new WindowManager(() => new BrowserWindow({
    width: 640, height: 420, show: false,
    webPreferences: { preload: process.env.SPARK_TEST_PRELOAD!, sandbox: true, contextIsolation: true, backgroundThrottling: false }
  }))
  registerPtyIpc()
  registerClipboardImageIpc()
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
    assert.equal((one as { windowsPty?: { backend: string } }).windowsPty?.backend, 'conpty')
    assert.equal(await evaluate(second, '(async () => (await window.spark.listSessions())[0].windowsPty.backend)()'), 'conpty')
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

    const imageBytes = [...nativeImage.createFromBitmap(Buffer.from([0, 128, 255, 255]), { width: 1, height: 1 }).toPNG()]
    const screenshot = await evaluate<ImageAttachment>(first, `window.spark.images.add(new Uint8Array(${JSON.stringify(imageBytes)}))`)
    assert.ok(existsSync(screenshot.path))
    assert.equal(screenshot.width, 1)
    assert.equal(nativeImage.createFromDataURL(await evaluate<string>(first, `window.spark.images.preview(${JSON.stringify(screenshot.id)})`)).getSize().height, 1)
    console.log('PASS screenshot bytes are normalized to a readable cached PNG and full preview')
    await assert.rejects(evaluate(second, `window.spark.images.preview(${JSON.stringify(screenshot.id)})`), /截图已移除/)
    await evaluate(second, `window.spark.images.release([${JSON.stringify(screenshot.id)}])`)
    assert.ok(existsSync(screenshot.path))
    console.log('PASS one window cannot preview or delete another window screenshot')
    await evaluate(first, `window.spark.images.retain([${JSON.stringify(screenshot.id)}]); undefined`)
    await evaluate(first, `window.spark.images.release([${JSON.stringify(screenshot.id)}])`)
    assert.ok(existsSync(screenshot.path))
    const unsent = await evaluate<ImageAttachment>(first, `window.spark.images.add(new Uint8Array(${JSON.stringify(imageBytes)}))`)
    await evaluate(first, `window.spark.images.release([${JSON.stringify(unsent.id)}])`)
    assert.equal(existsSync(unsent.path), false)
    console.log('PASS removed drafts are deleted while sent screenshots remain readable until window close')
    await assert.rejects(evaluate(first, 'window.spark.images.add(new Uint8Array([1, 2, 3]))'), /无法读取/)
    console.log('PASS invalid image bytes fail explicitly without creating a cached attachment')

    const ownerId = first.webContents.id
    first.destroy()
    await waitFor(async () => !existsSync(screenshot.path))
    assert.equal(existsSync(screenshot.path), false)
    console.log('PASS closing a window cleans up its retained screenshot files')
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
    for (const variant of shells.filter((candidate) => candidate !== shell)) {
      const alternate = await evaluate<{ id: string }>(second, `window.spark.spawn(${JSON.stringify({ shell: variant, cwd })})`)
      await evaluate(second, `window.variantOutput = ''; window.offVariant = window.spark.onData(${JSON.stringify(alternate.id)}, data => { window.variantOutput += data }); undefined`)
      await waitFor(() => evaluate(second, "window.variantOutput.includes('>')"))
      const command = /cmd(?:\.exe)?$/i.test(variant)
        ? 'set SPARK_REGRESSION_MARKER=READY\recho VARIANT_%SPARK_REGRESSION_MARKER%\recho VARIANT_CWD=%CD%\r'
        : "Write-Output ('VARIANT_'+'READY'); Write-Output ('VARIANT_'+'CWD=' + (Get-Location).Path)\r"
      await evaluate(second, `window.spark.write(${JSON.stringify(alternate.id)}, ${JSON.stringify(command)})`)
      await waitFor(() => evaluate(second, "window.variantOutput.includes('VARIANT_READY')"))
      await waitFor(() => evaluate(second, `window.variantOutput.includes(${JSON.stringify('VARIANT_CWD=' + cwd)})`))
      await evaluate(second, `window.offVariant(); window.spark.kill(${JSON.stringify(alternate.id)})`)
      console.log(`PASS alternate shell starts in the chosen workspace and accepts commands: ${variant}`)
    }
    second.destroy()
    clearTimeout(timeout)
    killAllSessions()
    // node-pty drains ConPTY output on a one-second timer after kill; let its callbacks finish.
    await new Promise((resolve) => setTimeout(resolve, 1250))
    app.quit()
  } catch (error) {
    console.error(error)
    clearTimeout(timeout)
    killAllSessions()
    app.exit(1)
  }
})
