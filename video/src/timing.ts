import { useCurrentFrame, useVideoConfig } from "remotion"

/* Every scene is written in frames at 30 fps, the way the comments above each
   scene count them. The composition's fps lives in Root.tsx alone; these turn
   the real frame back into the authored one, so a 60 fps render changes how
   many samples there are, never when anything happens. (The Inspo teaser's
   pattern.) */
export const AUTHORED_FPS = 30

/** The current frame on the 30 fps scale the scenes are written in. */
export const useT = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (frame * AUTHORED_FPS) / fps
}

/** Authored frames → real frames, for Sequence bounds (whole numbers). */
export const useF = () => {
  const { fps } = useVideoConfig()
  return (authored: number) => Math.round((authored * fps) / AUTHORED_FPS)
}

/** Seconds → authored frames. */
export const s = (seconds: number) => Math.round(seconds * AUTHORED_FPS)
