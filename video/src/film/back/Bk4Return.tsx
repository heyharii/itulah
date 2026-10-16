/* Batas mundur · Bab 4 · Retur, narrated (Charon). Two documents on the
   "How far back" page: the store return RHO-000012 (C004 · Bumiayu), then
   the return to the supplier RS-00000007.

   ask       New return: the store does not make returns, MD asks → Submit
   sent      Store prepares, actual 15 → Pack and send 15: 5 stay open
   received  DC counts 15 of 15: complete, not a receiving shortage
   cancel    DC → supplier, Issued: Cancel frees the stock and reservation
   handed    Pick and pack → Hand over: the red line, Move back Locked
   settle    Settlement open: Replacement, Refund, Credit note, Close short */
import { AbsoluteFill } from "remotion"
import { press, progress } from "../../motion"
import narration from "../../narration/bk4.json"
import durations from "../../narration/bk4.durations.json"
import { useT } from "../../timing"
import { Camera, type Rect, type Shot } from "../../ui/Camera"
import { Pointer } from "../../ui/kit"
import { Band, BUYER, Caption, GUDANG, MD } from "../../ui/Overlay"
import {
  Activity,
  DocCard,
  HowFarWindow,
  StageCard,
  StageRail,
  nextBtn,
  type LogEntry,
  type RowLook,
  type StageView,
} from "../../ui/howfar"
import { layout } from "../beats"
import { pointerAt } from "../cursor"
import { Frame } from "../Frame"
import { SFX, Sfx, clicks } from "../Sfx"
import { Voice } from "../Voice"
import {
  CHAPTERS,
  RET_BND,
  RET_DCCOUNT,
  RET_DOC,
  RET_FORM,
  RET_PREPARE,
  RET_RECEIVED,
  RET_REQUESTED,
  RET_STAGES,
  RET_TRANSIT,
  SUP_BND,
  SUP_DOC,
  SUP_HANDED,
  SUP_ISSUED,
  SUP_PACKED,
  SUP_SETTLE,
  SUP_STAGES,
  TOKO_BUMIAYU,
} from "./data"
import { cardAt, figure, glowOf, type Change } from "./flow"

const MINS = { ask: 160, sent: 200, received: 200, cancel: 280, handed: 170, settle: 240 }
const L = layout(narration, durations, MINS)
const END = 24
export const BK4_LEN = L.total + END
export const BK4_BEATS = L.start
const b = L.start

/* Store return */
const SUBMIT_RET = b.ask + 70
const PREP = b.sent + 10
const SEND = b.sent + 86
const DCC = b.received + 10
const DCR = b.received + 56
/* Supplier return */
const SWAP = b.cancel
const PACKS = b.handed + 8
const HAND = b.handed + 50
const SETTLE = b.settle + 10

const RET: Change[] = [
  { at: -100, view: RET_FORM, rail: 0 },
  { at: SUBMIT_RET, view: RET_REQUESTED, rail: 1 },
  { at: PREP, view: RET_PREPARE, rail: 2 },
  { at: SEND, view: RET_TRANSIT, rail: 3 },
  { at: DCC, view: RET_DCCOUNT, rail: 4 },
  { at: DCR, view: RET_RECEIVED, rail: 5 },
]
const SUP: Change[] = [
  { at: -100, view: SUP_ISSUED, rail: 1 },
  { at: PACKS, view: SUP_PACKED, rail: 2 },
  { at: HAND, view: SUP_HANDED, rail: 3 },
  { at: SETTLE, view: SUP_SETTLE, rail: 4 },
]

