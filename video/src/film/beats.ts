/* Narration drives the clock. A chapter is a list of beats, one sentence
   each; a beat lasts at least as long as its sentence takes to say (plus a
   breath either side), or longer when the action in it needs the time. Change
   a sentence, run scripts/narrate.mjs, and every beat after it moves. */
export interface NarrationLine {
  id: string
  text: string
}

export type Durations = Record<string, { seconds: number }>

/** Frames before the voice starts in a beat, and after it ends. */
export const LEAD = 6
const TAIL = 16

export function layout(
  lines: readonly NarrationLine[],
  durations: Durations,
  mins: Record<string, number>,
  fps = 30
) {
  const start: Record<string, number> = {}
  const len: Record<string, number> = {}
  let at = 0
  for (const line of lines) {
    const spoken = Math.ceil((durations[line.id]?.seconds ?? 0) * fps)
    start[line.id] = at
    len[line.id] = Math.max(mins[line.id] ?? 0, LEAD + spoken + TAIL)
    at += len[line.id]
  }
  const captions = lines.map((line) => ({
    from: start[line.id] + 2,
    to: start[line.id] + len[line.id] - 2,
    text: line.text,
  }))
  return { start, len, total: at, captions }
}
