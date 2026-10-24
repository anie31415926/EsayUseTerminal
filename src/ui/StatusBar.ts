import { bus } from '../core/EventBus'

/** 底部状态栏：shell 名、终端行列、缩放百分比 + 设置入口 */
export class StatusBar {
  private shellEl = document.getElementById('status-shell')!
  private dimEl = document.getElementById('status-dim')!
  private zoomEl = document.getElementById('status-zoom')!

  setShell(name: string) { this.shellEl.textContent = name }
  setDim(cols: number, rows: number) { this.dimEl.textContent = `${cols} × ${rows}` }
  setZoom(factor: number) { this.zoomEl.textContent = `${Math.round(factor * 100)}%` }

  bind(onOpenSettings: () => void) {
    bus.on('zoom:changed', ({ factor }) => this.setZoom(factor))
    bus.on('term:resize', ({ cols, rows }) => this.setDim(cols, rows))
    document.getElementById('btn-settings')!.onclick = onOpenSettings
  }
}
