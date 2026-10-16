/* Outbound · Bab 4 · MD membatalkan, narrated (Charon). One beat per
   sentence of src/narration/ob4.json.

   cancel     MD opens ALT-0410 (to pick, picked, packed and one on the road)
              → Cancel allotment
   costs      the dialog: To pick removed · Picked put back · Packed
              unpacked · Sent keeps going
   ack        the acknowledgement ticked, "Wrong store", Cancel allotment
   cancelled  MD sees Cancelled at once
   remove     the board: the To pick card's Remove picklist
   stamp      Picked and Packed carry the CANCELLED stamp; nothing moves on
   moveback   Move back (all, prefilled) → back to the racks, in stock */
import { AbsoluteFill } from "remotion"
import { press, progress } from "../../motion"
import narration from "../../narration/ob4.json"
import durations from "../../narration/ob4.durations.json"
import { useT } from "../../timing"
import { AppWindow } from "../../ui/AppWindow"
import { Camera, type Shot } from "../../ui/Camera"
import { Pointer, Veil } from "../../ui/kit"
import { Band, Caption, FrameToast, GUDANG, MD } from "../../ui/Overlay"
import { AllotmentList, AllotmentSheet, Board, MoveBackDialog, type AllotmentRow, type BoardCard, type StoreStage } from "../../ui/outbound"
import { CancelDialog } from "../../ui/outbound2"
import { layout } from "../beats"
import { pointerAt } from "../cursor"
import { Frame } from "../Frame"
import { SFX, Sfx, clicks } from "../Sfx"
import { Voice } from "../Voice"
import { ALLOTTED, BASE, NEW_0413, OB_STEPS } from "./data"

const MINS = { cancel: 130, costs: 90, ack: 120, cancelled: 80, remove: 100, stamp: 110, moveback: 150 }
const L = layout(narration, durations, MINS)
export const OB4_LEN = L.total + 20
export const OB4_BEATS = L.start
const b = L.start

const ROWS: AllotmentRow[] = [...ALLOTTED]

const STAGES: StoreStage[] = [
  { store: "Store Senayan", stage: "To pick", pcs: 60 },
  { store: "Store Bintaro", stage: "Picked", pcs: 120 },
  { store: "Store BSD", stage: "Packed", pcs: 150 },
  { store: "Store Kelapa Gading", stage: "On the road", pcs: 90, sj: "SJ-091026-002" },
]

/* ALT-0410 on the board, at the top of each lane it is in. */
const ALT0410: BoardCard[] = [
  { id: "x1", lane: "pick", store: "Store Senayan", ref: "ALT-0410", pcs: 60, meta: "3 SKUs" },
  { id: "x2", lane: "picked", store: "Store Bintaro", ref: "ALT-0410", pcs: 120, meta: "4 SKUs" },
  { id: "x3", lane: "packed", store: "Store BSD", ref: "ALT-0410", pcs: 150, meta: "2 koli" },
  { id: "x4", lane: "transit", store: "Store Kelapa Gading", ref: "SJ-091026-002", pcs: 90, meta: "1 koli" },
]
const REST = [
  ...BASE.filter((c) => c.ref !== "ALT-0410").map((c) => (c.id === "k1" ? { ...c, pcs: 250 } : c)),
  ...NEW_0413.slice(1),
]

const P = {
  rest: { x: 1100, y: 640 },
  row: { x: 520, y: 385 },
  cancelBtn: { x: 758, y: 848 },
  rows: { x: 720, y: 330 },
  ack: { x: 467, y: 498 },
  wrongStore: { x: 632, y: 604 },
  confirm: { x: 921, y: 675 },
  remove: { x: 226, y: 286 },
  bsd: { x: 740, y: 200 },
  moveBack: { x: 754, y: 286 },
  dlgOk: { x: 989, y: 668 },
}

