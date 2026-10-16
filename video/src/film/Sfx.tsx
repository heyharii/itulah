/* Sound, placed on the frame it belongs to (the Inspo teaser's pattern):
   a click where the pointer clicks, a whoosh scaled to how far something
   travels, a dry clack for a stamp, a soft ding when something lands. */
import { Audio } from "@remotion/media"
import { Sequence, staticFile } from "remotion"
import { useF } from "../timing"

/* @remotion/sfx's files (remotion.media), kept in public/sfx so a render
   never waits on — or fails for — the network. */
export const SFX = {
  click: staticFile("sfx/mouse-click.wav"),
  whoosh: staticFile("sfx/whoosh.wav"),
  stamp: staticFile("sfx/shutter-old.wav"),
  ding: staticFile("sfx/ding.wav"),
  tick: staticFile("sfx/switch.wav"),
}

export interface Cue {
  at: number
  src: string
  volume?: number
}

export const clicks = (frames: readonly number[], volume = 0.45): Cue[] =>
  frames.map((at) => ({ at, src: SFX.click, volume }))

export function Sfx({ cues }: { cues: readonly Cue[] }) {
  const f = useF()
  return (
    <>
      {cues.map((cue, i) => (
        <Sequence key={`${cue.at}-${i}`} from={f(cue.at)} name={`sfx ${cue.at}`} layout="none">
          <Audio src={cue.src} volume={cue.volume ?? 0.4} />
        </Sequence>
      ))}
    </>
  )
}
