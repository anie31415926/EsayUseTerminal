import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import console from 'node:console'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { URL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const executable = resolve(process.argv[2])
const data = await mkdtemp(join(tmpdir(), 'spark-packaged-lifecycle-'))
const env = { ...process.env, SPARK_USER_DATA: data, SPARK_ALLOW_MULTI: '1' }
delete env.ELECTRON_RUN_AS_NODE
delete env.SPARK_AUTO_PACK
delete env.ELECTRON_RENDERER_URL
const app = spawn(executable, ['--remote-debugging-port=0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const exited = once(app, 'exit')
let output = ''
app.stdout.on('data', (chunk) => { output += chunk })
app.stderr.on('data', (chunk) => { output += chunk })
const clients = []
const resources = []
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const pause = () => delay(30)
async function until(check) {
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    try {
      const result = await check()
      if (result) return result
    } catch (error) {
      if (!error.message.includes('Execution context was destroyed')) throw error
    }
    await pause()
  }
  throw new Error(`Packaged lifecycle test timed out\n${output}`)
}
async function connect(target) {
  const socket = new globalThis.WebSocket(target.webSocketDebuggerUrl)
  await once(socket, 'open')
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(event.data)
    const request = pending.get(reply.id)
    if (!request) return
    pending.delete(reply.id)
    if (reply.error) request.reject(new Error(reply.error.message))
    else request.resolve(reply.result)
  })
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('Window closed'))
    pending.clear()
  })
  clients.push(socket)
  const command = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  evaluate.command = command
  return evaluate
}
async function verifyTabHover(evaluate, closeButton = false) {
  await until(async () => (await evaluate('window.spark?.listSessions()'))?.length)
  await evaluate('window.originalTab = document.querySelector(".tab[data-id]"); document.getElementById("btn-new-tab").click(); true')
  const id = await until(() => evaluate('document.querySelector(".tab.active")?.dataset.id !== window.originalTab.dataset.id && document.querySelector(".tab.active")?.dataset.id'))
  await evaluate(`window.tabTitleOutput = ''; window.offTabTitle = window.spark.onData(${JSON.stringify(id)}, text => { window.tabTitleOutput += text }); true`)
  await until(() => evaluate("window.tabTitleOutput.includes('>')"))
  // Creation may rebuild the strip once; retain the old session's current node before streaming.
  const point = await evaluate(`(() => {
    window.originalTab = document.querySelector('.tab[data-id="' + window.originalTab.dataset.id + '"]');
    window.hoverTarget = ${closeButton ? "window.originalTab.querySelector('.tab-close')" : 'window.originalTab'};
    const rect = window.hoverTarget.getBoundingClientRect();
    return { x: rect.left + ${closeButton ? 'rect.width / 2' : '30'}, y: rect.top + rect.height / 2 };
  })()`)
  await evaluate.command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await delay(200)
  assert.ok(await evaluate('window.hoverTarget.matches(":hover")'), 'mouse did not hover the intended target')
  const style = await evaluate('JSON.stringify([getComputedStyle(window.hoverTarget).opacity, getComputedStyle(window.hoverTarget).backgroundColor, getComputedStyle(window.hoverTarget).color])')
  const command = "1..12 | ForEach-Object { [Console]::Write(([char]27).ToString() + ']0;Codex working ' + $_ + [char]7); Start-Sleep -Milliseconds 80 }; Write-Output ('TITLE_'+'READY')\r"
  await evaluate(`window.spark.write(${JSON.stringify(id)}, ${JSON.stringify(command)})`)
  for (let i = 0; i < 8; i++) {
    await delay(100)
    assert.ok(await evaluate('window.hoverTarget.isConnected && window.hoverTarget.matches(":hover")'), 'streaming titles replaced the hovered target')
    assert.equal(await evaluate('JSON.stringify([getComputedStyle(window.hoverTarget).opacity, getComputedStyle(window.hoverTarget).backgroundColor, getComputedStyle(window.hoverTarget).color])'), style, 'hovered target kept changing appearance')
  }
  await until(() => evaluate("window.tabTitleOutput.includes('TITLE_READY')"))
  assert.ok(await evaluate('document.querySelector(".tab.active .tab-title").textContent.includes("Codex working")'), 'native shell titles never reached the tab bar')
  await evaluate('window.offTabTitle(); true')
  console.log(`PASS packaged EXE keeps the original ${closeButton ? 'close button' : 'tab'} hovered during continuous native shell title updates`)
}
async function occupy(evaluate, name) {
  const session = await until(async () => (await evaluate('window.spark?.listSessions()'))?.[0])
  const file = join(data, `${name}.json`)
  const quote = (value) => `'${value.replaceAll("'", "''")}'`
  const command = `& ${quote(process.execPath)} ${quote(resolve('tests/fixtures/session-child.mjs'))} parent ${quote(file)}\r`
  await evaluate(`window.spark.write(${JSON.stringify(session.id)}, ${JSON.stringify(command)})`)
  const resource = await until(async () => { try { return JSON.parse(await readFile(file, 'utf8')) } catch { return null } })
  resources.push(resource)
  assert.ok(alive(resource.parent) && alive(resource.child))
  return resource
}
async function assertReleased(resource) {
  await until(() => !alive(resource.parent) && !alive(resource.child))
  const server = createServer()
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(resource.port, '127.0.0.1', resolve)
    })
  } finally { await new Promise((resolve) => server.close(() => resolve())) }
}
async function verifyInputSwitch(evaluate) {
  const session = await until(async () => (await evaluate('window.spark?.listSessions()'))?.[0])
  await evaluate(`window.inputTestOutput = ''; window.offInputTest = window.spark.onData(${JSON.stringify(session.id)}, text => { window.inputTestOutput += text }); undefined`)
  await until(() => evaluate("window.inputTestOutput.includes('>')"))
  const command = "1..350 | ForEach-Object { Write-Output ('history ' + $_) }; Write-Output ('INPUT_'+'READY')\r"
  await evaluate(`window.spark.write(${JSON.stringify(session.id)}, ${JSON.stringify(command)})`)
  await until(() => evaluate("window.inputTestOutput.includes('INPUT_READY')"))
  if (process.argv.includes('--codex')) {
    const launch = `codex --cd '${process.cwd().replaceAll("'", "''")}'\r`
    await evaluate(`window.inputTestOutput = ''; window.spark.write(${JSON.stringify(session.id)}, ${JSON.stringify(launch)})`)
    await until(() => evaluate("window.inputTestOutput.includes('›')"))
    await delay(500)
  }
  await delay(150)
  const toggle = "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', ctrlKey: true, shiftKey: true, bubbles: true })); true"
  const snapshot = `(() => {
    const viewport = document.querySelector('.session-host:not([style*="display: none"]) .xterm-viewport');
    return { top: viewport.scrollTop, maximum: viewport.scrollHeight - viewport.clientHeight,
      parents: ['#app', '#terminal-host', '.session-host', '.xterm'].map(selector => document.querySelector(selector).scrollTop) };
  })()`
  for (const history of [false, true]) {
    await evaluate(toggle)
    await until(() => evaluate("!!document.querySelector('.input-editor:not([hidden])')"))
    await delay(100)
    await evaluate(`(() => {
      const track = document.querySelector('.scrollbar-track');
      const rect = track.getBoundingClientRect();
      track.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: rect.top + rect.height * ${history ? '0.3' : '1'} }));
      window.dispatchEvent(new MouseEvent('mouseup'));
      return true;
    })()`)
    await delay(100)
    const before = await evaluate(snapshot)
    await evaluate("document.querySelector('.input-editor:not([hidden]) .input-editor-terminal').click(); true")
    await delay(150)
    const after = await evaluate(snapshot)
    assert.ok(history ? Math.abs(before.top - after.top) < 2 : Math.abs(after.top - after.maximum) < 2,
      `input switch changed viewport: ${JSON.stringify({ before, after })}`)
    assert.deepEqual(after.parents, [0, 0, 0, 0], 'input switch scrolled a parent container')
  }
  await evaluate('window.offInputTest(); true')
  if (process.argv.includes('--codex')) {
    await evaluate(`window.spark.write(${JSON.stringify(session.id)}, '\\x03')`)
    await delay(250)
    await evaluate(`window.spark.write(${JSON.stringify(session.id)}, '\\x03')`)
    await delay(500)
  }
  console.log('PASS packaged EXE input mode switches preserve both latest output and historical scroll position')
}
async function verifyDraftOutput(evaluate) {
  const session = await until(async () => (await evaluate('window.spark?.listSessions()'))?.[0])
  await evaluate(`window.draftOutput = ''; window.offDraftOutput = window.spark.onData(${JSON.stringify(session.id)}, text => { window.draftOutput += text }); true`)
  await until(() => evaluate("window.draftOutput.includes('>')"))
  const seed = "1..360 | ForEach-Object { Write-Output ('seed ' + $_) }; Write-Output ('DRAFT_'+'READY')\r"
  await evaluate(`window.spark.write(${JSON.stringify(session.id)}, ${JSON.stringify(seed)})`)
  await until(() => evaluate("window.draftOutput.includes('DRAFT_READY')"))
  await delay(150)
  await evaluate(`document.querySelector('.session-host:not([style*="display: none"]) textarea').dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); true`)
  await until(() => evaluate("!!document.querySelector('.input-editor:not([hidden]) textarea')"))
  const command = "1..100 | ForEach-Object { Write-Output ('sent ' + $_) }; Write-Output ('DRAFT_'+'SENT')"
  await evaluate(`(() => { const input = document.querySelector('.input-editor:not([hidden]) textarea'); input.value = ${JSON.stringify(command)}; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true })); return true })()`)
  await until(() => evaluate("window.draftOutput.includes('DRAFT_SENT')"))
  await delay(250)
  const viewport = await evaluate(`(() => { const el = document.querySelector('.session-host:not([style*="display: none"]) .xterm-viewport'); return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight } })()`)
  assert.ok(viewport.top >= viewport.max - 2, `draft submit left terminal above latest output: ${JSON.stringify(viewport)}`)
  await evaluate('window.offDraftOutput(); true')
  console.log('PASS packaged EXE keeps latest output visible after sending from the application input')
}
try {
  const endpoint = await until(() => output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1])
  const list = async () => (await globalThis.fetch(new URL('/json/list', endpoint.replace('ws:', 'http:')))).json()
  const target = await until(async () => (await list()).find((target) => target.type === 'page'))
  const first = await connect(target)
  if (process.argv.includes('--tabs')) await verifyTabHover(first)
  if (process.argv.includes('--draft')) await verifyDraftOutput(first)
  if (process.argv.includes('--input') || process.argv.includes('--codex')) await verifyInputSwitch(first)
  const one = await occupy(first, 'first')
  await first('window.spark.window.newWindow()')
  const next = await until(async () => (await list()).find((item) => item.type === 'page' && item.id !== target.id))
  const second = await connect(next)
  if (process.argv.includes('--tabs')) await verifyTabHover(second, true)
  const two = await occupy(second, 'second')
  await first('document.getElementById("win-close").click(); true').catch(() => {})
  await assertReleased(one)
  assert.ok(alive(two.parent) && alive(two.child), 'closing one window terminated another window child')
  assert.ok(alive(app.pid), 'closing one window exited the application')
  console.log('PASS packaged EXE title-bar close releases descendants while another window remains active')
  await second('document.getElementById("win-close").click(); true').catch(() => {})
  await until(() => app.exitCode !== null)
  assert.equal((await exited)[0], 0)
  await assertReleased(two)
  console.log('PASS packaged EXE last-window close waits for process-tree cleanup before exiting')
} finally {
  for (const socket of clients) socket.close()
  for (const pid of [app.pid, ...resources.flatMap((item) => [item.parent, item.child])].filter(alive)) {
    try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 }) } catch { /* Already exited. */ }
  }
  await exited
  await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