const RET_LOGS: LogEntry[] = [
  { at: SUBMIT_RET, time: "08:30", text: "MD asked the store to return 20", who: "MD", verb: "Submit" },
  { at: PREP, time: "09:10", text: "The store started preparing", who: "Store", verb: "Prepare" },
  { at: SEND, time: "09:25", text: "Pack and send done: 15 of 20. The other 5 stay explicitly open", who: "Store", verb: "Send" },
  { at: DCC, time: "14:05", text: "The DC opened the count", who: "Operations", verb: "Count" },
  { at: DCR, time: "14:20", text: "DC counted 15 and submitted", who: "Operations", verb: "Submit" },
]
const SUP_LOGS: LogEntry[] = [
  { at: -100, time: "10:12", text: "Return confirmed and issued", who: "PO owner", verb: "Confirm" },
  { at: PACKS, time: "11:00", text: "Operations picked and packed 20", who: "Operations", verb: "Pack" },
  { at: HAND, time: "13:30", text: "Handed over to the supplier", who: "Operations", verb: "Hand over" },
  { at: SETTLE, time: "13:32", text: "Settlement opened: the supplier owes replacement, refund or a credit note", who: "Buying", verb: "Settle" },
]

const btn = (v: StageView) => ({ x: nextBtn(v).xs[0], y: nextBtn(v).y })
const P = {
  rest: { x: 1180, y: 760 },
  submitRet: btn(RET_FORM),
  prep: btn(RET_REQUESTED),
  send: btn(RET_PREPARE),
  dcc: btn(RET_TRANSIT),
  dcr: btn(RET_DCCOUNT),
  packs: btn(SUP_ISSUED),
  hand: btn(SUP_PACKED),
  settle: btn(SUP_HANDED),
}

const UPPER: Rect = { x: 96, y: 52, w: 1248, h: 610 }
const CARD: Rect = { x: 96, y: 316, w: 752, h: 330 }
const STAYS: Rect = { x: 96, y: 300, w: 752, h: 300 }
const RAIL: Rect = { x: 420, y: 190, w: 920, h: 150 }
const LOCKED: Rect = { x: 96, y: 380, w: 752, h: 260 }
const SETTLE_ROWS: Rect = { x: 96, y: 400, w: 752, h: 400 }
const SHOTS: Shot[] = [
  { at: 0, rect: UPPER },
  { at: b.ask + 90, len: 24, rect: CARD },
  { at: b.sent, len: 22, rect: UPPER },
  { at: b.received, len: 22, rect: UPPER },
  { at: DCR + 40, len: 24, rect: STAYS },
  { at: b.cancel, len: 22, rect: UPPER },
  { at: b.cancel + 70, len: 24, rect: CARD },
  { at: b.handed, len: 22, rect: UPPER },
  { at: HAND + 16, len: 22, rect: RAIL },
  { at: HAND + 70, len: 22, rect: LOCKED },
  { at: b.settle, len: 22, rect: UPPER },
  { at: SETTLE + 30, len: 24, rect: SETTLE_ROWS },
]

