/** Own workspace validation and persistence independently of the workspace bar. */
export class WorkspaceManager {
  current = localStorage.getItem('spark.cwd') || ''

  constructor(private openTerminal: (cwd: string) => Promise<string>) {}

  async initialize(): Promise<void> {
    try {
      if (this.current) this.current = await window.spark.resolveCwd(this.current)
    } catch (error) {
      this.current = ''
      throw error
    }
  }

  async apply(value: string): Promise<string> {
    const cwd = await window.spark.resolveCwd(value)
    if (!await this.openTerminal(cwd)) throw new Error('无法在所选目录启动终端，请检查目录权限和 shell 配置')
    this.current = cwd
    localStorage.setItem('spark.cwd', cwd)
    return cwd
  }
}
