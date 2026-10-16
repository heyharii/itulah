/* Outbound · Bab 5 · Short pick, narrated (Charon). One beat per sentence of
   src/narration/ob5.json, then the mark.

   short     the warehouse picks Store Senayan's ALT-0411 (100 pcs)
   report    Kemeja Linen Relaxed · M: 15 of 20, "Item not found at the rack",
             Picked 95 · report 5
   goes      95 go on (Picked → Packed → In transit); 5 stay To pick with the
             Short pick strip
   md        MD · Still needed: Target 100 · Sent 95 · To pick 5
   close     Close remaining on Store Bintaro's 3 (an Ops reason)
   inv       Inventory · Stock checks
   found     Found 5 → the strip is gone, Senayan's 5 can be picked
   revive    Found 6 on a cancelled demand → back in stock, nothing revived
   received  MD's list: Received short (214 / 220) and Closed short */
import { AbsoluteFill } from "remotion"
import { EASE_OUT, press, progress } from "../../motion"
import narration from "../../narration/ob5.json"
import durations from "../../narration/ob5.durations.json"
import { useT } from "../../timing"
import { AppWindow } from "../../ui/AppWindow"
import { Camera, FULL, type Shot } from "../../ui/Camera"
import { BrandMark, Pointer, Veil } from "../../ui/kit"
import { Band, Caption, FrameToast, GUDANG, MD, type Who } from "../../ui/Overlay"
import { AllotmentList, Board, type BoardCard } from "../../ui/outbound"
import { PickDialog, StillNeededPage, StockChecksPage } from "../../ui/outbound2"
import { layout } from "../beats"
import { pointerAt } from "../cursor"
import { Frame } from "../Frame"
import { SFX, Sfx, clicks } from "../Sfx"
import { Voice } from "../Voice"
import { ALLOTTED, BASE, NEW_0413, OB_STEPS } from "./data"

const INVENTORY: Who = { initials: "DL", role: "Inventory", name: "Dewi Lestari" }

const MINS = { short: 60, report: 150, goes: 150, md: 100, close: 100, inv: 70, found: 150, revive: 110, received: 130 }
const L = layout(narration, durations, MINS)
const END = 110
export const OB5_LEN = L.total + END
export const OB5_BEATS = L.start
const b = L.start

const LINES = [
  { name: "Kemeja Linen Relaxed · S", sku: "KMJ-LNN-RX-S", toPick: 16 },
  { name: "Kemeja Linen Relaxed · M", sku: "KMJ-LNN-RX-M", toPick: 20 },
  { name: "Kemeja Linen Relaxed · L", sku: "KMJ-LNN-RX-L", toPick: 16 },
  { name: "Polo Pique Basic · M", sku: "PLO-PQ-BS-M", toPick: 16 },
  { name: "Polo Pique Basic · L", sku: "PLO-PQ-BS-L", toPick: 16 },
  { name: "Kaos Crew Basic · L", sku: "KAO-CRW-BS-L", toPick: 16 },
]

const P = {
  rest: { x: 1100, y: 640 },
  picked: { x: 226, y: 233 },
  minus: { x: 918, y: 295 },
  reason: { x: 797, y: 682 },
  report: { x: 974, y: 790 },
  close2: { x: 1317, y: 303 },
  found1: { x: 1293, y: 185 },
  found2: { x: 1293, y: 185 },
}

/** The board after chapter 4, ALT-0410's leftovers gone. */
const BOARD: BoardCard[] = [
  ...BASE.filter((c) => c.ref !== "ALT-0410").map((c) =>
    c.id === "k1" ? { ...c, pcs: 250 } : c.id === "s1" ? { ...c, pcs: 100 } : c
  ),
  ...NEW_0413.slice(1),
]

