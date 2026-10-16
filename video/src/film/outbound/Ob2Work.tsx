/* Outbound · Bab 2 · Gudang mengerjakan, narrated (Charon). One beat per
   sentence of src/narration/ob2.json.

   board     the five lanes
   card      one card = one allotment for one store (Store Kemang, ALT-0413)
   pick      Picked: the pick sheet, everything picked → the Picked lane
   pack      Pack: Put everything left in → Close koli 1 → Done · 1 koli
   dispatch  tick Kemang and Kelapa Gading → Dispatch → Trip notes →
             Dispatch and print → In transit, with their surat jalan
   received  the Received lane: Store PIK 214 / 220 — Received short
   md        MD's ALT-0413: To pick · Picked · Packed · On the road · Received */
import { AbsoluteFill } from "remotion"
import { press, progress, typed } from "../../motion"
import narration from "../../narration/ob2.json"
import durations from "../../narration/ob2.durations.json"
import { useT } from "../../timing"
import { AppWindow } from "../../ui/AppWindow"
import { Camera, FULL, type Shot } from "../../ui/Camera"
import { Pointer, Veil } from "../../ui/kit"
import { Band, Caption, FrameToast, GUDANG, MD } from "../../ui/Overlay"
import { AllotmentList, AllotmentSheet, Board, type BoardCard } from "../../ui/outbound"
import { DispatchDialog, PackDialog, PickDialog } from "../../ui/outbound2"
import { layout } from "../beats"
import { pointerAt } from "../cursor"
import { Frame } from "../Frame"
import { SFX, Sfx, clicks } from "../Sfx"
import { Voice } from "../Voice"
import { ALLOTTED, BASE, KEMANG_0413, NEW_0413, OB_STEPS, STORES, columnTotal } from "./data"

const MINS = { board: 100, card: 80, pick: 110, pack: 120, dispatch: 160, received: 100, md: 110 }
const L = layout(narration, durations, MINS)
export const OB2_LEN = L.total + 20
export const OB2_BEATS = L.start
const b = L.start

const P = {
  rest: { x: 1100, y: 640 },
  pickBtn: { x: 226, y: 233 },
  pickOk: { x: 1004, y: 722 },
  packBtn: { x: 490, y: 233 },
  allIn: { x: 974, y: 243 },
  closeKoli: { x: 990, y: 720 },
  done: { x: 1009, y: 556 },
  tickKemang: { x: 664, y: 172 },
  tickKG: { x: 664, y: 340 },
  dispatch: { x: 754, y: 796 },
  notes: { x: 720, y: 391 },
  print: { x: 931, y: 633 },
  recv: { x: 1280, y: 190 },
}

