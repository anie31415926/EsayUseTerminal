// 生成应用图标：build/icon.svg（源） -> build/icon.png（1024 主图）+ 多尺寸 PNG + icon.ico
// 另外同步一份 src/icon.png 给窗口 favicon。
// 用法：node scripts/make-icon.mjs
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFile, mkdir } from 'node:fs/promises'
import { access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(projectRoot, 'build')
const sizes = [16, 32, 48, 64, 128, 256]

await mkdir(buildDir, { recursive: true })

// 1. 有 SVG 源就从源渲染主图，保证 icon.png 与 svg 永远一致
const svgPath = join(buildDir, 'icon.svg')
const smallSvgPath = join(buildDir, 'icon-small.svg')
const masterPath = join(buildDir, 'icon.png')
const SMALL_MAX = 32 // <= 这个尺寸用「小图版」：无光晕、闪电更大，否则 16px 糊成黑斑

async function renderSvg(src, out) {
  const buf = await sharp(src, { density: 384 }).resize(1024, 1024).png({ compressionLevel: 9 }).toBuffer()
  await writeFile(out, buf)
  return buf.length
}

try {
  await access(svgPath)
  console.log('icon.png rendered from icon.svg, bytes =', await renderSvg(svgPath, masterPath))
} catch {
  console.log('no build/icon.svg, using existing build/icon.png as master')
}

// 小图版主图（缺省时复用大图）
const smallMasterPath = join(buildDir, 'icon-small.png')
let smallMaster = masterPath
try {
  await access(smallSvgPath)
  await renderSvg(smallSvgPath, smallMasterPath)
  smallMaster = smallMasterPath
  console.log('icon-small.png rendered from icon-small.svg')
} catch { /* 没有就沿用大图 */ }

// 2. 多尺寸 PNG（透明背景，Windows 图标里 icon-*.png 已被 ico 内嵌，单独留几档方便复用）
const pngs = []
for (const s of sizes) {
  const src = s <= SMALL_MAX ? smallMaster : masterPath
  const buf = await sharp(src)
    .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer()
  const p = join(buildDir, `icon-${s}.png`)
  await writeFile(p, buf)
  pngs.push(p)
}

// 3. 多尺寸 ICO（Windows 资源管理器 / 任务栏 / 安装包）
const ico = await pngToIco(pngs)
await writeFile(join(buildDir, 'icon.ico'), ico)
console.log('icon.ico written, bytes =', ico.length)

// 4. favicon：窗口内 <link rel="icon">，512 够用又不至于把 bundle 撑大
const favicon = await sharp(masterPath).resize(512, 512).png({ compressionLevel: 9 }).toBuffer()
await writeFile(join(projectRoot, 'src', 'icon.png'), favicon)
console.log('src/icon.png written, bytes =', favicon.length)