export function Ob4Cancel() {
  const t = useT()
  const onBoard = t >= b.remove
  const fade = onBoard ? progress(t, b.remove, b.remove + 12) : 1

  /* MD */
  const sheet = progress(t, b.cancel + 22, b.cancel + 34)
  const dlg = progress(t, b.cancel + 74, b.cancel + 84) * (1 - progress(t, b.ack + 92, b.ack + 100))
  const ack = t >= b.ack + 14
  const reason = t >= b.ack + 44 ? 1 : undefined
  const cancelled = t >= b.ack + 96

  /* Warehouse */
  const removed = t >= b.remove + 46
  const movedBack = t >= b.moveback + 96
  const mvDlg = progress(t, b.moveback + 28, b.moveback + 38) * (1 - progress(t, b.moveback + 92, b.moveback + 100))
  const cards: BoardCard[] = [
    ...ALT0410.filter((c) => !(removed && c.id === "x1") && !(movedBack && c.id === "x3")).map((c) =>
      c.lane === "transit" ? c : { ...c, cancelled: true }
    ),
    ...REST,
  ]

  const CLICKS = [b.cancel + 18, b.cancel + 70, b.ack + 12, b.ack + 42, b.ack + 90, b.remove + 40, b.moveback + 24, b.moveback + 88]
  const p = pointerAt(
    t,
    [
      { at: 0, ...P.rest },
      { at: b.cancel + 2, ...P.row, len: 14 },
      { at: b.cancel + 46, ...P.cancelBtn, len: 18 },
      { at: b.costs + 4, ...P.rows, len: 16 },
      { at: b.ack, ...P.ack, len: 12 },
      { at: b.ack + 26, ...P.wrongStore, len: 12 },
      { at: b.ack + 70, ...P.confirm, len: 14 },
      { at: b.remove + 20, ...P.remove, len: 16 },
      { at: b.stamp + 20, ...P.bsd, len: 18 },
      { at: b.moveback + 8, ...P.moveBack, len: 14 },
      { at: b.moveback + 70, ...P.dlgOk, len: 14 },
    ],
    CLICKS
  )

  const SHEET_TOP = { x: 660, y: 20, w: 780, h: 440 }
  const mdShots: Shot[] = [
    { at: 0, rect: { x: 300, y: 10, w: 1140, h: 520 } },
    { at: b.cancel + 28, len: 20, rect: SHEET_TOP },
    { at: b.cancel + 46, len: 18, rect: { x: 660, y: 470, w: 780, h: 420 } },
    { at: b.cancel + 76, len: 18, rect: { x: 380, y: 170, w: 680, h: 560 } },
    { at: b.cancelled, len: 20, rect: SHEET_TOP },
  ]
  const boardShots: Shot[] = [
    { at: 0, rect: { x: 80, y: 70, w: 560, h: 330 } },
    { at: b.stamp, len: 22, rect: { x: 330, y: 70, w: 820, h: 400 } },
    { at: b.moveback + 30, len: 20, rect: { x: 330, y: 180, w: 780, h: 540 } },
    { at: b.moveback + 100, len: 20, rect: { x: 330, y: 70, w: 820, h: 400 } },
  ]

  const md = (
    <Camera t={t} shots={mdShots}>
      <AppWindow
        dept="merch"
        active="Allotments"
        badges={{ Allotments: 1 }}
        overlay={
          <>
            <Veil opacity={sheet} />
            {sheet > 0 && (
              <AllotmentSheet
                id="ALT-0410"
                supplier="Konveksi Anugerah"
                status={cancelled ? "Cancelled" : "Active"}
                stages={STAGES}
                foot={{ hot: "cancel", pressed: press(t, b.cancel + 70) }}
                x={(1 - sheet) * 40}
                opacity={sheet}
              />
            )}
            <Veil opacity={dlg * 0.6} />
            {dlg > 0 && (
              <CancelDialog
                allotment="ALT-0410"
                rows={[
                  { stage: "To pick", detail: "1 picklist · removed", pcs: 60, tone: "text" },
                  { stage: "Picked", detail: "1 store · the warehouse puts it back", pcs: 120, tone: "red" },
                  { stage: "Packed", detail: "1 store in 2 koli · the warehouse unpacks it", pcs: 150, tone: "red" },
                  { stage: "Sent", detail: "keeps going", pcs: 90, tone: "mute" },
                ]}
                work={270}
                ack={ack}
                reason={reason}
                hot={t > b.ack + 80 && t < b.ack + 94}
                pressed={press(t, b.ack + 90)}
                style={{ opacity: dlg, scale: String(0.96 + 0.04 * dlg) }}
              />
            )}
            <Pointer {...p} />
          </>
        }
      >
        <AllotmentList
          rows={ROWS.map((r) => (r.id === "ALT-0410" && cancelled ? { ...r, status: "Cancelled" as const } : r))}
          hot={t >= b.cancel + 10 ? "ALT-0410" : undefined}
        />
      </AppWindow>
    </Camera>
  )

  const board = (
    <Camera t={t} shots={boardShots}>
      <AppWindow
        dept="outbound"
        active="Outbound"
        column={false}
        overlay={
          <>
            <Veil opacity={mvDlg * 0.9} />
            {mvDlg > 0 && (
              <MoveBackDialog
                store="Store BSD"
                allotment="ALT-0410"
                pcs={150}
                to="pick"
                lines={[
                  { name: "Polo Pique Basic · L", sku: "PLO-PQ-BS-L", koli: "K01", now: 75, back: 75 },
                  { name: "Kaos Crew Basic · M", sku: "KAO-CRW-BS-M", koli: "K02", now: 75, back: 75 },
                ]}
                outcome="2 koli opened · labels void · 150 pcs go back to their racks · nothing to pick again"
                edited={false}
                hot={t > b.moveback + 80 ? "confirm" : undefined}
                pressed={press(t, b.moveback + 88)}
                style={{ opacity: mvDlg, scale: String(0.96 + 0.04 * mvDlg) }}
              />
            )}
            <Pointer {...p} />
          </>
        }
      >
        <Board
          cards={cards}
          looks={{
            x1: { pulse: 1 - progress(t, b.remove + 12, b.remove + 40), hot: t > b.remove + 30 && t < b.remove + 44, pressed: press(t, b.remove + 40) },
            x2: { pulse: 1 - progress(t, b.remove + 12, b.remove + 40) },
            x3: { pulse: 1 - progress(t, b.remove + 12, b.remove + 40), hot: t > b.moveback + 16 && t < b.moveback + 28, pressed: press(t, b.moveback + 24) },
          }}
        />
      </AppWindow>
    </Camera>
  )

  const toastAt = (from: number, to: number) => progress(t, from, from + 8) * (1 - progress(t, to, to + 6))
  const toasts = [
    { k: toastAt(b.ack + 98, b.cancelled + 70), text: "MD cancelled ALT-0410 · 3 stores" },
    { k: toastAt(b.remove + 46, b.stamp + 10), text: "Store Senayan · picklist removed" },
    { k: toastAt(b.stamp + 40, b.moveback), text: "Store BSD can’t go · cancelled by MD, move it back" },
    { k: toastAt(b.moveback + 96, b.moveback + 150), text: "Store BSD · 2 koli opened · 150 pcs back to their racks" },
  ]

  return (
    <Frame>
      <AbsoluteFill style={{ opacity: fade }}>{onBoard ? board : md}</AbsoluteFill>
      {toasts.map((one) => (
        <FrameToast key={one.text} k={one.k}>
          {one.text}
        </FrameToast>
      ))}
      <Caption t={t} lines={L.captions} />
      <Band chapter={4} of={5} title="MD membatalkan" who={onBoard ? GUDANG : MD} steps={OB_STEPS} at={onBoard ? 2 : 0} done={onBoard ? 3 : 0} />
      <Voice chapter="ob4" ids={narration.map((line) => line.id)} start={b} />
      <Sfx
        cues={[
          ...clicks(CLICKS, 0.4),
          { at: b.ack + 96, src: SFX.stamp, volume: 0.45 },
          { at: b.remove + 10, src: SFX.whoosh, volume: 0.25 },
          { at: b.moveback + 96, src: SFX.tick, volume: 0.3 },
        ]}
      />
    </Frame>
  )
}
