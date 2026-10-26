import { BUILTIN_PACKS } from '../presets/builtin'
import type { InjectionPack } from '../presets/types'
import { registerInputShortcut } from '../shortcuts'

const LAST_KEY = 'spark.lastPackId'

/**
 * 内容包栏：在 workspace-bar 里选一个内置包，点 🚀 新建标签并自动注入。
 * 包列表来自 src/presets/builtin.ts；后续要加用户自定义包，在这里合并即可。
 */
export class PackBar {
  private select: HTMLSelectElement
  private onLaunch: (pack: InjectionPack) => void

  constructor(onLaunch: (pack: InjectionPack) => void) {
    this.onLaunch = onLaunch
    this.select = document.getElementById('pack-select')! as HTMLSelectElement

    // 占位项 + 内置包
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = '（不使用内容包）'
    this.select.appendChild(placeholder)

    for (const pack of BUILTIN_PACKS) {
      const opt = document.createElement('option')
      opt.value = pack.id
      opt.textContent = pack.name
      if (pack.description) opt.title = pack.description
      this.select.appendChild(opt)
    }

    const lastId = localStorage.getItem(LAST_KEY) || ''
    if (lastId && [...this.select.options].some((o) => o.value === lastId)) {
      this.select.value = lastId
    }

    document.getElementById('pack-launch')!.addEventListener('click', () => this.fire())
    registerInputShortcut('pack.launch', this.select, () => this.fire())
  }

  private fire() {
    const id = this.select.value
    if (!id) return
    const pack = BUILTIN_PACKS.find((p) => p.id === id)
    if (!pack) return
    try { localStorage.setItem(LAST_KEY, id) } catch { /* 无痕忽略 */ }
    this.onLaunch(pack)
  }
}
