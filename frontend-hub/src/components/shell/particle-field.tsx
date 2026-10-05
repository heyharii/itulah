import { useEffect, useRef } from "react"

import { cn } from "@/lib/utils"

/// Space dust that flows into a clock — the virtual clock's field.
///
/// A small 2D canvas laid over a pill or a card: tiny square grains (one or
/// two css pixels, snapped to the device grid so they stay crisp) and a few
/// dim round dots up to three. Most of them DRIFT TOWARD THE CLOCK — each
/// follows a gentle curve from a far edge to `target`, a little quicker as it
/// nears, and fades and shrinks to nothing on arrival, then starts again from
/// somewhere far away. The rest twinkle where they are. Brighter and denser to
/// the right, like the reference gradient the owner sent.
///
/// ## Cost
///
/// At most ~30 painted frames a second (rAF, skipped when the gap is shorter),
/// none while the tab is hidden, the field is paused or on unmount; a single
/// still frame under `prefers-reduced-motion`. Every grain is a row in one
/// Float32Array and the frame allocates nothing; the only layout read is the
/// ResizeObserver's, never the frame's.

/// A point inside the canvas, 0–1 on each axis.
interface Aim {
  x: number
  y: number
}

const RIGHT_CENTRE: Aim = { x: 0.9, y: 0.5 }

/// One painted frame per this many ms — 30 fps.
const FRAME_MS = 1000 / 30
/// A frame may come this much early (vsync jitter) and still be painted, so a
/// 60 Hz screen never skips to 20 fps.
const FRAME_GATE = FRAME_MS * 0.85
const TAU = Math.PI * 2

/// A grain is a row of numbers: where to read each.
const KIND = 0 // 0 streams to the clock, 1 twinkles in place
const SIZE = 1 // css px: edge of a square, diameter of a dot
const ROUND = 2 // 1 for a dot
const ALPHA = 3 // how bright it is at its best
const PHASE = 4
const RATE = 5 // twinkle, rad/s
const DEPTH = 6 // how far the twinkle dims it, 0–1
const SX = 7 // where it set off (a speck: where it stays)
const SY = 8
const CX = 9 // the bend of its path
const CY = 10
const T = 11 // progress along the path, 0–1
const DT = 12 // progress a second at calm speed
const FIELDS = 13

/// About one grain for this many css px², between a floor and a ceiling: a
/// badge (under BADGE_AREA) is denser and tops out at 120, a card at 240.
const AREA_PER_GRAIN = 60
const BADGE_AREA_PER_GRAIN = 50
const MIN_GRAINS = 24
const BADGE_AREA = 8000
const BADGE_GRAINS = 120
const MAX_GRAINS = 240
/// Share of the grains that stream; the rest twinkle in place.
const STREAMING = 0.7
/// A few bright 1.5px specks per ~110 grains, the field's sparkle.
const SPARKLES = 0.055
/// Never darker than this over the pale half, where the label is read; the
/// dust also fades out by 60% across (ink keeps 6.0:1 or better, the smaller
/// ink-2 lines 5.6:1, under a grain at this alpha — see the `--space-*`
/// tokens in styles/index.css).
const DUST_CAP = 0.3
/// Where, across the field, violet dust gives way to white grains.
const LIGHT_FROM = 0.25
const LIGHT_TO = 0.6

interface Sim {
  w: number
  h: number
  dpr: number
  tx: number
  ty: number
  /// Specks stay out of the clock's own disc, which hides them anyway.
  clear: number
  n: number
  g: Float32Array
}

interface Palette {
  dust: string
  grain: string
}

const P = { x: 0, y: 0 }

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a)
}

function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x))
}

function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/// A point on the field's border, nudged inward, and at least 40% of the way
/// to the farthest corner from the clock — so the stream has a length to show.
function edgePoint(sim: Sim) {
  const { w, h, tx, ty } = sim
  const far = 0.4 * Math.hypot(Math.max(tx, w - tx), Math.max(ty, h - ty))
  for (let k = 0; k < 10; k++) {
    let p = Math.random() * 2 * (w + h)
    const depth = Math.random() ** 2 * 0.35 * Math.min(w, h)
    if (p < w) {
      P.x = p
      P.y = depth
    } else if ((p -= w) < h) {
      P.x = w - depth
      P.y = p
    } else if ((p -= h) < w) {
      P.x = w - p
      P.y = h - depth
    } else {
      P.x = depth
      P.y = h - (p - w)
    }
    if (Math.hypot(P.x - tx, P.y - ty) >= far) return
  }
}

