import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
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
