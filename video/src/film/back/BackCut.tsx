/* "Batas mundur alur barang": five chapters end to end, ending on the mark
   (Bab 5 ends on it). */
import { AbsoluteFill, Sequence } from "remotion"
import { useF } from "../../timing"
import { Bk1Verbs, BK1_LEN } from "./Bk1Verbs"
import { Bk2Po, BK2_LEN } from "./Bk2Po"
import { Bk3Store, BK3_LEN } from "./Bk3Store"
import { Bk4Return, BK4_LEN } from "./Bk4Return"
import { Bk5Locked, BK5_LEN } from "./Bk5Locked"

const CHAPTERS = [
  { name: "1 · Empat kata, satu aturan", len: BK1_LEN, C: Bk1Verbs },
  { name: "2 · PO → DC", len: BK2_LEN, C: Bk2Po },
  { name: "3 · DC → store", len: BK3_LEN, C: Bk3Store },
  { name: "4 · Retur", len: BK4_LEN, C: Bk4Return },
  { name: "5 · Yang tidak bisa mundur", len: BK5_LEN, C: Bk5Locked },
]

export const BACK_LEN = CHAPTERS.reduce((s, c) => s + c.len, 0)

export function BackCut() {
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
