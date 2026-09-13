/// Hex, and how far apart two of them look.
///
/// Split from `<ColourField>` because it is arithmetic, not chrome: the form
/// validates a hex, the preview measures a hex against the list, and the
/// picker steers one — three callers for the same six digits.

/// The database's own `hex_code` CHECK, restated so a form never earns a 400
/// that reads like a server fault.
export const HEX = /^#[0-9A-Fa-f]{6}$/

/// Hue in degrees, saturation and value as 0–1.
///
/// The picker's knobs are held in HSV rather than in the hex, because a hex
/// cannot carry where a knob was: every grey is hue 0, so sliding saturation
/// down to nothing and back would swing a chosen olive round to red.
export interface Hsv {
  readonly h: number
  readonly s: number
  readonly v: number
}

export function clamp(one: number): number {
  return one < 0 ? 0 : one > 1 ? 1 : one
}

export function hexOf({ h, s, v }: Hsv): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return (
    "#" +
    [r, g, b]
      .map((one) =>
        Math.round((one + m) * 255)
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
      .toUpperCase()
  )
}

/// `#1B2A4A` → its three channels, or null for anything that is not a hex.
export function channels(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

export function hsvOf(hex: string): Hsv | null {
  const rgb = channels(hex)
  if (rgb === null) return null
  const [r, g, b] = rgb.map((one) => one / 255)
  const high = Math.max(r, g, b)
  const low = Math.min(r, g, b)
  const span = high - low
  const h =
    span === 0
      ? 0
      : high === r
        ? (60 * (((g - b) / span + 6) % 6)) % 360
        : high === g
          ? 60 * ((b - r) / span + 2)
          : 60 * ((r - g) / span + 4)
  return { h, s: high === 0 ? 0 : span / high, v: high }
}

/// How far apart two colours LOOK, rather than how far apart they are stored.
///
/// Plain RGB distance calls `#00FF00` and `#0000FF` neighbours, which no eye
/// does. This is the "redmean" weighting — cheap, no colour-space library, and
/// close enough that it will disagree with a person about twice in a
/// vocabulary of a hundred. Null when either side is not a hex.
export function apart(one: string, two: string): number | null {
  const a = channels(one)
  const b = channels(two)
  if (a === null || b === null) return null
  const mean = (a[0] + b[0]) / 2
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return Math.sqrt(
    (2 + mean / 256) * dr * dr +
      4 * dg * dg +
      (2 + (255 - mean) / 256) * db * db
  )
}

/// Below this, two swatches on one rail are the same dot to a person walking
/// past it. Calibrated against the pairs this vocabulary actually holds: two
/// navies eight points apart per channel score about 20, two reds anybody
/// would call different score above 50.
///
/// It reads high at the dark end, where the weighting stops compressing:
/// `#000000` and `#111111` score 51 and go unmentioned, though nobody would
/// call them two colours. Left at 40 anyway — this is a caution somebody has
/// to read past every time it is wrong, and a threshold that cries at two
/// distinguishable reds is a threshold people learn to ignore.
export const ONE_DOT = 40

/// The colour already in the list that this one would be mistaken for.
///
/// This is the failure the whole table exists to prevent, arriving by a
/// different door: free text let somebody type a fourth "Navy", and a picker
/// lets somebody drag to one. A caution and never a refusal — a company really
/// can carry two navies for two fabrics, and only the person naming it knows
/// whether this is that.
export function mistakenFor<T extends { readonly hex_code: string | null }>(
  hex: string,
  existing: readonly T[]
): T | null {
  let nearest: T | null = null
  let best = ONE_DOT
  for (const one of existing) {
    if (one.hex_code === null) continue
    const distance = apart(hex, one.hex_code)
    if (distance !== null && distance < best) {
      best = distance
      nearest = one
    }
  }
  return nearest
}
