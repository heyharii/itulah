/* Batas mundur · Bab 1 · Empat kata, satu aturan, narrated (Charon). The
   prototype's "Four verbs" page: one row lit per verb as it is named, then
   the rule underneath. */
import { AbsoluteFill } from "remotion"
import { progress } from "../../motion"
import narration from "../../narration/bk1.json"
import durations from "../../narration/bk1.durations.json"
import { useT } from "../../timing"
import { Camera, type Rect, type Shot } from "../../ui/Camera"
import { Band, Caption } from "../../ui/Overlay"
import { HowFarWindow, RuleNote, RuleTable } from "../../ui/howfar"
import { layout } from "../beats"
import { Frame } from "../Frame"
import { Voice } from "../Voice"
import { CHAPTERS, THE_RULE, VERBS, VERBS_H } from "./data"
import { glowOf } from "./flow"

const MINS = { intro: 100 }
const L = layout(narration, durations, MINS)
const END = 24
export const BK1_LEN = L.total + END
export const BK1_BEATS = L.start
const b = L.start

const WHOLE: Rect = { x: 90, y: 8, w: 1260, h: 872 }
const TABLE: Rect = { x: 96, y: 8, w: 1248, h: 575 }
const LOWER: Rect = { x: 96, y: 330, w: 1248, h: 380 }
const SHOTS: Shot[] = [
  { at: 0, rect: WHOLE },
  { at: b.back - 10, len: 28, rect: TABLE },
  { at: b.rule, len: 28, rect: LOWER },
]

export function Bk1Verbs() {
  const t = useT()
  const pageIn = progress(t, 0, 14)
  const glow: Record<number, number> = {
    0: glowOf(t, b.back + 4, b.recall),
    2: glowOf(t, b.recall + 4, b.cancel),
    4: glowOf(t, b.cancel + 4, b.moveback),
    5: glowOf(t, b.moveback + 4, b.others),
    1: glowOf(t, b.others + 30, b.rule),
    3: glowOf(t, b.others + 52, b.rule),
    6: glowOf(t, b.others + 78, b.rule),
  }
  return (
    <Frame>
      <AbsoluteFill style={{ opacity: pageIn, scale: String(0.985 + 0.015 * pageIn) }}>
        <Camera t={t} shots={SHOTS}>
          <HowFarWindow title="Four verbs, and one rule" flow={null}>
            <RuleTable
              head={["Action", "Changes what", "Limit"]}
              rows={VERBS}
              heights={VERBS_H}
              widths={[230, 420]}
              glow={glow}
              k={progress(t, 8, 44)}
            />
            <RuleNote
              top={590}
              lead="The rule."
              text={THE_RULE}
              k={progress(t, b.rule, b.rule + 14)}
              glow={progress(t, b.rule + 24, b.rule + 36)}
            />
          </HowFarWindow>
        </Camera>
      </AbsoluteFill>
      <Caption t={t} lines={L.captions} />
      <Band chapter={1} of={5} title="Empat kata, satu aturan" steps={CHAPTERS} at={0} done={0} />
      <Voice chapter="bk1" ids={narration.map((line) => line.id)} start={b} />
    </Frame>
  )
}
