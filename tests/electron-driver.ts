import { app, BrowserWindow } from 'electron'

app.disableHardwareAcceleration()
app.setPath('userData', process.env.SPARK_TEST_DATA!)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1000, height: 720, show: false, webPreferences: { backgroundThrottling: false, offscreen: true } })
  win.webContents.on('console-message', (_event, _level, message) => console.log(message))
  const timeout = setTimeout(() => { console.error('Regression tests timed out'); app.exit(1) }, 30000)
  try {
    await win.loadFile(process.env.SPARK_TEST_HTML!)
    const results: { name: string; ok: boolean; error?: string }[] = await win.webContents.executeJavaScript('window.runRegressionTests()')
    for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `: ${result.error}` : ''}`)
    clearTimeout(timeout)
    app.exit(results.some((result) => !result.ok) ? 1 : 0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
