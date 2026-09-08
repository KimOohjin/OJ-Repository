/**
 * Generates the PWA icons as PNGs with no image dependencies.
 *
 * Draws a dumbbell on a rounded indigo field into a raw RGBA buffer, then
 * encodes it as a PNG (zlib is in Node core). Run: `npm run icons`.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons')

const BG = [79, 70, 229] // indigo-600
const FG = [241, 245, 249] // slate-100

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Draw a dumbbell: two end plates joined by a bar. */
function draw(size, { maskable }) {
  const px = Buffer.alloc(size * size * 4)
  const radius = maskable ? size : size * 0.22 // maskable = full bleed
  // Always pad the art off the edges; maskable needs the wider safe zone so
  // launchers can crop to a circle without clipping the dumbbell.
  const inset = size * (maskable ? 0.22 : 0.14)

  const set = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 4
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
    px[i + 3] = 255
  }

  const inRounded = (x, y) => {
    const r = Math.min(radius, size / 2)
    const cx = Math.min(Math.max(x, r), size - r)
    const cy = Math.min(Math.max(y, r), size - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }

  // background
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inRounded(x + 0.5, y + 0.5)) set(x, y, BG)
    }
  }

  // dumbbell geometry, centred in the safe area
  const a = inset
  const w = size - inset * 2
  const midY = size / 2
  // Stepped profile — tall outer plates, shorter inner plates, thin bar. The
  // step is what makes it read as a dumbbell rather than a letter H.
  const plateW = w * 0.14
  const plateH = w * 0.62
  const innerW = w * 0.1
  const innerH = w * 0.4
  const barH = w * 0.13

  const rect = (x0, y0, x1, y1) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++) {
      for (let x = Math.round(x0); x < Math.round(x1); x++) {
        if (x >= 0 && y >= 0 && x < size && y < size) set(x, y, FG)
      }
    }
  }

  // bar
  rect(a + plateW, midY - barH / 2, a + w - plateW, midY + barH / 2)
  // outer plates
  rect(a, midY - plateH / 2, a + plateW, midY + plateH / 2)
  rect(a + w - plateW, midY - plateH / 2, a + w, midY + plateH / 2)
  // inner plates
  rect(a + plateW, midY - innerH / 2, a + plateW + innerW, midY + innerH / 2)
  rect(a + w - plateW - innerW, midY - innerH / 2, a + w - plateW, midY + innerH / 2)

  return encodePng(size, size, px)
}

mkdirSync(OUT_DIR, { recursive: true })
const files = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-512-maskable.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: false }],
]
for (const [name, size, opts] of files) {
  writeFileSync(resolve(OUT_DIR, name), draw(size, opts))
  console.log(`wrote icons/${name} (${size}x${size})`)
}