export function Bk4Return() {
  const t = useT()
  const sw = progress(t, SWAP, SWAP + 20)
  const onSup = sw >= 0.5
  const layerK = onSup ? (sw - 0.5) * 2 : 1 - sw * 2
  const { now, showing, k, railAt } = cardAt(t, onSup ? SUP : RET)

  const looks: Record<number, RowLook> = {}
  let staysGlow = 0
  if (showing === RET_FORM) staysGlow = glowOf(t, b.ask + 10, SUBMIT_RET - 4)
  if (showing === RET_PREPARE) looks[0] = { glow: glowOf(t, b.sent + 26, SEND), tag: glowOf(t, b.sent + 26, SEND) }
  if (showing === RET_RECEIVED) staysGlow = glowOf(t, DCR + 50, SWAP)
  if (showing === SUP_ISSUED) {
    looks[0] = { glow: glowOf(t, b.cancel + 90, PACKS), tag: glowOf(t, b.cancel + 90, PACKS) }
    staysGlow = glowOf(t, b.cancel + 150, PACKS)
  }
  if (showing === SUP_HANDED) looks[0] = { glow: glowOf(t, HAND + 80, SETTLE) }
  if (showing === SUP_SETTLE) {
    looks[0] = { glow: glowOf(t, b.settle + 70, BK4_LEN + 10) }
    looks[1] = { glow: glowOf(t, b.settle + 96, BK4_LEN + 10) }
    looks[2] = { glow: glowOf(t, b.settle + 118, BK4_LEN + 10) }
    looks[3] = { glow: glowOf(t, b.settle + 150, BK4_LEN + 10) }
  }
  const presses = [SUBMIT_RET, PREP, SEND, DCC, DCR, PACKS, HAND, SETTLE]
  const nextLook = {
    hot: presses.some((s) => t > s - 10 && t < s + 2),
    pressed: presses.map((s) => press(t, s)).reduce((a, c) => Math.min(a, c), 1),
  }

  const p = pointerAt(
    t,
    [
      { at: 0, ...P.rest },
      { at: SUBMIT_RET - 22, ...P.submitRet, len: 16 },
      { at: PREP - 12, ...P.prep, len: 10 },
      { at: SEND - 22, ...P.send, len: 16 },
      { at: DCC - 12, ...P.dcc, len: 10 },
      { at: DCR - 20, ...P.dcr, len: 14 },
      { at: DCR + 20, ...P.rest, len: 20 },
      { at: PACKS - 12, ...P.packs, len: 10 },
      { at: HAND - 22, ...P.hand, len: 16 },
      { at: HAND + 20, ...P.rest, len: 20 },
      { at: SETTLE - 12, ...P.settle, len: 10 },
      { at: SETTLE + 20, ...P.rest, len: 20 },
    ],
    presses
  )

  const who =
    t < b.sent ? MD : t < b.received ? TOKO_BUMIAYU : t < b.cancel ? GUDANG : t < b.handed ? BUYER : t < b.settle ? GUDANG : BUYER
  const pageIn = progress(t, 0, 14)

  const doc = onSup ? (
    <DocCard
      doc={SUP_DOC.doc}
      party={SUP_DOC.party}
      status={now.view.label}
      back={now.view.back}
      figs={[
        ["Asked", 20],
        ["Handed over", figure(t, [[0, 0], [HAND, 20]])],
        ["Settled", 0],
        ["Settlement open", figure(t, [[0, 0], [SETTLE, 20]])],
      ]}
    />
  ) : (
    <DocCard
      doc={RET_DOC.doc}
      party={RET_DOC.party}
      status={now.view.label}
      back={now.view.back}
      figs={[
        ["Asked", 20],
        ["Sent", figure(t, [[0, 0], [SEND, 15]])],
        ["Received", figure(t, [[0, 0], [DCR, 15]])],
        ["Still open", figure(t, [[0, 20], [SEND, 5]])],
        ["Receiving shortage", 0],
      ]}
      hot={
        t >= b.sent && t < b.received
          ? [3, progress(t, SEND + 14, SEND + 26)]
          : t >= DCR && t < SWAP
            ? [4, progress(t, DCR + 14, DCR + 26)]
            : undefined
      }
    />
  )

  return (
    <Frame>
      <AbsoluteFill style={{ opacity: pageIn, scale: String(0.985 + 0.015 * pageIn) }}>
        <Camera t={t} shots={SHOTS}>
          <HowFarWindow flow={onSup ? 3 : 2} overlay={<Pointer {...p} opacity={progress(t, 20, 30)} />}>
            <div style={{ opacity: layerK }}>
              {doc}
              <StageRail
                stages={onSup ? SUP_STAGES : RET_STAGES}
                at={railAt}
                bnd={onSup ? SUP_BND : RET_BND}
                pulse={onSup ? Math.sin(Math.PI * progress(t, HAND + 20, HAND + 70, (n) => n)) : 0}
              />
              <StageCard stage={showing} k={k} looks={looks} nextLook={nextLook} staysGlow={staysGlow} />
              <Activity t={t} entries={onSup ? SUP_LOGS : RET_LOGS} />
            </div>
          </HowFarWindow>
        </Camera>
      </AbsoluteFill>
      <Caption t={t} lines={L.captions} />
      <Band chapter={4} of={5} title="Retur" who={who} steps={CHAPTERS} at={3} done={3} />
      <Voice chapter="bk4" ids={narration.map((line) => line.id)} start={b} />
      <Sfx
        cues={[
          ...clicks(presses, 0.4),
          { at: SWAP + 4, src: SFX.whoosh, volume: 0.25 },
          { at: HAND + 20, src: SFX.tick, volume: 0.3 },
        ]}
      />
    </Frame>
  )
}
