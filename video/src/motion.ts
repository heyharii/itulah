import { Easing, interpolate } from "remotion"

/* The hub's three curves (frontend-hub/src/styles/index.css), and nothing else:
   ease-out for anything arriving or leaving, ease-in-out for things moving on
   screen, the drawer curve for sheets travelling the width of the window. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1)
export const EASE_DRAWER = Easing.bezier(0.32, 0.72, 0, 1)

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

/** 0 → 1 between two authored frames. */
export const progress = (
  t: number,
  from: number,
  to: number,
  easing: (n: number) => number = EASE_OUT
) => interpolate(t, [from, to], [0, 1], { ...clamp, easing })

/** A value between two numbers over [from, to]. */
export const tween = (
  t: number,
  [from, to]: readonly [number, number],
  [a, b]: readonly [number, number],
  easing: (n: number) => number = EASE_OUT
) => interpolate(t, [from, to], [a, b], { ...clamp, easing })

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** Arriving: 8px below, a hair small, transparent — never from nothing. */
export const enter = (t: number, at: number, len = 9) => {
  const k = progress(t, at, at + len)
  return {
    opacity: k,
    translate: `0px ${lerp(8, 0, k)}px`,
    scale: String(lerp(0.985, 1, k)),
  }
}

/** Leaving: faster than arriving, and it goes the way it came. */
export const leave = (t: number, at: number, len = 6) => {
  const k = progress(t, at, at + len)
  return { opacity: 1 - k, translate: `0px ${lerp(0, -6, k)}px` }
}

/** A press: 1 → 0.97 → 1 around frame `at`, the hub's :active scale. */
export const press = (t: number, at: number) =>
  interpolate(t, [at - 1, at + 2, at + 6], [1, 0.97, 1], {
    ...clamp,
    easing: EASE_OUT,
  })

/** The text typed so far: `cps` characters per authored frame from `at`. */
export const typed = (text: string, t: number, at: number, cps = 0.9) =>
  text.slice(0, Math.max(0, Math.floor((t - at) * cps)))

/** A number counting to `to` between two frames, ease-out, whole numbers. */
export const ticker = (t: number, from: number, to: number, a = 0, b = 0) =>
  Math.round(tween(t, [from, to], [a, b]))

/** A point on a quadratic bezier: from a to b, bowed towards c. */
export const arc = (
  k: number,
  a: { x: number; y: number },
  c: { x: number; y: number },
  b: { x: number; y: number }
) => ({
  x: (1 - k) * (1 - k) * a.x + 2 * (1 - k) * k * c.x + k * k * b.x,
  y: (1 - k) * (1 - k) * a.y + 2 * (1 - k) * k * c.y + k * k * b.y,
})
