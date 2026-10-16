/* Fitting a chapter that was timed by hand to its narration, without
   retiming its animation.

   The chapter's own timeline is cut into segments, one per sentence. Each
   segment plays at normal speed from its start; when its sentence is longer
   than the segment, the picture holds on the segment's last frame until the
   sentence has been said, then the next segment starts. So nothing ever
   plays slow, the voice never talks over the next action, and the scene code
   keeps its authored frame numbers: it is handed `at(t)`, the authored frame
   for the real one. */
import { LEAD, type Durations, type NarrationLine } from "./beats"
import type { Cue } from "./Sfx"

const TAIL = 14

export interface Segment {
  /** The narration line spoken over it; none for a silent stretch. */
  id?: string
  /** Where it starts on the authored timeline. */
  from: number
}

export function makeWarp(
  segments: readonly Segment[],
  lines: readonly NarrationLine[],
  durations: Durations,
  authoredLength: number,
  fps = 30
) {
  const text = new Map(lines.map((line) => [line.id, line.text]))
  let at = 0
  const parts = segments.map((seg, i) => {
    const to = segments[i + 1]?.from ?? authoredLength
    const own = to - seg.from
    const spoken = seg.id ? LEAD + Math.ceil((durations[seg.id]?.seconds ?? 0) * fps) + TAIL : 0
    const part = { ...seg, to, own, start: at, len: Math.max(own, spoken) }
    at += part.len
    return part
  })
  const len = at

  /** The authored frame shown at real frame t. */
  const authored = (t: number) => {
    const part = parts.find((p) => t >= p.start && t < p.start + p.len) ?? parts[parts.length - 1]
    return part.from + Math.min(t - part.start, part.own - 0.5)
  }

  /** The real frame an authored frame plays at (for sound cues). */
  const real = (a: number) => {
    const part = parts.find((p) => a >= p.from && a < p.to) ?? parts[parts.length - 1]
    return part.start + (a - part.from)
  }

  const voiced = parts.filter((p) => p.id)
  return {
    len,
    authored,
    real,
    cues: (cues: readonly Cue[]) => cues.map((cue) => ({ ...cue, at: real(cue.at) })),
    voiceIds: voiced.map((p) => p.id!),
    voiceStart: Object.fromEntries(voiced.map((p) => [p.id!, p.start])),
    captions: voiced.map((p) => ({
      from: p.start + 2,
      to: p.start + p.len - 2,
      text: text.get(p.id!) ?? "",
    })),
  }
}

export type Warp = ReturnType<typeof makeWarp>
