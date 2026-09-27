// Draws the installed app's icons: `node scripts/pwa-icons.mjs`.
//
// Generated rather than exported from a design tool so they can be redrawn in
// one command when the mark changes, and so this needs no image library — a
// PNG is a zlib stream with a header, and Node has zlib. The mark is the
// rail's near-black with a blue bell-dot "C": it is what the dark rail looks
// like with a notification waiting, which is the reason this app is installed.
//
// Writes into `public/`, which Vite serves at the root and copies to `dist/`:
//   pwa-192.png, pwa-512.png        — `purpose: any`, rounded square
//   pwa-maskable-512.png            — full bleed, mark inside the 80% safe zone
//   apple-touch-icon.png (180)      — iOS rounds it itself, so full bleed
//   pwa-badge-96.png                — white on transparent: Android's status
//                                     bar draws only the alpha channel
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { deflateSync } from "node:zlib"

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public")

const RAIL = [0x16, 0x18, 0x1d]
const ACCENT = [0x25, 0x63, 0xeb]
const WHITE = [0xff, 0xff, 0xff]

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes) {
  let c = 0xffffffff
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}
function png(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // no filter
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

/// Coverage of one shape at a point in unit coordinates (0..1, centre 0.5).
function inRoundedSquare(x, y, radius) {
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - radius), 0)
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - radius), 0)
  return dx * dx + dy * dy <= radius * radius
}
/// The "C": a ring open on the right, and the dot that sits in its mouth.
function mark(x, y, scale) {
  const cx = 0.5
  const cy = 0.5
  const u = (x - cx) / scale
  const v = (y - cy) / scale
  const r = Math.hypot(u, v)
  const angle = Math.atan2(v, u)
  const ring = r >= 0.2 && r <= 0.32 && Math.abs(angle) > 0.75
  const dot = Math.hypot(u - 0.24, v + 0.0) <= 0.085
  return ring ? "ring" : dot ? "dot" : null
}

function draw(size, { background, radius, scale, badge = false }) {
  const rgba = Buffer.alloc(size * size * 4)
  const samples = 4 // 4x4 supersampling for smooth edges
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / size
          const y = (py + (sy + 0.5) / samples) / size
          const inside = background ? inRoundedSquare(x, y, radius) : false
          const part = mark(x, y, scale)
          let colour = null
          if (badge) {
            colour = part ? WHITE : null
          } else if (part === "ring") colour = WHITE
          else if (part === "dot") colour = ACCENT
          else if (inside) colour = RAIL
          if (colour) {
            r += colour[0]
            g += colour[1]
            b += colour[2]
            a += 255
          }
        }
      }
      const n = samples * samples
      const at = (py * size + px) * 4
      // Colour averaged over covered samples only, so edges do not darken.
      const covered = a / 255
      rgba[at] = covered ? Math.round(r / covered) : 0
      rgba[at + 1] = covered ? Math.round(g / covered) : 0
      rgba[at + 2] = covered ? Math.round(b / covered) : 0
      rgba[at + 3] = Math.round(a / n)
    }
  }
  return png(size, rgba)
}

const files = {
  "pwa-192.png": draw(192, { background: true, radius: 0.22, scale: 1 }),
  "pwa-512.png": draw(512, { background: true, radius: 0.22, scale: 1 }),
  // Maskable: the platform crops to its own shape, so the square is full
  // bleed and the mark shrinks into the inner 80%.
  "pwa-maskable-512.png": draw(512, {
    background: true,
    radius: 0,
    scale: 0.8,
  }),
  "apple-touch-icon.png": draw(180, {
    background: true,
    radius: 0,
    scale: 0.9,
  }),
  "pwa-badge-96.png": draw(96, {
    background: false,
    radius: 0,
    scale: 1.25,
    badge: true,
  }),
}
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(join(out, name), bytes)
  console.log(`${name}  ${bytes.length} bytes`)
}
