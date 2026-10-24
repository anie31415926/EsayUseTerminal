// 生成 Windows .ico（多尺寸：16/32/48/64/128/256）
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
const sizes = [16, 32, 48, 64, 128, 256]

await mkdir(root, { recursive: true })

const pngs = []
for (const s of sizes) {
  const buf = await sharp(join(root, 'icon.png'))
    .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const p = join(root, `icon-${s}.png`)
  await writeFile(p, buf)
  pngs.push(p)
}

const ico = await pngToIco(pngs)
await writeFile(join(root, 'icon.ico'), ico)
console.log('icon.ico written, bytes =', ico.length)
