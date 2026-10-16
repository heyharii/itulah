/* The guide: five chapters end to end, ±2 min 50 s. Each chapter hands the
   rail's dot to the next where the last one left it. */
import { AbsoluteFill, Sequence } from "remotion"
import { useF } from "../timing"
import { Ch1NewPo, CH1_LEN } from "./Ch1NewPo"
import { Ch2Count, CH2_LEN } from "./Ch2Count"
import { Ch3Outcomes, CH3_LEN } from "./Ch3Outcomes"
import { Ch4Return, CH4_LEN } from "./Ch4Return"
import { Ch5Done, CH5_LEN } from "./Ch5Done"

const CHAPTERS = [
  { name: "1 · Membuat PO", len: CH1_LEN, C: Ch1NewPo },
  { name: "2 · Gudang menghitung", len: CH2_LEN, C: Ch2Count },
  { name: "3 · Tujuh hasil hitungan", len: CH3_LEN, C: Ch3Outcomes },
  { name: "4 · Return PO", len: CH4_LEN, C: Ch4Return },
  { name: "5 · Selesai", len: CH5_LEN, C: Ch5Done },
]

export const GUIDE_LEN = CHAPTERS.reduce((s, c) => s + c.len, 0)

export function GuideCut() {
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
