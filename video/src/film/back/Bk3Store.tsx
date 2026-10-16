/* Batas mundur · Bab 3 · DC → toko, narrated (Charon). ALT-00000004 for
   C001 · Cikupa on the "How far back" page.

   pick      Picked: Move back to the racks → Pack → Unpack to Picked
   part      Dispatch part (40): Part sent; Cancel the sent 40 is Locked
   rest      the unsent 60: Move back, or MD's Close remaining
   transit   Dispatch the rest → In transit, the red line; nothing moves back
   count     Store starts counting → Submit count: 98 of 100, Completed
   receipt   Recall the receipt Locked; Recount, Inventory checks the 2 pcs
   closed    Close the allotment: not reopened; Return to HO or a new one */
import { AbsoluteFill } from "remotion"
import { press, progress } from "../../motion"
import narration from "../../narration/bk3.json"
import durations from "../../narration/bk3.durations.json"
import { useT } from "../../timing"
import { Camera, type Rect, type Shot } from "../../ui/Camera"
import { Pointer } from "../../ui/kit"
import { Band, Caption, GUDANG, MD } from "../../ui/Overlay"
import { Activity, DocCard, HowFarWindow, StageCard, StageRail, nextBtn, type LogEntry, type RowLook } from "../../ui/howfar"
import { layout } from "../beats"
import { pointerAt } from "../cursor"
import { Frame } from "../Frame"
import { SFX, Sfx, clicks } from "../Sfx"
import { Voice } from "../Voice"
import {
  CHAPTERS,
  DC_BND,
  DC_COMPLETED,
  DC_DOC,
  DC_DONE,
  DC_PACKED,
  DC_PARTSENT,
  DC_PICKED,
  DC_RECEIVING,
  DC_STAGES,
  DC_TRANSIT,
  TOKO_CIKUPA,
} from "./data"
import { cardAt, figure, glowOf, type Change } from "./flow"

const MINS = { pick: 240, part: 190, rest: 170, transit: 180, count: 180, receipt: 230, closed: 210 }
const L = layout(narration, durations, MINS)
const END = 24
export const BK3_LEN = L.total + END
export const BK3_BEATS = L.start
const b = L.start

const PACK = b.pick + 110
const PART = b.part + 24
const REST = b.transit + 14
const COUNTING = b.count + 14
const SUBMIT = b.count + 96
const CLOSE = b.closed + 30

const CHANGES: Change[] = [
  { at: -100, view: DC_PICKED, rail: 2 },
  { at: PACK, view: DC_PACKED, rail: 3 },
  { at: PART, view: DC_PARTSENT, rail: 4 },
  { at: REST, view: DC_TRANSIT, rail: 5 },
  { at: COUNTING, view: DC_RECEIVING, rail: 6 },
  { at: SUBMIT, view: DC_COMPLETED, rail: 7 },
  { at: CLOSE, view: DC_DONE, rail: 8 },
]

const LOGS: LogEntry[] = [
  { at: -100, time: "08:40", text: "MD submitted the allotment", who: "MD", verb: "Submit" },
  { at: -100, time: "09:02", text: "Operations picked 100", who: "Operations", verb: "Pick" },
  { at: PACK, time: "09:20", text: "Operations packed 100", who: "Operations", verb: "Pack" },
  { at: PART, time: "09:41", text: "Trip left with 40 pcs. The rest waits", who: "Operations", verb: "Dispatch" },
  { at: REST, time: "10:15", text: "The rest left on a second trip", who: "Operations", verb: "Dispatch" },
  { at: COUNTING, time: "13:02", text: "The store opened the count", who: "Store counter", verb: "Count" },
  { at: SUBMIT, time: "13:20", text: "Store counted 98 of 100 and submitted", who: "Store counter", verb: "Submit" },
  { at: CLOSE, time: "13:45", text: "Allotment closed", who: "MD", verb: "Close" },
]

const btn = (v: typeof DC_PICKED, i = 0) => ({ x: nextBtn(v).xs[i], y: nextBtn(v).y })
const P = {
  rest: { x: 1180, y: 760 },
  pack: btn(DC_PICKED),
  part: btn(DC_PACKED, 1),
  sendRest: btn(DC_PARTSENT),
  storeCounts: btn(DC_TRANSIT),
  submit: btn(DC_RECEIVING),
  close: btn(DC_COMPLETED),
}

const UPPER: Rect = { x: 96, y: 52, w: 1248, h: 610 }
const PICKED_ROWS: Rect = { x: 96, y: 316, w: 752, h: 420 }
const PART_ROWS: Rect = { x: 96, y: 400, w: 752, h: 360 }
const RAIL: Rect = { x: 560, y: 190, w: 780, h: 150 }
const TRANSIT_ROWS: Rect = { x: 96, y: 400, w: 752, h: 340 }
const DONE_ROWS: Rect = { x: 96, y: 400, w: 752, h: 420 }
const SHOTS: Shot[] = [
  { at: 0, rect: UPPER },
  { at: b.pick + 14, len: 24, rect: PICKED_ROWS },
  { at: b.part, len: 22, rect: UPPER },
  { at: b.part + 60, len: 24, rect: PART_ROWS },
  { at: b.transit, len: 22, rect: RAIL },
  { at: b.transit + 80, len: 24, rect: TRANSIT_ROWS },
  { at: b.count, len: 22, rect: UPPER },
  { at: b.receipt, len: 24, rect: DONE_ROWS },
  { at: b.closed, len: 22, rect: UPPER },
  { at: CLOSE + 50, len: 24, rect: PART_ROWS },
]

