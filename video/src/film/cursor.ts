/* The pointer's choreography: where it rests, when it travels, when it
   clicks. Moves use the hub's ease-in-out (something travelling on screen);
   a click is 6 frames of dip and ring. */
import { EASE_IN_OUT, lerp, progress } from "../motion"

export interface Move {
  at: number
  x: number
  y: number
  /** Frames the trip takes; defaults to one that suits its length. */
  len?: number
}

export function pointerAt(t: number, moves: readonly Move[], clicks: readonly number[] = []) {
  let x = moves[0].x
  let y = moves[0].y
  for (let i = 1; i < moves.length; i++) {
    const m = moves[i]
    const dist = Math.hypot(m.x - x, m.y - y)
    const len = m.len ?? Math.max(8, Math.min(20, dist / 45))
    const k = progress(t, m.at, m.at + len, EASE_IN_OUT)
    if (k <= 0) break
    x = lerp(x, m.x, k)
    y = lerp(y, m.y, k)
  }
  const click = clicks.find((c) => t >= c - 1 && t < c + 7)
  const down = click === undefined ? 0 : Math.min(1, (t - (click - 1)) / 8)
  return { x, y, down }
}

/** Is the pointer resting over (x, y) ± r right now? For hover fills. */
export const over = (p: { x: number; y: number }, x: number, y: number, r = 40) =>
  Math.abs(p.x - x) < r * 2.2 && Math.abs(p.y - y) < r * 0.6
