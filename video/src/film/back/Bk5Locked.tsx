/* Batas mundur · Bab 5 · Yang tidak bisa mundur, narrated (Charon). The
   prototype's "Cannot go back" table, its "Partly processed" note, then two
   of its edge cases, and the mark.

   intro    the eight rows arrive
   list1    accepted count, receipt that moved stock, shipment In transit
   list2    store or DC receipt after Submit, finished documents
   list3    posted loss or adjustment, goods at the supplier, closed settlement
   partly   the limit is only for the processed part
   race     Recall at the same time as Accept: one wins
   retry    a retry with the same key: the same result */
import { AbsoluteFill } from "remotion"
import { EASE_OUT, press, progress } from "../../motion"
import narration from "../../narration/bk5.json"
import durations from "../../narration/bk5.durations.json"
import { useT } from "../../timing"
import { Camera, type Rect, type Shot } from "../../ui/Camera"
import { BrandMark, Pointer } from "../../ui/kit"
import { Band, Caption } from "../../ui/Overlay"
import { EdgeCard, HowFarWindow, RuleNote, RuleTable } from "../../ui/howfar"
import { layout } from "../beats"
import { pointerAt } from "../cursor"
import { Frame } from "../Frame"
import { SFX, Sfx, clicks } from "../Sfx"
import { Voice } from "../Voice"
import { CHAPTERS, LOCKED_H, LOCKED_ROWS, PARTLY } from "./data"
import { glowOf } from "./flow"

const MINS = { intro: 100, race: 230, retry: 220 }
const L = layout(narration, durations, MINS)
const END = 110
export const BK5_LEN = L.total + END
export const BK5_BEATS = L.start
const b = L.start

const SWAP = b.race
const RECALL_FIRST = b.race + 56
const ACCEPT_FIRST = b.race + 150
const RETRIES = [b.retry + 40, b.retry + 84, b.retry + 120]

const CARD1 = { x: 110, y: 72, w: 603, h: 320 }
const CARD2 = { x: 727, y: 72, w: 603, h: 320 }
const P = {
  rest: { x: 1180, y: 760 },
  recallFirst: { x: 226, y: 240 },
  acceptFirst: { x: 414, y: 240 },
  retry: { x: 812, y: 238 },
}

const WHOLE: Rect = { x: 90, y: 8, w: 1260, h: 872 }
const TOP_ROWS: Rect = { x: 96, y: 56, w: 1248, h: 420 }
const LOW_ROWS: Rect = { x: 96, y: 330, w: 1248, h: 430 }
const EDGE1: Rect = { x: 96, y: 56, w: 640, h: 352 }
const EDGE2: Rect = { x: 712, y: 56, w: 640, h: 352 }
const SHOTS: Shot[] = [
  { at: 0, rect: WHOLE },
  { at: b.list1, len: 26, rect: TOP_ROWS },
  { at: b.list3, len: 26, rect: LOW_ROWS },
  { at: SWAP + 10, len: 26, rect: EDGE1 },
  { at: b.retry, len: 26, rect: EDGE2 },
]