export function Bk3Store() {
  const t = useT()
  const { now, showing, k, railAt } = cardAt(t, CHANGES)

  const looks: Record<number, RowLook> = {}
  if (showing === DC_PICKED) looks[0] = { glow: glowOf(t, b.pick + 30, PACK) }
  if (showing === DC_PACKED) looks[0] = { glow: glowOf(t, PACK + 20, b.part + 6) }
  if (showing === DC_PARTSENT) {
    looks[2] = { glow: glowOf(t, b.part + 76, b.rest) }
    looks[0] = { glow: glowOf(t, b.rest + 10, REST) }
    looks[1] = { glow: glowOf(t, b.rest + 60, REST) }
  }
  if (showing === DC_TRANSIT) {
    looks[0] = { glow: glowOf(t, b.transit + 96, COUNTING) }
    looks[1] = { glow: glowOf(t, b.transit + 96, COUNTING) }
  }
  if (showing === DC_COMPLETED) {
    looks[0] = { glow: glowOf(t, b.receipt + 20, CLOSE) }
    looks[1] = { glow: glowOf(t, b.receipt + 130, CLOSE) }
    looks[2] = { glow: glowOf(t, b.receipt + 150, CLOSE) }
  }
  if (showing === DC_DONE) {
    looks[0] = { glow: glowOf(t, CLOSE + 30, BK3_LEN + 10) }
    looks[1] = { glow: glowOf(t, b.closed + 120, BK3_LEN + 10) }
    looks[2] = { glow: glowOf(t, b.closed + 140, BK3_LEN + 10) }
  }
  const presses = [PACK, PART, REST, COUNTING, SUBMIT, CLOSE]
  const nextLook = {
    hot: presses.some((s) => t > s - 10 && t < s + 2),
    pressed: presses.map((s) => press(t, s)).reduce((a, c) => Math.min(a, c), 1),
  }

  const p = pointerAt(
    t,
    [
      { at: 0, ...P.rest },
      { at: PACK - 22, ...P.pack, len: 16 },
      { at: PACK + 20, ...P.rest, len: 20 },
      { at: PART - 22, ...P.part, len: 16 },
      { at: PART + 20, ...P.rest, len: 20 },
      { at: REST - 18, ...P.sendRest, len: 14 },
      { at: REST + 20, ...P.rest, len: 20 },
      { at: COUNTING - 14, ...P.storeCounts, len: 12 },
      { at: SUBMIT - 22, ...P.submit, len: 16 },
      { at: SUBMIT + 20, ...P.rest, len: 20 },
      { at: CLOSE - 22, ...P.close, len: 16 },
      { at: CLOSE + 20, ...P.rest, len: 20 },
    ],
    presses
  )

  const who =
    t < b.rest ? GUDANG : t < b.transit ? MD : t < COUNTING ? GUDANG : t < b.closed ? TOKO_CIKUPA : MD
  const pageIn = progress(t, 0, 14)

  return (
    <Frame>
      <AbsoluteFill style={{ opacity: pageIn, scale: String(0.985 + 0.015 * pageIn) }}>
        <Camera t={t} shots={SHOTS}>
          <HowFarWindow flow={1} overlay={<Pointer {...p} opacity={progress(t, 20, 30)} />}>
            <DocCard
              doc={DC_DOC.doc}
              party={DC_DOC.party}
              status={now.view.label}
              back={now.view.back}
              figs={[
                ["Allotted", 100],
                ["Picked", 100],
                ["Packed", figure(t, [[0, 0], [PACK, 100]])],
                ["Sent", figure(t, [[0, 0], [PART, 40], [REST, 100]])],
                ["Received", figure(t, [[0, 0], [SUBMIT, 98]])],
                ["Can still change", figure(t, [[0, 100], [PART, 60], [REST, 0]])],
              ]}
              hot={
                t >= b.part && t < b.transit
                  ? [3, progress(t, PART + 14, PART + 26)]
                  : t >= SUBMIT && t < b.receipt
                    ? [4, progress(t, SUBMIT + 14, SUBMIT + 26)]
                    : undefined
              }
            />
            <StageRail
              stages={DC_STAGES}
              at={railAt}
              bnd={DC_BND}
              pulse={Math.sin(Math.PI * progress(t, REST + 10, REST + 60, (n) => n))}
            />
            <StageCard stage={showing} k={k} looks={looks} nextLook={nextLook} />
            <Activity t={t} entries={LOGS} />
          </HowFarWindow>
        </Camera>
      </AbsoluteFill>
      <Caption t={t} lines={L.captions} />
      <Band chapter={3} of={5} title="DC → store" who={who} steps={CHAPTERS} at={2} done={2} />
      <Voice chapter="bk3" ids={narration.map((line) => line.id)} start={b} />
      <Sfx cues={[...clicks(presses, 0.4), { at: REST + 10, src: SFX.tick, volume: 0.3 }]} />
    </Frame>
  )
}
