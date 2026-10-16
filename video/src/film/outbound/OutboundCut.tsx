/* The outbound guide: five chapters end to end, from MD's allotment to the
   store's receipt, then the mark (Bab 5 ends on it). */
import { AbsoluteFill, Sequence } from "remotion"
import { useF } from "../../timing"
import { Ob1Create, OB1_LEN } from "./Ob1Create"
import { Ob2Work, OB2_LEN } from "./Ob2Work"
import { Ob3Edit, OB3_LEN } from "./Ob3Edit"
import { Ob4Cancel, OB4_LEN } from "./Ob4Cancel"
import { Ob5Short, OB5_LEN } from "./Ob5Short"

const CHAPTERS = [
  { name: "1 · MD membuat allotment", len: OB1_LEN, C: Ob1Create },
  { name: "2 · Gudang mengerjakan", len: OB2_LEN, C: Ob2Work },
  { name: "3 · MD mengubah jumlah", len: OB3_LEN, C: Ob3Edit },
  { name: "4 · MD membatalkan", len: OB4_LEN, C: Ob4Cancel },
  { name: "5 · Short pick", len: OB5_LEN, C: Ob5Short },
]

export const OUTBOUND_LEN = CHAPTERS.reduce((s, c) => s + c.len, 0)

export function OutboundCut() {
  const f = useF()
  let from = 0
  return (
    <AbsoluteFill>
      {CHAPTERS.map(({ name, len, C }) => {
        const at = from
        from += len
        return (
          <Sequence key={name} from={f(at)} durationInFrames={f(len)} name={name}>
            <C />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