/// Sets a streaming grain off from a far edge, `progress` of the way in.
function launch(sim: Sim, o: number, progress: number) {
  const g = sim.g
  edgePoint(sim)
  const sx = P.x
  const sy = P.y
  const dx = sim.tx - sx
  const dy = sim.ty - sy
  const len = Math.hypot(dx, dy) || 1
  // Mostly the same way round, so the whole field swirls in one direction.
  const bend = (Math.random() < 0.8 ? 1 : -1) * rand(0.06, 0.2) * len
  g[o + SX] = sx
  g[o + SY] = sy
  g[o + CX] = sx + dx / 2 - (dy / len) * bend
  g[o + CY] = sy + dy / 2 + (dx / len) * bend
  g[o + T] = progress
  // Calm is 24–44 css px a second, whatever the length.
  g[o + DT] = rand(24, 44) / len
}

/// Where a streaming grain is at progress `t`: a quadratic curve from its
/// edge through its bend to the clock, eased so the last stretch is quicker.
function at(sim: Sim, o: number, t: number) {
  const g = sim.g
  const u = 0.65 * t + 0.35 * t * t
  const v = 1 - u
  P.x = v * v * g[o + SX] + 2 * v * u * g[o + CX] + u * u * sim.tx
  P.y = v * v * g[o + SY] + 2 * v * u * g[o + CY] + u * u * sim.ty
}

function build(w: number, h: number, dpr: number, aim: Aim): Sim {
  const badge = w * h < BADGE_AREA
  const n = clamp(
    Math.round((w * h) / (badge ? BADGE_AREA_PER_GRAIN : AREA_PER_GRAIN)),
    MIN_GRAINS,
    badge ? BADGE_GRAINS : MAX_GRAINS
  )
  const sim: Sim = {
    w,
    h,
    dpr,
    tx: aim.x * w,
    ty: aim.y * h,
    clear: Math.min(h * 0.5, 44),
    n,
    g: new Float32Array(n * FIELDS),
  }
  const g = sim.g
  const streams = Math.round(n * STREAMING)
  const sparkles = Math.max(2, Math.round(n * SPARKLES))
  for (let i = 0; i < n; i++) {
    const o = i * FIELDS
    const roll = Math.random()
    if (i >= streams && i < streams + sparkles) {
      // A sparkle: a bright 1.5px square that twinkles hard, on the violet side.
      g[o + SIZE] = 1.5
      g[o + ALPHA] = rand(0.85, 1)
    } else if (roll < 0.1) {
      // A dim dot, up to three px across.
      g[o + ROUND] = 1
      g[o + SIZE] = rand(2, 3)
      g[o + ALPHA] = rand(0.14, 0.34)
    } else if (roll < 0.62) {
      // The fine grain: 1px, a fifth of them dim.
      g[o + SIZE] = 1
      g[o + ALPHA] = rand(0.5, 1) * (Math.random() < 0.2 ? 0.45 : 1)
    } else {
      // The coarse grain: a 2px square, clearly a square.
      g[o + SIZE] = 2
      g[o + ALPHA] = rand(0.55, 1) * (Math.random() < 0.15 ? 0.45 : 1)
    }
    g[o + PHASE] = rand(0, TAU)
    g[o + RATE] = rand(1.2, 4.4)
    g[o + DEPTH] = Math.random() < 0.6 ? rand(0.55, 0.9) : rand(0.1, 0.3)
    if (i >= streams && i < streams + sparkles) g[o + DEPTH] = rand(0.7, 0.9)
    if (i < streams) {
      launch(sim, o, rand(0, 0.95))
    } else {
      g[o + KIND] = 1
      const sparkle = i < streams + sparkles
      // Skewed to the right: denser where the gradient is violet, but about a
      // third still land on the pale half so it is not bare.
      for (let k = 0; k < 6; k++) {
        P.x = sparkle ? w * rand(0.45, 0.97) : w * (1 - Math.random() ** 1.5)
        P.y = Math.random() * h
        if (Math.hypot(P.x - sim.tx, P.y - sim.ty) >= sim.clear) break
      }
      g[o + SX] = P.x
      g[o + SY] = P.y
    }
  }
  return sim
}

/// Whether a field of this size keeps about the grain count it already has.
function sameDensity(sim: Sim, w: number, h: number): boolean {
  const ratio = (w * h) / (sim.w * sim.h)
  return ratio > 0.6 && ratio < 1.6
}

