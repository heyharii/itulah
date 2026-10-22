// Draws the installed app's icons: `node scripts/pwa-icons.mjs`.
//
// Generated rather than exported from a design tool so they can be redrawn in
// one command when the mark changes, and so this needs no image library — a
// PNG is a zlib stream with a header, and Node has zlib. The mark is Matte ·
// Deep (owner, 2026-10-20): a matte blue tile, a pale C with a soft contact
// shadow, the yellow dot in its mouth — the same picture `brand-mark.tsx`
// draws, on the same 100-unit box.
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

// Matte · Deep: each tone runs from its top to its foot, no shine
const TILE = [[0x42, 0x77, 0xe6], [0x1f, 0x4f, 0xc0]]
const PALE = [[0xff, 0xff, 0xff], [0xd3, 0xe0, 0xfa]]
const YELLOW = [[0xff, 0xd7, 0x66], [0xea, 0xa2, 0x0f]]
const SHADOW = [0x0b, 0x24, 0x66]
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

const lerp = ([a, b], t) => {
  const k = Math.min(1, Math.max(0, t))
  return a.map((v, i) => v + (b[i] - v) * k)
}

/// The C (a ring open on the right, round ends) and the dot, on the 100 box
/// `brand-mark.tsx` draws: centre 44,48.5, the ring 21 out and 14.5 thick,
/// open 44° either side; the dot r8 at 75.5,48.5.
const C = { cx: 44, cy: 48.5, r: 21, half: 7.25, open: (44 * Math.PI) / 180 }
const CAPS = [-1, 1].map((side) => [
  C.cx + C.r * Math.cos(C.open),
  C.cy + side * C.r * Math.sin(C.open),
])
function part(u, v) {
  const d = Math.hypot(u - C.cx, v - C.cy)
  const angle = Math.abs(Math.atan2(v - C.cy, u - C.cx))
  const ring = d >= C.r - C.half && d <= C.r + C.half && angle >= C.open
  const cap = CAPS.some(([x, y]) => Math.hypot(u - x, v - y) <= C.half)
  if (ring || cap) return "c"
  if (Math.hypot(u - 75.5, v - 48.5) <= 8) return "dot"
  return null
}
/// The contact shadow under the C: an ellipse 25 by 3.4 at 48,84, blurred.
function shadow(u, v) {
  const e = Math.hypot((u - 48) / 25, (v - 84) / 3.4)
  const t = Math.min(1, Math.max(0, (e - 0.55) / 0.9))
  return 0.4 * (1 - t * t * (3 - 2 * t))
}

/// One sample's colour, or null where nothing is drawn. `scale` shrinks the
/// picture (not the tile) about the centre, into a platform's safe zone.
function sample(x, y, { background, radius, scale, badge }) {
  const u = 50 + (x * 100 - 50) / scale
  const v = 50 + (y * 100 - 50) / scale
  const what = part(u, v)
  if (badge) return what ? WHITE : null
  if (what === "c") return lerp(PALE, (v - 20.25) / 56.5)
  if (what === "dot") return lerp(YELLOW, (v - 40.5) / 16)
  if (!(background && inRoundedSquare(x, y, radius))) return null
  const tile = lerp(TILE, y)
  const a = shadow(u, v)
  return tile.map((c, i) => c + (SHADOW[i] - c) * a)
}

function draw(size, options) {
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
          const colour = sample(x, y, { badge: false, ...options })
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
  // `purpose: any`: the tile's own rounded square, 23.4% like the drawn mark
  "pwa-192.png": draw(192, { background: true, radius: 0.234, scale: 1 }),
  "pwa-512.png": draw(512, { background: true, radius: 0.234, scale: 1 }),
  // Maskable: the platform crops to its own shape, so the square is full
  // bleed and the picture shrinks into the inner 80%.
  "pwa-maskable-512.png": draw(512, {
    background: true,
    radius: 0,
    scale: 0.8,
  }),
  // iOS rounds it itself, so full bleed
  "apple-touch-icon.png": draw(180, {
    background: true,
    radius: 0,
    scale: 0.92,
  }),
  // Android's status bar draws only the alpha: the C and the dot in white
  "pwa-badge-96.png": draw(96, {
    background: false,
    radius: 0,
    scale: 1.2,
    badge: true,
  }),
}
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(join(out, name), bytes)
  console.log(`${name}  ${bytes.length} bytes`)
}
