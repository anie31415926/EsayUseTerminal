/**
 * 注入内容包（Injection Pack）：
 * 一组预定义的「一键进入某工作场景」配置。选中后新建标签，
 * 按 cwd 起 shell，再在合适时机自动键入启动命令 / 注入预置文本。
 *
 * 典型用法（源自 StartCodexFullAccess.bat / .ps1）：
 *   cwd             -> 项目根目录
 *   launchCommand   -> `codex --cd ... --dangerously-bypass-approvals-and-sandbox`
 *   injectText      -> 仓记契约 prompt + caveman 提示词，整段粘贴到 REPL 并提交
 */
export interface InjectionPack {
  /** 稳定 id，用于 localStorage 记忆最近选中项 */
  id: string
  /** 下拉里显示的名字 */
  name: string
  /**  tooltip / 副标题 */
  description?: string
  /** 未选择工作区时的新标签启动目录；无效路径会报错 */
  cwd?: string
  /** 强制 shell（不传则沿用当前默认 shell 候选第一个） */
  shell?: string
  /** shell 就绪后粘贴并提交的单行启动命令（含参数） */
  launchCommand?: string
  /** 应用输入提示符的正则，匹配光标前的文本；有启动命令和注入文本时必填 */
  inputReadyPattern?: string
  /** 每个阶段的等待超时（ms），默认 45000；超时后停止，不盲写输入 */
  readyTimeoutMs?: number
  /** 要整段粘贴并发送的文本 */
  injectText?: string
  /** 注入文本后是否自动提交，默认 true */
  autoSubmit?: boolean
  /** Use a local draft editor with undo/redo before submitting text to the application. */
  inputEditor?: boolean
}
