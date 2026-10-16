/* Batas mundur · Bab 2 · PO → DC, narrated (Charon). One beat per sentence
   of src/narration/bk2.json, on the "How far back" page of
   reversibility-prototype.html.

   intro     PO-041026-010 has arrived: Count in progress
   form      Edit / Back while the count is typed; the arrival stays
   submit    Submit count → Count submitted (585 counted, 15 Not as Ordered)
   recall    the Recall row
   notyet    its tag: Not in the app — the rule, not a button
   recalled  Do it → back to Count in progress, Counted 0, the log keeps it
             as Recalled
   same      … the new count is for the same arrival
   recount   submitted again → the reviewer asks for a Recount → submitted
   accept    Partial receive or Close short
   stock     Partial receive → Accepted · stock recorded (585, 15 open)
   line      the red Point of no return; Recall Locked, Why not / Instead
   instead   new evidence, or Inventory checks
   return    Return PO for the 15 wrong pieces
   rest      the 15 still open on the PO; Close short would close them */
import { AbsoluteFill } from "remotion"
import { EASE_IN_OUT, press, progress, tween } from "../../motion"
import narration from "../../narration/bk2.json"
import durations from "../../narration/bk2.durations.json"
import { useT } from "../../timing"
import { Camera, type Rect, type Shot } from "../../ui/Camera"
import { Pointer } from "../../ui/kit"
import { Band, BUYER, Caption, GUDANG } from "../../ui/Overlay"
import {
  Activity,
  DocCard,
  HowFarWindow,
  StageCard,
  StageRail,
  doIt,
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
import { ACCEPTED, CHAPTERS, COUNTING, PO_BND, PO_DOC, PO_STAGES, SUBMITTED } from "./data"

const MINS = { recount: 180, accept: 170, stock: 130, line: 170, rest: 240 }
const L = layout(narration, durations, MINS)
const END = 30
export const BK2_LEN = L.total + END
export const BK2_BEATS = L.start
const b = L.start

/* ── When things happen ─────────────────────────────────────────────── */

const SUBMIT1 = b.submit + 22
const RECALL = b.recalled + 20
const SUBMIT2 = b.recount + 16
const RECOUNT = b.recount + 56
const SUBMIT3 = b.recount + 124
const ACCEPT = b.stock + 6
const RETURN = b.return + 30

/** The card the page shows from each moment on, and where the rail is. */
const CHANGES: { at: number; view: StageView; rail: number }[] = [
  { at: -100, view: COUNTING, rail: 2 },
  { at: SUBMIT1, view: SUBMITTED, rail: 3 },
  { at: RECALL, view: COUNTING, rail: 2 },
  { at: SUBMIT2, view: SUBMITTED, rail: 3 },
  { at: RECOUNT, view: COUNTING, rail: 2 },
  { at: SUBMIT3, view: SUBMITTED, rail: 3 },
  { at: ACCEPT, view: ACCEPTED, rail: 5 },
]

/** A figure that steps from value to value, counting over 14 frames. */
const figure = (t: number, steps: readonly [number, number][]) => {
  let v = steps[0][1]
  for (let i = 1; i < steps.length; i++) {
    const [at, to] = steps[i]
    if (t < at) break
    v = Math.round(tween(t, [at, at + 14], [v, to]))
  }
  return v
}

const SUBMIT_LOG = "Operations submitted the count: 585 counted, 15 Not as Ordered"

/* ── Window points and shots ────────────────────────────────────────── */

const P = {
  rest: { x: 1180, y: 760 },
  submit: nextBtn(COUNTING),
  recall: doIt(SUBMITTED, 0),
  recount: doIt(SUBMITTED, 1),
  partial: doIt(SUBMITTED, 3),
  returnPo: doIt(ACCEPTED, 3),
}

const WHOLE: Rect = { x: 90, y: 8, w: 1260, h: 872 }
const TOP: Rect = { x: 96, y: 52, w: 1248, h: 290 }
const UPPER: Rect = { x: 96, y: 52, w: 1248, h: 610 }
const COUNT_CARD: Rect = { x: 96, y: 316, w: 752, h: 330 }
const ROWS: Rect = { x: 96, y: 330, w: 752, h: 420 }
const TAG: Rect = { x: 96, y: 380, w: 752, h: 240 }
const LOG: Rect = { x: 700, y: 300, w: 740, h: 340 }
const RAIL_BND: Rect = { x: 600, y: 190, w: 740, h: 150 }
const LOCKED: Rect = { x: 96, y: 420, w: 752, h: 200 }
const INSTEAD: Rect = { x: 96, y: 520, w: 752, h: 220 }
const LOWER: Rect = { x: 96, y: 300, w: 1248, h: 580 }
const OPEN_REST: Rect = { x: 96, y: 560, w: 752, h: 300 }

const SHOTS: Shot[] = [
  { at: 0, rect: WHOLE },
  { at: b.intro + 64, len: 30, rect: TOP },
  { at: b.form, len: 26, rect: COUNT_CARD },
  { at: b.submit, len: 22, rect: UPPER },
  { at: b.recall, len: 24, rect: ROWS },
  { at: b.notyet + 4, len: 20, rect: TAG },
  { at: b.recalled, len: 22, rect: WHOLE },
  { at: b.recalled + 64, len: 24, rect: LOG },
  { at: b.recount, len: 24, rect: LOWER },
  { at: b.accept, len: 22, rect: ROWS },
  { at: b.stock, len: 20, rect: UPPER },
  { at: b.line, len: 24, rect: RAIL_BND },
  { at: b.line + 74, len: 24, rect: LOCKED },
  { at: b.instead, len: 22, rect: INSTEAD },
  { at: b.return, len: 22, rect: LOWER },
  { at: b.rest, len: 26, rect: TOP },
  { at: b.rest + 64, len: 26, rect: OPEN_REST },
]

export function Bk2Po() {
  const t = useT()

  /* The card on show, the one leaving, and the rail's highlight. */
  let i = 0
  while (i + 1 < CHANGES.length && t >= CHANGES[i + 1].at) i++
  const now = CHANGES[i]
  const before = i > 0 ? CHANGES[i - 1] : undefined
  const out = before ? progress(t, now.at, now.at + 5) : 1
  const showing = before && out < 1 ? before.view : now.view
  const k = before && out < 1 ? 1 - out : progress(t, now.at + 3, now.at + 17)
  const railAt = before
    ? tween(t, [now.at, now.at + 16], [before.rail, now.rail], EASE_IN_OUT)
    : now.rail

  const counted = figure(t, [[0, 0], [SUBMIT1, 585], [RECALL, 0], [SUBMIT2, 585], [RECOUNT, 0], [SUBMIT3, 585]])
  const nao = figure(t, [[0, 0], [SUBMIT1, 15], [RECALL, 0], [SUBMIT2, 15], [RECOUNT, 0], [SUBMIT3, 15]])
  const accepted = figure(t, [[0, 0], [ACCEPT, 585]])
  const open = figure(t, [[0, 600], [ACCEPT, 15]])

  const status = now.view.label
  const back = now.view.back

  /* Activity, newest last; the marked phrase follows the narration. */
  const recallEm =
    t < b.same ? "It stays in history as Recalled. Stock did not change." : "The new count is for the same arrival"
  const LOGS: LogEntry[] = [
    { at: -100, time: "09:04", text: "Buying submitted the PO", who: "Buying", verb: "Submit" },
    { at: -100, time: "09:31", text: "Goods arrived at the DC", who: "Operations", verb: "Arrival" },
    { at: SUBMIT1, time: "09:58", text: SUBMIT_LOG, who: "Counter", verb: "Submit" },
    {
      at: RECALL,
      time: "10:06",
      text: "Count recalled by the counter. It stays in history as Recalled. Stock did not change. The new count is for the same arrival",
      who: "Counter",
      verb: "Recall",
      em: recallEm,
    },
    { at: SUBMIT2, time: "10:14", text: SUBMIT_LOG, who: "Counter", verb: "Submit" },
    { at: RECOUNT, time: "10:22", text: "Recount asked for the same arrival. The old count stays", who: "Reviewer", verb: "Recount" },
    { at: SUBMIT3, time: "10:35", text: SUBMIT_LOG, who: "Counter", verb: "Submit" },
    { at: ACCEPT, time: "10:41", text: "Receipt and stock recorded for 585. The rest of the PO stays open", who: "Reviewer", verb: "Partial receive" },
    { at: RETURN, time: "10:47", text: "Return PO raised for 15 pcs. Nothing is reopened", who: "Buying", verb: "Correct" },
  ]
  const mark =
    t < b.same
      ? progress(t, b.recalled + 80, b.recalled + 96)
      : progress(t, b.same + 8, b.same + 24)

  /* Rows talked about. */
  const glow = (from: number, to: number) => progress(t, from, from + 10) * (1 - progress(t, to, to + 8))
  const looks: Record<number, RowLook> = {}
  if (showing === COUNTING && t < b.submit) {
    looks[0] = { glow: glow(b.form + 30, b.submit) }
    looks[1] = { glow: glow(b.form + 30, b.submit) }
  }
  if (showing === SUBMITTED) {
    looks[0] = {
      glow: glow(b.recall + 16, b.recalled + 26),
      tag: progress(t, b.notyet + 20, b.notyet + 32) * (1 - progress(t, b.recalled, b.recalled + 8)),
      hot: t > RECALL - 10 && t < RECALL + 2,
      pressed: press(t, RECALL),
    }
    looks[1] = { hot: t > RECOUNT - 10 && t < RECOUNT + 2, pressed: press(t, RECOUNT) }
    looks[3] = { glow: glow(b.accept + 24, ACCEPT + 2), hot: t > ACCEPT - 30 && t < ACCEPT + 2, pressed: press(t, ACCEPT) }
    looks[4] = { glow: glow(b.accept + 24, ACCEPT + 2) }
  }
  if (showing === ACCEPTED) {
    looks[0] = { glow: glow(b.line + 90, b.instead) }
    looks[1] = { glow: glow(b.instead + 12, b.return) }
    looks[2] = { glow: glow(b.instead + 12, b.return) }
    looks[3] = { glow: glow(b.return + 4, b.rest), hot: t > RETURN - 12 && t < RETURN + 2, pressed: press(t, RETURN) }
    looks[4] = { glow: glow(b.rest + 168, BK2_LEN + 10) }
  }
  const submits = [SUBMIT1, SUBMIT2, SUBMIT3]
  const nextLook =
    showing === COUNTING
      ? {
          hot: submits.some((s) => t > s - 10 && t < s + 2),
          pressed: submits.map((s) => press(t, s)).reduce((a, c) => Math.min(a, c), 1),
        }
      : showing === ACCEPTED
        ? { glow: glow(b.rest + 70, b.rest + 168) }
        : undefined

  const CLICKS = [SUBMIT1, RECALL, SUBMIT2, RECOUNT, SUBMIT3, ACCEPT, RETURN]
  const p = pointerAt(
    t,
    [
      { at: 0, ...P.rest },
      { at: b.submit + 4, ...P.submit, len: 16 },
      { at: b.recall + 30, ...P.rest, len: 20 },
      { at: b.recalled + 2, ...P.recall, len: 14 },
      { at: b.recalled + 40, ...P.rest, len: 20 },
      { at: b.recount + 2, ...P.submit, len: 12 },
      { at: b.recount + 30, ...P.recount, len: 16 },
      { at: b.recount + 100, ...P.submit, len: 14 },
      { at: b.accept + 60, ...P.partial, len: 16 },
      { at: ACCEPT + 20, ...P.rest, len: 20 },
      { at: b.return + 8, ...P.returnPo, len: 16 },
      { at: RETURN + 30, ...P.rest, len: 20 },
    ],
    CLICKS
  )

  const who =
    (t >= RECOUNT - 26 && t < b.recount + 96) || (t >= b.accept && t < b.return) ? BUYER : GUDANG
  const pageIn = progress(t, 0, 14)

  return (
    <Frame>
      <AbsoluteFill style={{ opacity: pageIn, scale: String(0.985 + 0.015 * pageIn) }}>
        <Camera t={t} shots={SHOTS}>
          <HowFarWindow overlay={<Pointer {...p} opacity={progress(t, 20, 30)} />}>
            <DocCard
              doc={PO_DOC.doc}
              party={PO_DOC.party}
              status={status}
              back={back}
              figs={[
                ["Ordered", 600],
                ["Counted", counted],
                ["Accepted", accepted],
                ["Not as Ordered", nao],
                ["Open on the PO", open],
              ]}
              hot={
                t >= b.rest
                  ? [4, progress(t, b.rest + 10, b.rest + 24)]
                  : t >= b.stock
                    ? [2, progress(t, ACCEPT + 14, ACCEPT + 26) * (1 - progress(t, b.line, b.line + 10))]
                    : undefined
              }
            />
            <StageRail
              stages={PO_STAGES}
              at={railAt}
              bnd={PO_BND}
              pulse={Math.sin(Math.PI * progress(t, b.line + 14, b.line + 64, (n) => n))}
            />
            <StageCard stage={showing} k={k} looks={looks} nextLook={nextLook} />
            <Activity t={t} entries={LOGS} mark={mark} />
          </HowFarWindow>
        </Camera>
      </AbsoluteFill>
      <Caption t={t} lines={L.captions} />
      <Band chapter={2} of={5} title="PO → DC" who={who} steps={CHAPTERS} at={1} done={1} />
      <Voice chapter="bk2" ids={narration.map((line) => line.id)} start={b} />
      <Sfx
        cues={[
          ...clicks(CLICKS, 0.4),
          { at: ACCEPT + 10, src: SFX.ding, volume: 0.25 },
          { at: b.line + 14, src: SFX.tick, volume: 0.3 },
        ]}
      />
    </Frame>
  )
}
