import type { TerminalController } from '../terminal/TerminalController'
import type { TerminalSession } from '../terminal/TerminalSession'
import { bus } from '../core/EventBus'
import type { InjectionPack } from './types'

const READY_TIMEOUT_MS = 45000
const OUTPUT_SETTLE_MS = 150
const PASTE_SETTLE_MS = 250

function cursorPrefix(session: TerminalSession): string {
  const buffer = session.term.buffer.active
  let index = buffer.baseY + buffer.cursorY
  let line = buffer.getLine(index)
  let prefix = line?.translateToString(true, 0, buffer.cursorX) ?? ''
  while (line?.isWrapped && index > 0) {
    line = buffer.getLine(--index)
    prefix = (line?.translateToString(false) ?? '') + prefix
  }
  return prefix
}

function shellReady(session: TerminalSession): boolean {
  const prefix = cursorPrefix(session)
  if (/(?:powershell|pwsh)(?:\.exe)?$/i.test(session.shellPath)) return /^PS .*>\s*$/.test(prefix)
  if (/(?:^|[\\/])cmd(?:\.exe)?$/i.test(session.shellPath)) return /^[A-Z]:\\.*>\s*$/i.test(prefix)
  return /[$#%>❯]\s*$/.test(prefix)
}

/** Wait for rendered input, and release every listener on completion or cancellation. */
function waitForSession(
  session: TerminalSession,
  ready: () => boolean,
  delayMs: number,
  timeoutMs: number,
  timeoutMessage: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    const disposers: (() => void)[] = []
    const finish = (error?: Error) => {
      clearTimeout(settleTimer)
      clearTimeout(timeout)
      for (const dispose of disposers) dispose()
      if (error) reject(error)
      else resolve()
    }
    const check = () => {
      clearTimeout(settleTimer)
      if (ready()) settleTimer = setTimeout(() => { if (ready()) finish() }, delayMs)
    }
    const timeout = setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs)
    const parsed = session.term.onWriteParsed(check)
    disposers.push(() => parsed.dispose())
    for (const event of ['session:closed', 'session:exited'] as const) {
      disposers.push(bus.on(event, ({ id }) => {
        if (id === session.ptyId) finish(new Error('终端已关闭或进程已退出，已取消内容包注入'))
      }))
    }
    if (session.isExited()) finish(new Error('终端进程已退出'))
    else check()
  })
}

export async function launchPack(controller: TerminalController, shellPath: string, pack: InjectionPack, workspaceCwd = ''): Promise<void> {
  const id = await controller.create(pack.shell || shellPath || undefined, workspaceCwd || pack.cwd || undefined)
  const session = controller.all().find((item) => item.ptyId === id)
  if (!session) return
  const timeoutMs = pack.readyTimeoutMs ?? READY_TIMEOUT_MS
  try {
    if (pack.launchCommand && /[\r\n]/.test(pack.launchCommand)) throw new Error('内容包启动命令必须是单行命令')
    if (pack.launchCommand && pack.injectText && !pack.inputReadyPattern) throw new Error('内容包缺少输入就绪标识，未发送启动命令')
    const pattern = pack.inputReadyPattern ? new RegExp(pack.inputReadyPattern) : null
    if (pack.launchCommand) {
      await waitForSession(session, () => shellReady(session), OUTPUT_SETTLE_MS, timeoutMs, '等待 shell 输入提示符超时，未发送启动命令')
      session.term.paste(pack.launchCommand)
      await waitForSession(session, () => true, PASTE_SETTLE_MS, timeoutMs, '等待启动命令粘贴完成超时')
      window.spark.write(id, '\r')
    }

    if (pack.injectText) {
      const ready = () => pack.launchCommand
        ? session.term.modes.bracketedPasteMode && pattern!.test(cursorPrefix(session))
        : shellReady(session)
      await waitForSession(session, ready, OUTPUT_SETTLE_MS, timeoutMs, '等待应用输入框就绪超时，未注入文本')
      if (!session.term.modes.bracketedPasteMode && /[\r\n]/.test(pack.injectText)) {
        throw new Error('当前应用未启用整段粘贴，未注入多行文本')
      }
      session.term.paste(pack.injectText)
      if (pack.autoSubmit !== false) {
        // Keep Enter outside the paste so the application submits one complete prompt.
        await waitForSession(session, () => true, PASTE_SETTLE_MS, timeoutMs, '等待内容包粘贴完成超时')
        window.spark.write(id, '\r')
      }
    }
    if (pack.inputEditor) session.enableInputEditor()
    if (controller.active() === session) session.focus()
  } catch (error) {
    console.error('[pack]', error)
    if (controller.all().includes(session) && !session.isExited()) {
      session.term.writeln(`\r\n\x1b[31m[内容包] ${(error as Error).message}\x1b[0m`)
    }
  }
}
