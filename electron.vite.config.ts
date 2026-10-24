import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('electron/main.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // sandbox: true 要求 preload 为 CommonJS，固定输出 .cjs
      rollupOptions: {
        input: { index: resolve('electron/preload.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: 'src',
    build: {
      rollupOptions: {
        input: { index: resolve('src/index.html') }
      }
    },
    resolve: {
      alias: {
        '@': resolve('src')
      }
    }
  }
})
