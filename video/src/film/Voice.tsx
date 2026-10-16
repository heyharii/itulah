/* The narrator: each sentence's file, placed at its beat. */
import { Audio } from "@remotion/media"
import { Sequence, staticFile } from "remotion"
import { useF } from "../timing"
import { LEAD } from "./beats"

export function Voice({
  chapter,
  ids,
  start,
}: {
  chapter: string
  ids: readonly string[]
  start: Record<string, number>
}) {
  const f = useF()
  return (
    <>
      {ids.map((id) => (
        <Sequence key={id} from={f(start[id] + LEAD)} name={`voice ${id}`} layout="none">
          {/* Google's files peak at about −0.2 dB: brought down 2 dB so a
              click under a word cannot clip. */}
          <Audio src={staticFile(`vo/${chapter}/${id}.mp3`)} volume={0.8} />
        </Sequence>
      ))}
    </>
  )
}
