import type { SparkApi } from '../../electron/preload'

declare global {
  interface Window {
    spark: SparkApi
  }
}
export {}