export function Ob2Work() {
  const t = useT()
  const onMd = t >= b.md
  const fade = onMd ? progress(t, b.md, b.md + 12) : 1

  /* Where Store Kemang's ALT-0413 card is. */
  const picked = t >= b.pick + 66
  const packed = t >= b.pack + 84
  const sent = t >= b.dispatch + 100
  const kemang = NEW_0413[0]
  const others = NEW_0413.slice(1)
  const moved: BoardCard = sent
    ? { ...kemang, lane: "transit", ref: "SJ-091026-003", meta: "1 koli" }
    : packed
      ? { ...kemang, lane: "packed", meta: "1 koli" }
      : picked
        ? { ...kemang, lane: "picked" }
        : kemang
  const kg = BASE.find((c) => c.id === "k2")!
  const cards: BoardCard[] = [
    moved,
    ...(sent ? [{ ...kg, lane: "transit" as const, ref: "SJ-091026-004" }] : []),
    ...others,
    ...BASE.filter((c) => !(sent && c.id === "k2")),
  ]

  const pickDlg = progress(t, b.pick + 14, b.pick + 24) * (1 - progress(t, b.pick + 62, b.pick + 70))
  const packDlg = progress(t, b.pack + 12, b.pack + 22) * (1 - progress(t, b.pack + 82, b.pack + 90))
  const allIn = t >= b.pack + 36
  const closed = t >= b.pack + 58
  const dispDlg = progress(t, b.dispatch + 40, b.dispatch + 50) * (1 - progress(t, b.dispatch + 98, b.dispatch + 106))
  const tickedK = t >= b.dispatch + 8 && !sent
  const tickedKG = t >= b.dispatch + 22 && !sent

  const CLICKS = [
    b.pick + 12, b.pick + 60,
    b.pack + 10, b.pack + 34, b.pack + 56, b.pack + 80,
    b.dispatch + 8, b.dispatch + 22, b.dispatch + 38, b.dispatch + 96,
  ]
  const p = pointerAt(
    t,
    [
      { at: 0, ...P.rest },
      { at: b.pick, ...P.pickBtn, len: 12 },
      { at: b.pick + 34, ...P.pickOk, len: 18 },
      { at: b.pack, ...P.packBtn, len: 10 },
      { at: b.pack + 22, ...P.allIn, len: 12 },
      { at: b.pack + 42, ...P.closeKoli, len: 12 },
      { at: b.pack + 66, ...P.done, len: 12 },
      { at: b.dispatch, ...P.tickKemang, len: 8 },
      { at: b.dispatch + 14, ...P.tickKG, len: 8 },
      { at: b.dispatch + 28, ...P.dispatch, len: 10 },
      { at: b.dispatch + 52, ...P.notes, len: 12 },
      { at: b.dispatch + 84, ...P.print, len: 12 },
      { at: b.received, ...P.recv, len: 16 },
    ],
    CLICKS
  )

  const DLG = { x: 300, y: 120, w: 840, h: 660 }
  const shots: Shot[] = [
    { at: 0, rect: FULL },
    { at: b.card, len: 22, rect: { x: 80, y: 70, w: 820, h: 380 } },
    { at: b.pick + 16, len: 18, rect: DLG },
    { at: b.pick + 70, len: 18, rect: { x: 80, y: 70, w: 860, h: 400 } },
    { at: b.pack + 14, len: 18, rect: DLG },
    { at: b.pack + 86, len: 18, rect: { x: 340, y: 70, w: 860, h: 400 } },
    { at: b.dispatch + 30, len: 14, rect: { x: 560, y: 120, w: 720, h: 720 } },
    { at: b.dispatch + 44, len: 16, rect: { x: 360, y: 210, w: 720, h: 480 } },
    { at: b.dispatch + 102, len: 20, rect: { x: 600, y: 70, w: 840, h: 400 } },
    { at: b.received, len: 20, rect: { x: 1110, y: 70, w: 330, h: 300 } },
  ]

  const board = (
    <Camera t={t} shots={shots}>
      <AppWindow
        dept="outbound"
        active="Outbound"
        column={false}
        overlay={
          <>
            <Veil opacity={Math.max(pickDlg, packDlg, dispDlg) * 0.9} />
            {pickDlg > 0 && (
              <PickDialog
                store="Store Kemang"
                allotment="ALT-0413"
                lines={KEMANG_0413.map((l) => ({ name: l.name, sku: l.sku, toPick: l.qty, picked: l.qty }))}
                hot={t > b.pick + 50 && t < b.pick + 64}
                pressed={press(t, b.pick + 60)}
                style={{ opacity: pickDlg, scale: String(0.96 + 0.04 * pickDlg) }}
              />
            )}
            {packDlg > 0 && (
              <PackDialog
                store="Store Kemang"
                allotment="ALT-0413"
                lines={KEMANG_0413.map((l) => ({
                  name: l.name,
                  sku: l.sku,
                  left: allIn ? 0 : l.qty,
                  inKoli: allIn && !closed ? l.qty : 0,
                }))}
                closed={closed ? [columnTotal(0)] : []}
                hot={(t > b.pack + 46 && t < b.pack + 60) || (t > b.pack + 72 && t < b.pack + 84)}
                pressed={closed ? press(t, b.pack + 80) : press(t, b.pack + 56)}
                style={{ opacity: packDlg, scale: String(0.96 + 0.04 * packDlg) }}
              />
            )}
            {dispDlg > 0 && (
              <DispatchDialog
                rows={[
                  { store: "Store Kemang", allotment: "ALT-0413", koli: 1, pcs: columnTotal(0) },
                  { store: "Store Kelapa Gading", allotment: "ALT-0407", koli: 1, pcs: 80 },
                ]}
                notes={typed("Pak Joko · B 9123 KXA", t, b.dispatch + 58, 0.9)}
                caret={t >= b.dispatch + 54 && t < b.dispatch + 84}
                hot={t > b.dispatch + 88 && t < b.dispatch + 100}
                pressed={press(t, b.dispatch + 96)}
                style={{ opacity: dispDlg, scale: String(0.96 + 0.04 * dispDlg) }}
              />
            )}
            <Pointer {...p} />
          </>
        }
      >
        <Board
          cards={cards}
          looks={{
            n0: {
              ring: t >= b.card && t < b.pick ? 1 : 0,
              pulse:
                picked && !packed
                  ? 1 - progress(t, b.pick + 70, b.pick + 100)
                  : packed && !sent
                    ? 1 - progress(t, b.pack + 88, b.pack + 118)
                    : sent
                      ? 1 - progress(t, b.dispatch + 104, b.dispatch + 134)
                      : 0,
              selected: tickedK,
              hot: (t > b.pick + 4 && t < b.pick + 14) || (t > b.pack + 2 && t < b.pack + 12),
            },
            k2: { selected: tickedKG },
            r1: { ring: t >= b.received + 14 ? 1 : 0 },
          }}
          dispatch={{ enabled: tickedK, hot: t > b.dispatch + 30 && t < b.dispatch + 40 }}
        />
      </AppWindow>
    </Camera>
  )

  const md = (
    <Camera
      t={t}
      shots={[
        { at: 0, rect: { x: 640, y: 10, w: 800, h: 520 } },
      ]}
    >
      <AppWindow
        dept="merch"
        active="Allotments"
        badges={{ Allotments: 1 }}
        overlay={
          <>
            <Veil opacity={1} />
            <AllotmentSheet
              id="ALT-0413"
              supplier="PT Tekstil Jaya"
              created="09 Oct 2026"
              stages={STORES.map((st, j) => ({
                store: st.full,
                stage: j === 0 ? ("On the road" as const) : ("To pick" as const),
                pcs: columnTotal(j),
              }))}
            />
          </>
        }
      >
        <AllotmentList rows={ALLOTTED} hot="ALT-0413" />
      </AppWindow>
    </Camera>
  )

  const toast = progress(t, b.dispatch + 104, b.dispatch + 112) * (1 - progress(t, b.received + 20, b.received + 26))

  return (
    <Frame>
      <AbsoluteFill style={{ opacity: fade }}>{onMd ? md : board}</AbsoluteFill>
      <FrameToast k={toast}>SJ-091026-003, SJ-091026-004 printed · 2 stores on the road</FrameToast>
      <Caption t={t} lines={L.captions} />
      <Band
        chapter={2}
        of={5}
        title="Gudang mengerjakan"
        who={onMd ? MD : GUDANG}
        steps={OB_STEPS}
        at={
          onMd
            ? 4
            : sent
              ? 4 + progress(t, b.received + 4, b.received + 30)
              : packed
                ? 3 + progress(t, b.dispatch + 100, b.dispatch + 124)
                : picked
                  ? 2 + progress(t, b.pack + 84, b.pack + 108)
                  : 1 + progress(t, b.pick + 66, b.pick + 90)
        }
        done={sent ? 4 : packed ? 3 : picked ? 2 : 1}
      />
      <Voice chapter="ob2" ids={narration.map((line) => line.id)} start={b} />
      <Sfx
        cues={[
          ...clicks(CLICKS, 0.4),
          { at: b.pack + 58, src: SFX.tick, volume: 0.3 },
          { at: b.dispatch + 100, src: SFX.whoosh, volume: 0.3 },
        ]}
      />
    </Frame>
  )
}
