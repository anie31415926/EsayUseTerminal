import type { InjectionPack } from './types'

/**
 * 内置注入包。新增包直接往这个数组里加即可；UI 会自动渲染。
 *
 * 第一个包移植自 C:\workflow\Project-A1-ejj-kehuduan-nieteng-trunk\StartCodexFullAccess.bat
 * 及其调用的 StartCodexFullAccess.ps1：
 *   - 切到项目根目录
 *   - 起 codex，开 dangerously-bypass-approvals-and-sandbox
 *   - 把 .codex/a1-startup-prompt.md + caveman 提示词整段注入并发送
 */

const A1_PROMPT = [
  '启动前先读取并遵守以下仓记契约：',
  '',
  '1. 先读根目录 `AGENTS.md`，再读 `.agents/skills/project-claude-config/SKILL.md`。',
  '2. 仓记入口固定为 `client/.claude/context/仓级公共上下文.md`；它是规则、硬红线和专题索引，不是业务任务清单。',
  '3. 仅当任务明确是 ongoing / multi-turn、用户要求继续上轮，或确有未收口事项时，才读取 `client/.claude/context/任务交接.md`。读取后只采信与当前工作区 `p4 opened` 相符的条目；不要把历史 pending 当作现状。',
  '4. 任务命中专题时，按仓级公共上下文索引读取对应 `topics/*.md`、skill、rule 或 reference；不要把专题细节复制回公共上下文。',
  '5. 读写中文内容使用 UTF-8；PowerShell 读取中文 Markdown/文本优先显式 `-Encoding UTF8`，必要时同步设置 `$OutputEncoding` / `[Console]::OutputEncoding`。',
  '',
  '读取完成后简短说明“已读仓记”，然后直接分析或处理用户任务，不要无任务时擅自修改仓库。不要把 `.agents/skills/project-claude-config/SKILL.md` 当作仓记公共上下文。',
  '',
  'Enable caveman mode by default. Read and follow `.agents/skills/caveman/SKILL.md`; use its Default level.'
].join('\r\n')

const A1_ROOT = 'C:\\workflow\\Project-A1-ejj-kehuduan-nieteng-trunk'

export const BUILTIN_PACKS: InjectionPack[] = [
  {
    id: 'codex-a1-full-access',
    name: 'Codex · A1 全权限',
    description: '在所选工作区启动 Codex 并发送仓记契约；未选择工作区时使用 Project-A1',
    cwd: A1_ROOT,
    launchCommand: 'codex --no-alt-screen --dangerously-bypass-approvals-and-sandbox',
    inputReadyPattern: '^\\s*›\\s*$',
    injectText: A1_PROMPT,
    autoSubmit: true,
    inputEditor: true
  }
]
