/* What the "How far back" page shows at frame t, for a chapter that walks a
   document through its stages: the card on show (the old one leaving, the
   new one arriving), where the rail's highlight is, and the figures. */
import { EASE_IN_OUT, progress, tween } from "../../motion"
import type { StageView } from "../../ui/howfar"

export interface Change {
  at: number
  view: StageView
  rail: number
}

export function cardAt(t: number, changes: readonly Change[]) {
  let i = 0
  while (i + 1 < changes.length && t >= changes[i + 1].at) i++
  const now = changes[i]
  const before = i > 0 ? changes[i - 1] : undefined
  const out = before ? progress(t, now.at, now.at + 5) : 1
  const leaving = before !== undefined && out < 1
  return {
    now,
    showing: leaving ? before.view : now.view,
    k: leaving ? 1 - out : progress(t, now.at + 3, now.at + 17),
    railAt: before ? tween(t, [now.at, now.at + 16], [before.rail, now.rail], EASE_IN_OUT) : now.rail,
  }
}

/** A figure that steps from value to value, counting over 14 frames. */
export function figure(t: number, steps: readonly (readonly [number, number])[]) {
  let v = steps[0][1]
  for (let i = 1; i < steps.length; i++) {
    const [at, to] = steps[i]
    if (t < at) break
    v = Math.round(tween(t, [at, at + 14], [v, to]))
  }
  return v
}

/** 0..1 while something is talked about: in over 10 frames, out over 8. */
export const glowOf = (t: number, from: number, to: number) =>
  progress(t, from, from + 10) * (1 - progress(t, to, to + 8))