/// Carries the grains over to a new size by scaling their places, so a card
/// that changes height (a date that wraps) does not shuffle its dust.
function fit(sim: Sim, w: number, h: number, dpr: number, aim: Aim) {
  const sx = w / sim.w
  const sy = h / sim.h
  // A path got longer or shorter, so its progress a second shifts to keep the
  // pace in css px a second.
  const pace = Math.sqrt((sx * sx + sy * sy) / 2)
  const g = sim.g
  for (let i = 0; i < sim.n; i++) {
    const o = i * FIELDS
    g[o + SX] *= sx
    g[o + SY] *= sy
    g[o + CX] *= sx
    g[o + CY] *= sy
    if (g[o + KIND] === 0) g[o + DT] /= pace
  }
  sim.w = w
  sim.h = h
  sim.dpr = dpr
  sim.tx = aim.x * w
  sim.ty = aim.y * h
  sim.clear = Math.min(h * 0.5, 44)
}

function mark(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  o: number,
  x: number,
  y: number,
  size: number
) {
  if (sim.g[o + ROUND] === 1) {
    ctx.beginPath()
    ctx.arc(x, y, size / 2, 0, TAU)
    ctx.fill()
  } else {
    // On the device grid, so a 1px grain is one crisp pixel, not a smear.
    const d = sim.dpr
    ctx.fillRect(Math.round(x * d) / d, Math.round(y * d) / d, size, size)
  }
}

/// One frame. `dt` of 0 repaints without moving (a still frame); `rate` is
/// the speed factor and `boost` (0–1) the burst's strength.
function paint(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  pal: Palette,
  time: number,
  dt: number,
  rate: number,
  boost: number
) {
  const { g, n, w } = sim
  ctx.clearRect(0, 0, sim.w, sim.h)
  for (let i = 0; i < n; i++) {
    const o = i * FIELDS
    let t = 0
    let env = 1
    let size = g[o + SIZE]
    if (g[o + KIND] === 0) {
      t = g[o + T] + dt * g[o + DT] * rate * (1 + 5 * boost)
      if (t >= 1) {
        launch(sim, o, 0)
        t = 0
      }
      g[o + T] = t
      at(sim, o, t)
      env = smooth(0, 0.12, t) * (1 - smooth(0.72, 1, t))
      // Shrinking: a round dot narrows, a 2px square drops to 1px and fades.
      if (g[o + ROUND] === 1) size *= 1 - smooth(0.7, 1, t)
      else if (t > 0.78) size = 1
    } else {
      P.x = g[o + SX]
      P.y = g[o + SY]
    }
    const x = P.x
    const y = P.y
    const twinkle =
      1 -
      g[o + DEPTH] +
      g[o + DEPTH] * (0.5 + 0.5 * Math.sin(time * g[o + RATE] + g[o + PHASE]))
    const across = clamp(x / w, 0, 1)
    // Dimmer at the left, brighter toward the right (and the clock).
    const bright = (0.6 + 0.4 * across) * env * twinkle * (1 + 0.8 * boost)
    const alpha = g[o + ALPHA] * bright
    // Violet grains show on the pale half, white ones on the violet half; the
    // white ones go up to nearly full brightness.
    const light = smooth(LIGHT_FROM, LIGHT_TO, across)
    const dust = Math.min(DUST_CAP, alpha * 1.15 * (1 - light))
    const grain = Math.min(1, alpha * 1.3 * light)
    if (dust > 0.02) {
      ctx.globalAlpha = dust
      ctx.fillStyle = pal.dust
      mark(ctx, sim, o, x, y, size)
    }
    if (grain > 0.02) {
      ctx.globalAlpha = grain
      ctx.fillStyle = pal.grain
      mark(ctx, sim, o, x, y, size)
    }
    // A burst leaves a short streak behind each streaming grain.
    if (boost > 0.15 && g[o + KIND] === 0 && t > 0.04) {
      for (let k = 1; k <= 3; k++) {
        const back = t - k * 0.03
        if (back <= 0) break
        at(sim, o, back)
        const faint = (alpha * boost * (4 - k)) / 5
        if (light > 0.5) {
          ctx.globalAlpha = Math.min(1, faint)
          ctx.fillStyle = pal.grain
        } else {
          ctx.globalAlpha = Math.min(DUST_CAP, faint)
          ctx.fillStyle = pal.dust
        }
        mark(ctx, sim, o, P.x, P.y, size)
      }
    }
  }
  ctx.globalAlpha = 1
}