export function Ob5Short() {
  const t = useT()
  const r0 = b.report
  const reported = t >= r0 + 120
  const minusClicks = [r0 + 30, r0 + 34, r0 + 38, r0 + 42, r0 + 46]
  const linenM = 20 - minusClicks.filter((c) => t >= c).length
  const pickDlg = progress(t, b.short + 34, b.short + 44) * (1 - progress(t, r0 + 120, r0 + 128))
  const g0 = b.goes
  const stage95 = t < g0 + 50 ? "picked" : t < g0 + 100 ? "packed" : "transit"
  const found = t >= b.found + 24
  const closedBintaro = t >= b.close + 40

  /* What the board shows. */
  const senayan5: BoardCard = { id: "s1", lane: "pick", store: "Store Senayan", ref: "ALT-0411", pcs: 5, meta: "1 SKU", shortPick: !found }
  const senayan95: BoardCard =
    stage95 === "picked"
      ? { id: "s95", lane: "picked", store: "Store Senayan", ref: "ALT-0411", pcs: 95, meta: "6 SKUs" }
      : stage95 === "packed"
        ? { id: "s95", lane: "packed", store: "Store Senayan", ref: "ALT-0411", pcs: 95, meta: "2 koli" }
        : { id: "s95", lane: "transit", store: "Store Senayan", ref: "SJ-091026-005", pcs: 95, meta: "2 koli" }
  const cards: BoardCard[] = reported
    ? [senayan5, senayan95, ...BOARD.filter((c) => c.id !== "s1" && !(closedBintaro && c.id === "s3"))]
    : BOARD

  /* Which screen: board, MD, Inventory, board (found), Inventory, MD. */
  const view =
    t < b.md
      ? "board"
      : t < b.inv
        ? "md"
        : t < b.found + 50
          ? "inv"
          : t < b.revive
            ? "board"
            : t < b.received
              ? "inv"
              : "list"
  const viewStart = { board: t < b.md ? 0 : b.found + 50, md: b.md, inv: t < b.found + 50 ? b.inv : b.revive, list: b.received }[view]
  const fade = progress(t, viewStart, viewStart + 12)

  const CLICKS = [b.short + 30, ...minusClicks, r0 + 70, r0 + 110, b.close + 36, b.found + 20, b.revive + 30]
  const p = pointerAt(
    t,
    [
      { at: 0, ...P.rest },
      { at: b.short + 14, ...P.picked, len: 14 },
      { at: r0 + 14, ...P.minus, len: 14 },
      { at: r0 + 56, ...P.reason, len: 12 },
      { at: r0 + 92, ...P.report, len: 14 },
      { at: b.md, ...P.rest, len: 1 },
      { at: b.close + 14, ...P.close2, len: 18 },
      { at: b.inv, ...P.rest, len: 1 },
      { at: b.found + 2, ...P.found1, len: 16 },
      { at: b.revive + 6, ...P.found2, len: 16 },
    ],
    CLICKS
  )

  const DLG = { x: 300, y: 60, w: 840, h: 790 }
  const boardShots: Shot[] =
    t < b.md
      ? [
          { at: 0, rect: { x: 80, y: 70, w: 820, h: 380 } },
          { at: b.short + 40, len: 18, rect: DLG },
          { at: r0 + 124, len: 20, rect: { x: 80, y: 70, w: 860, h: 420 } },
          { at: g0 + 40, len: 30, rect: FULL },
        ]
      : [{ at: 0, rect: { x: 80, y: 70, w: 820, h: 380 } }]

  const board = (
    <Camera t={t} shots={boardShots}>
      <AppWindow
        dept="outbound"
        active="Outbound"
        column={false}
        overlay={
          <>
            <Veil opacity={pickDlg * 0.9} />
            {pickDlg > 0 && (
              <PickDialog
                store="Store Senayan"
                allotment="ALT-0411"
                lines={LINES.map((l, i) => ({ ...l, picked: i === 1 ? linenM : l.toPick }))}
                reason={linenM < 20 ? (t >= r0 + 70 ? 1 : -1) : undefined}
                hot={t > r0 + 100 && t < r0 + 114}
                pressed={press(t, r0 + 110)}
                style={{ opacity: pickDlg, scale: String(0.96 + 0.04 * pickDlg) }}
              />
            )}
            <Pointer {...p} opacity={view === "board" && t < b.md ? 1 : 0} />
          </>
        }
      >
        <Board
          cards={cards}
          looks={{
            s1: {
              pulse: found ? 1 - progress(t, b.found + 56, b.found + 90) : reported ? 1 - progress(t, r0 + 124, r0 + 150) : 0,
              hot: t > b.short + 22 && t < b.short + 34,
              pressed: press(t, b.short + 30),
            },
            s95: { pulse: 1 - progress(t, stage95 === "picked" ? r0 + 124 : stage95 === "packed" ? g0 + 50 : g0 + 100, (stage95 === "picked" ? r0 + 124 : stage95 === "packed" ? g0 + 50 : g0 + 100) + 30) },
          }}
        />
      </AppWindow>
    </Camera>
  )

  const md = (
    <Camera t={t} shots={[{ at: 0, rect: { x: 300, y: 10, w: 1140, h: 480 } }]}>
      <AppWindow dept="merch" active="Allotments" badges={{ Allotments: closedBintaro ? 1 : 2 }} overlay={<Pointer {...p} />}>
        <StillNeededPage
          rows={[
            {
              allotment: "ALT-0411",
              store: "Store Senayan",
              name: "Kemeja Linen Relaxed · M",
              sku: "KMJ-LNN-RX-M",
              target: 100,
              sent: 95,
              toPick: 5,
              why: "Item not found at the rack · Inventory stock check in progress",
            },
            {
              allotment: "ALT-0409",
              store: "Store Bintaro",
              name: "Kaos Crew Basic · XXL",
              sku: "KAO-CRW-BS-XXL",
              target: 12,
              sent: 9,
              toPick: 3,
              why: "Stock at rack could not be confirmed · Inventory stock check in progress",
              done: closedBintaro ? "Closed short" : undefined,
            },
          ]}
          hot={t > b.close + 26 && t < b.close + 40 ? 1 : undefined}
          pressed={press(t, b.close + 36)}
        />
      </AppWindow>
    </Camera>
  )

  const revived = t >= b.revive + 34
  const inv = (
    <Camera t={t} shots={[{ at: 0, rect: { x: 300, y: 10, w: 1140, h: 440 } }]}>
      <AppWindow dept="inventory" active="Stock checks" badges={{ "Stock checks": found ? (revived ? 1 : 2) : 3 }} overlay={<Pointer {...p} />}>
        <StockChecksPage
          rows={[
            {
              name: "Kemeja Linen Relaxed · M",
              sku: "KMJ-LNN-RX-M",
              rack: "B-06",
              qty: 5,
              from: "ALT-0411 · Store Senayan",
              by: "Yusuf Ramadhan · 09 Oct 2026, 10:42",
              md: found ? "Picking again" : "Still needed",
              done: found ? "Found" : undefined,
            },
            {
              name: "Polo Pique Basic · L",
              sku: "PLO-PQ-BS-L",
              rack: "D-03",
              qty: 6,
              from: "ALT-0410 · Store Bintaro",
              by: "Yusuf Ramadhan · 09 Oct 2026, 09:15",
              md: "Demand cancelled",
              done: revived ? "Found" : undefined,
            },
            {
              name: "Kaos Crew Basic · XXL",
              sku: "KAO-CRW-BS-XXL",
              rack: "C-04",
              qty: 3,
              from: "ALT-0409 · Store Bintaro",
              by: "Yusuf Ramadhan · 08 Oct 2026, 16:20",
              md: "Closed short",
            },
          ]}
          hot={!found && t > b.found + 10 ? [0, "found"] : found && !revived && t > b.revive + 16 ? [0, "found"] : undefined}
          pressed={found ? press(t, b.revive + 30) : press(t, b.found + 20)}
        />
      </AppWindow>
    </Camera>
  )

  const list = (
    <Camera
      t={t}
      shots={[
        { at: 0, rect: { x: 300, y: 10, w: 1140, h: 520 } },
        { at: b.received + 10, len: 24, rect: { x: 300, y: 330, w: 1140, h: 440 } },
      ]}
    >
      <AppWindow dept="merch" active="Allotments" badges={{ Allotments: 0 }}>
        <AllotmentList
          rows={ALLOTTED.map((r) =>
            r.id === "ALT-0409"
              ? { ...r, pcs: 9, where: "1 received", note: "Remaining 3 closed", status: "Closed short" as const }
              : r.id === "ALT-0410"
                ? { ...r, pcs: 90, where: "1 on the road", status: "Cancelled" as const }
                : r.id === "ALT-0411"
                  ? { ...r, pcs: 100, where: "1 to pick · 1 on the road" }
                  : r
          )}
          hot={t >= b.received + 40 && t < b.received + 160 ? "ALT-0401" : t >= b.received + 160 ? "ALT-0409" : undefined}
        />
      </AppWindow>
    </Camera>
  )

  const toastAt = (from: number, to: number) => progress(t, from, from + 8) * (1 - progress(t, to, to + 6))
  const toasts = [
    { k: toastAt(r0 + 124, b.goes + 40), text: "Cannot continue picking · 5 pcs unfulfilled" },
    { k: toastAt(b.close + 42, b.inv), text: "Closed short · Store Bintaro gets 3 pcs less" },
    { k: toastAt(b.found + 26, b.revive - 4), text: "Found 5 · Store Senayan can be picked" },
    { k: toastAt(b.revive + 36, b.received), text: "Found 6 · back in available stock · demand cancelled" },
  ]

  const ending = L.total
  const mark = progress(t, ending + 10, ending + 26, EASE_OUT)
  const word = progress(t, ending + 26, ending + 40, EASE_OUT)
  const out = progress(t, ending, ending + 12)

  const who = view === "md" || view === "list" ? MD : view === "inv" ? INVENTORY : GUDANG
  const at = view === "board" ? (t < b.md ? (t < b.goes + 100 ? 2 : 4) : 1) : view === "list" ? 5 : 1

  return (
    <Frame>
      <AbsoluteFill style={{ opacity: fade * (1 - out) }}>
        {view === "board" ? board : view === "md" ? md : view === "inv" ? inv : list}
      </AbsoluteFill>
      {toasts.map((one) => (
        <FrameToast key={one.text} k={one.k * (1 - out)}>
          {one.text}
        </FrameToast>
      ))}
      <Caption t={t} lines={L.captions} />
      <AbsoluteFill style={{ opacity: 1 - out }}>
        <Band chapter={5} of={5} title="Short pick" who={who} steps={OB_STEPS} at={at} done={at} />
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
      <Voice chapter="ob5" ids={narration.map((line) => line.id)} start={b} />
      <Sfx
        cues={[
          ...clicks(CLICKS, 0.4),
          { at: r0 + 124, src: SFX.whoosh, volume: 0.25 },
          { at: b.found + 26, src: SFX.tick, volume: 0.3 },
          { at: ending + 26, src: SFX.ding, volume: 0.3 },
        ]}
      />
    </Frame>
  )
}
