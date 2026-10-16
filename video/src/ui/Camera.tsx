/* The camera. The hub window is drawn once at its real size, 1440 × 900, and
   the camera frames a rectangle of it into the stage — the whole window for
   an establishing shot, one field or one table row to read it. It only moves
   to point at something (the guide's rule), and moves with the hub's
   ease-in-out, which is the curve for things travelling on screen. Zoom is
   interpolated in log space so a push-in feels even all the way. */
import type { ReactNode } from "react"
import { EASE_IN_OUT, lerp, progress } from "../motion"
import { WINDOW } from "./AppWindow"

/** Where the window may be framed in the 1920 × 1080 picture. Below it sit
    the caption and the band. */
export const STAGE = { x: 80, y: 36, w: 1760, h: 800 }

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const FULL: Rect = { x: -40, y: -24, w: WINDOW.w + 80, h: WINDOW.h + 48 }

export interface Shot {
  /** Authored frame the move starts at. */
  at: number
  /** Frames the move takes. */
  len?: number
  rect: Rect
}

const fit = (r: Rect) => {
  const scale = Math.min(STAGE.w / r.w, STAGE.h / r.h)
  return { scale, cx: r.x + r.w / 2, cy: r.y + r.h / 2 }
}

/** The framing at frame t, given shots in order of `at`. */
export function frameAt(t: number, shots: readonly Shot[]) {
  let current = fit(shots[0].rect)
  for (let i = 1; i < shots.length; i++) {
    const shot = shots[i]
    const next = fit(shot.rect)
    const k = progress(t, shot.at, shot.at + (shot.len ?? 24), EASE_IN_OUT)
    if (k <= 0) break
    current = {
      scale: Math.exp(lerp(Math.log(current.scale), Math.log(next.scale), k)),
      cx: lerp(current.cx, next.cx, k),
      cy: lerp(current.cy, next.cy, k),
    }
  }
  return current
}

export function Camera({
  t,
  shots,
  children,
}: {
  t: number
  shots: readonly Shot[]
  children: ReactNode
}) {
  const { scale, cx, cy } = frameAt(t, shots)
  /* Framed in the stage's own coordinates, and clipped to it: pushed in, the
     window fills the stage and stops at its edge, so the caption and the
     band underneath always stand on clear ground. */
  const left = STAGE.w / 2 - cx * scale
  const top = STAGE.h / 2 - cy * scale
  return (
    <div
      className="absolute overflow-hidden rounded-[20px]"
      style={{ left: STAGE.x, top: STAGE.y, width: STAGE.w, height: STAGE.h }}
    >
      <div
        className="absolute"
        style={{
          left,
          top,
          width: WINDOW.w,
          height: WINDOW.h,
          scale: String(scale),
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** Where a point of the window lands in the 1920 × 1080 picture at frame t. */
export function toScreen(t: number, shots: readonly Shot[], p: { x: number; y: number }) {
  const { scale, cx, cy } = frameAt(t, shots)
  return {
    x: STAGE.x + STAGE.w / 2 + (p.x - cx) * scale,
    y: STAGE.y + STAGE.h / 2 + (p.y - cy) * scale,
    scale,
  }
}