export function ParticleField({
  target = RIGHT_CENTRE,
  speed = 1,
  burst = false,
  paused = false,
  className,
}: {
  /// Where the grains are heading — the clock face's centre, 0–1 across and
  /// down the canvas.
  target?: Aim
  /// 1 is calm; a fast clock raises it.
  speed?: number
  /// True for ~650 ms after the clock jumps: faster, brighter, with streaks.
  burst?: boolean
  /// Holds the field where it is.
  paused?: boolean
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef({ speed, burst, paused })
  const sync = useRef<() => void>(() => undefined)
  const tx = target.x
  const ty = target.y

  // The loop reads these through the ref, so a new speed or a burst never
  // rebuilds the field.
  useEffect(() => {
    live.current = { speed, burst, paused }
    sync.current()
  }, [speed, burst, paused])

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d") ?? null
    if (canvas === null || ctx === null) return

    // The tokens are always on :root; the colours are theirs alone.
    const css = getComputedStyle(canvas)
    const pal: Palette = {
      dust: css.getPropertyValue("--space-dust").trim(),
      grain: css.getPropertyValue("--space-grain").trim(),
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)")

    let sim: Sim | null = null
    let raf = 0
    let last = 0
    let clock = 0
    let boost = 0
    /// The canvas shows something other than the still frame, so a stopped
    /// field needs one repaint; false once it has been painted.
    let dirty = true
    let box = { w: 0, h: 0 }

    const hold = () => {
      if (sim === null || document.hidden) return
      paint(ctx, sim, pal, clock, 0, 0, 0)
      dirty = false
    }

    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame)
      if (sim === null || ts - last < FRAME_GATE) return
      const dt = last === 0 ? 0 : Math.min((ts - last) / 1000, 0.1)
      last = ts
      clock = ts / 1000
      const now = live.current
      boost += ((now.burst ? 1 : 0) - boost) * Math.min(1, dt * 10)
      paint(ctx, sim, pal, clock, dt, clamp(now.speed, 0.25, 6), boost)
    }

    const run = () => {
      const go =
        sim !== null &&
        !document.hidden &&
        !still.matches &&
        !live.current.paused
      if (go) {
        if (raf === 0) {
          last = 0
          raf = requestAnimationFrame(frame)
        }
      } else {
        const was = raf !== 0
        if (was) cancelAnimationFrame(raf)
        raf = 0
        boost = 0
        // Only a field that was moving, or whose canvas was just cleared,
        // needs painting: a still one is already on screen.
        if (was || dirty) hold()
      }
    }
    sync.current = run

    // Sizes the backing store and the grains to the canvas's css size and the
    // screen's pixel ratio. Grains keep their places across a resize.
    const layout = () => {
      if (box.w < 2 || box.h < 2) {
        sim = null
        run()
        return
      }
      const dpr = window.devicePixelRatio || 1
      const aim = { x: tx, y: ty }
      canvas.width = Math.round(box.w * dpr)
      canvas.height = Math.round(box.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (sim !== null && sameDensity(sim, box.w, box.h)) {
        fit(sim, box.w, box.h, dpr, aim)
      } else {
        sim = build(box.w, box.h, dpr, aim)
      }
      dirty = true
      run()
      // A moving field paints on its next frame; this fills the gap.
      if (raf !== 0) hold()
    }

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect === undefined) return
      // Under 1px is layout noise, not a resize.
      if (
        Math.abs(rect.width - box.w) < 1 &&
        Math.abs(rect.height - box.h) < 1
      ) {
        return
      }
      box = { w: rect.width, h: rect.height }
      layout()
    })
    observer.observe(canvas)

    // Browser zoom or a move to another screen changes the pixel ratio without
    // changing the canvas's css size, so the observer is silent: watch for it.
    let ratio: MediaQueryList | null = null
    const onRatio = () => {
      watch()
      layout()
    }
    const watch = () => {
      ratio?.removeEventListener("change", onRatio)
      ratio = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`
      )
      ratio.addEventListener("change", onRatio)
    }
    watch()
    document.addEventListener("visibilitychange", run)
    still.addEventListener("change", run)

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      observer.disconnect()
      ratio?.removeEventListener("change", onRatio)
      document.removeEventListener("visibilitychange", run)
      still.removeEventListener("change", run)
      sync.current = () => undefined
    }
  }, [tx, ty])

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 size-full",
        className
      )}
    />
  )
}