export function Bk5Locked() {
  const t = useT()
  const pageIn = progress(t, 0, 14)
  const sw = progress(t, SWAP, SWAP + 20)
  const onEdge = sw >= 0.5
  const layerK = onEdge ? (sw - 0.5) * 2 : 1 - sw * 2

  const glow: Record<number, number> = {
    0: glowOf(t, b.list1 + 6, b.list2),
    1: glowOf(t, b.list1 + 70, b.list2),
    2: glowOf(t, b.list1 + 130, b.list2),
    3: glowOf(t, b.list2 + 6, b.list3),
    4: glowOf(t, b.list2 + 90, b.list3),
    5: glowOf(t, b.list3 + 6, b.partly),
    6: glowOf(t, b.list3 + 90, b.partly),
    7: glowOf(t, b.list3 + 150, b.partly),
  }

  const race =
    t < RECALL_FIRST + 2
      ? { text: "Press one.", k: 0.6 }
      : t < ACCEPT_FIRST + 2
        ? {
            text: "Recall won. The count is Recalled. The reviewer's Accept is refused: “This count was recalled by the counter”. The reviewer can ask for the new count.",
            good: true,
            k: progress(t, RECALL_FIRST + 2, RECALL_FIRST + 12),
          }
        : {
            text: "Accept won. Stock is recorded. The counter's Recall is refused: “This count was already accepted”. New evidence is the way now.",
            good: true,
            k: progress(t, ACCEPT_FIRST + 2, ACCEPT_FIRST + 12),
          }
  const n = RETRIES.filter((r) => t >= r + 2).length
  const last = RETRIES[Math.max(0, n - 1)]
  const retry =
    n === 0
      ? { text: "Submit the count.", k: 0.6 }
      : n === 1
        ? { text: "Count submitted. Stock booked once.", good: true, k: progress(t, last + 2, last + 12) }
        : {
            text: `Submitted ${n} times with the same key. The same result came back. Not a recall, not a second delivery, no second booking.`,
            good: true,
            k: progress(t, last + 2, last + 12),
          }

  const CLICKS = [RECALL_FIRST, ACCEPT_FIRST, ...RETRIES]
  const p = pointerAt(
    t,
    [
      { at: 0, ...P.rest },
      { at: RECALL_FIRST - 24, ...P.recallFirst, len: 18 },
      { at: ACCEPT_FIRST - 24, ...P.acceptFirst, len: 14 },
      { at: RETRIES[0] - 26, ...P.retry, len: 20 },
    ],
    CLICKS
  )

  const ending = L.total
  const out = progress(t, ending, ending + 12)
  const mark = progress(t, ending + 10, ending + 26, EASE_OUT)
  const word = progress(t, ending + 26, ending + 40, EASE_OUT)

  return (
    <Frame>
      <AbsoluteFill style={{ opacity: pageIn * (1 - out), scale: String(0.985 + 0.015 * pageIn) }}>
        <Camera t={t} shots={SHOTS}>
          <HowFarWindow
            title={onEdge ? "Edge cases" : "What cannot go back"}
            flow={null}
            overlay={<Pointer {...p} opacity={onEdge ? 1 : 0} />}
          >
            <div style={{ opacity: layerK }}>
              {onEdge ? (
                <>
                  <EdgeCard
                    {...CARD1}
                    title="Recall at the same time as Accept"
                    tag="Rule proposed"
                    rule="Only one action may win. The other is refused with the reason."
                    buttons={[
                      { label: "Counter recalls first", hot: t > RECALL_FIRST - 8 && t < RECALL_FIRST + 2, pressed: press(t, RECALL_FIRST) },
                      { label: "Reviewer accepts first", hot: t > ACCEPT_FIRST - 8 && t < ACCEPT_FIRST + 2, pressed: press(t, ACCEPT_FIRST) },
                    ]}
                    out={race}
                  />
                  <EdgeCard
                    {...CARD2}
                    title="Retry after a dropped connection"
                    tag="Rule proposed"
                    rule="The same idempotency key returns the same result."
                    buttons={[
                      {
                        label: "Submit again",
                        hot: RETRIES.some((r) => t > r - 8 && t < r + 2),
                        pressed: RETRIES.map((r) => press(t, r)).reduce((a, c) => Math.min(a, c), 1),
                      },
                    ]}
                    out={retry}
                  />
                </>
              ) : (
                <>
                  <RuleTable
                    head={["What", "Why it is locked", "Use instead"]}
                    rows={LOCKED_ROWS}
                    heights={LOCKED_H}
                    widths={[400, 400]}
                    glow={glow}
                    k={progress(t, 8, 48)}
                  />
                  <RuleNote
                    top={660}
                    lead="Partly processed."
                    text={PARTLY}
                    k={progress(t, b.partly, b.partly + 14)}
                    glow={progress(t, b.partly + 20, b.partly + 32)}
                  />
                </>
              )}
            </div>
          </HowFarWindow>
        </Camera>
      </AbsoluteFill>
      <Caption t={t} lines={L.captions} />
      <AbsoluteFill style={{ opacity: 1 - out }}>
        <Band chapter={5} of={5} title="Yang tidak bisa mundur" steps={CHAPTERS} at={4} done={4} />
      </AbsoluteFill>
      {out > 0 && (
        <AbsoluteFill className="items-center justify-center">
          <div className="flex items-center gap-7" style={{ opacity: mark, scale: String(0.94 + 0.06 * mark) }}>
            <BrandMark size={120} />
            <span
              className="text-[5.5rem] leading-none font-semibold tracking-[-0.035em] text-ink"
              style={{ opacity: word, translate: `${(1 - word) * -12}px 0px` }}
            >
              Central
            </span>
          </div>
        </AbsoluteFill>
      )}
      <Voice chapter="bk5" ids={narration.map((line) => line.id)} start={b} />
      <Sfx
        cues={[
          ...clicks(CLICKS, 0.4),
          { at: SWAP + 4, src: SFX.whoosh, volume: 0.25 },
          { at: ending + 26, src: SFX.ding, volume: 0.3 },
        ]}
      />
    </Frame>
  )
}
