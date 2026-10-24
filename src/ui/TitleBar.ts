/** 自定义标题栏：最小化/最大化/关闭 */
export class TitleBar {
  constructor() {
    document.getElementById('win-min')!.onclick = () => window.spark.window.minimize()
    document.getElementById('win-max')!.onclick = () => window.spark.window.toggleMaximize()
    document.getElementById('win-close')!.onclick = () => window.spark.window.close()
  }
}
