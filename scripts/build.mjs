import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { buildApp } from './build-cache.mjs'

try {
  await buildApp(fileURLToPath(new URL('..', import.meta.url)))
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
