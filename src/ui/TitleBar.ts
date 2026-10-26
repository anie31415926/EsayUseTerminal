import { shortcutLabel } from '../shortcuts/bindings'

/** 自定义标题栏：窗口控制与新建独立窗口 */
export class TitleBar {
  constructor() {
    const newWindow = document.getElementById('btn-new-window')!
    newWindow.title = `新建窗口 (${shortcutLabel('window.new')})`
    newWindow.onclick = () => { void window.spark.window.newWindow() }
    document.getElementById('win-min')!.onclick = () => window.spark.window.minimize()
    document.getElementById('win-max')!.onclick = () => window.spark.window.toggleMaximize()
    document.getElementById('win-close')!.onclick = () => window.spark.window.close()
  }
}
