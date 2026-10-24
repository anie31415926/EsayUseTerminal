/**
 * 工作区栏：顶部一条窄栏，显示/编辑下次新标签的启动目录。
 * - 回车或点 ✓ 保存（写 localStorage）
 * - 点 📁 弹系统目录选择框
 * - 不影响终端里已经在跑的 cd
 */
export class WorkspaceBar {
  private input: HTMLInputElement
  private onChange: (cwd: string) => void
  current: string

  constructor(onChange: (cwd: string) => void) {
    this.onChange = onChange
    this.current = localStorage.getItem('spark.cwd') ?? ''

    const bar = document.getElementById('workspace-bar')!
    this.input = bar.querySelector('input')! as HTMLInputElement
    this.input.value = this.display()

    bar.querySelector('[data-act="browse"]')!.addEventListener('click', async () => {
      const picked = await window.spark.pickFolder()
      if (picked) this.set(picked)
    })
    bar.querySelector('[data-act="go"]')!.addEventListener('click', () => this.commit())
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.commit() }
    })
  }

  private display(): string {
    return this.current || '默认（用户主目录）'
  }

  private commit() {
    const v = this.input.value.trim().replace(/["']/g, '')
    this.set(v)
  }

  set(cwd: string) {
    this.current = cwd
    this.input.value = cwd || '默认（用户主目录）'
    localStorage.setItem('spark.cwd', cwd)
    this.onChange(cwd)
  }
}
