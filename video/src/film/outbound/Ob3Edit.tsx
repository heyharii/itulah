/* Outbound · Bab 3 · MD mengubah jumlah, narrated (Charon). One beat per
   sentence of src/narration/ob3.json (beats.ts); times inside a beat count
   from its start.

   edit      MD · Allotments, ALT-0408, Edit
   steps     Store Kemang: Celana Chino S 60 → 40, Kemeja Oxford L 60 → 30
   lock      Store PIK is on the road: a locked row
   save      "50 pcs the warehouse moves back" · Save changes
   strip     the warehouse's board: the card's red strip "Edited −50",
             300 → 250
   blocked   its tick is a lock: "can't go yet · move back 50 pcs first"
   sheet     Was / Now / Move back per SKU
   moveback  Move back, prefilled with the excess
   racks     K01, K02 reopened, labels reprinted, 50 pcs back to the racks
   normal    the card is an ordinary Packed card again, and can be ticked
   partial   Move back on Store BSD: Picked, 30 of 90
   transit   In transit cannot be moved back
   add       MD adds +30: a new To pick card, "Added +30" */
import { AbsoluteFill } from "remotion"
import { press, progress } from "../../motion"
import narration from "../../narration/ob3.json"
import durations from "../../narration/ob3.durations.json"
import { useT } from "../../timing"
import { AppWindow } from "../../ui/AppWindow"
import { Camera, type Shot } from "../../ui/Camera"
import { Pointer, Veil } from "../../ui/kit"
import { Band, Caption, FrameToast, GUDANG, MD } from "../../ui/Overlay"
import {
  AllotmentList,
  AllotmentSheet,
  Board,
  CardSheet,
  MoveBackDialog,
  type BoardCard,
  type EditLine,
  type SkuLine,
  type StoreStage,
} from "../../ui/outbound"
import { layout } from "../beats"
import { ALLOTTED, BASE, NEW_0413, OB_STEPS } from "./data"
import { pointerAt } from "../cursor"
import { Frame } from "../Frame"
import { SFX, Sfx, clicks } from "../Sfx"
import { Voice } from "../Voice"

const MINS = {
  edit: 150,
  steps: 110,
  lock: 90,
  save: 100,
  strip: 110,
  blocked: 80,
  sheet: 90,
  moveback: 90,
  racks: 100,
  normal: 90,
  partial: 120,
  transit: 80,
  add: 170,
}
const L = layout(narration, durations, MINS)
export const OB3_LEN = L.total + 30
const b = L.start
export const OB3_BEATS = b

/* ── Data ───────────────────────────────────────────────────────────── */

const STAGES: StoreStage[] = [
  { store: "Store Kemang", stage: "Packed", pcs: 300 },
  { store: "Store PIK", stage: "On the road", pcs: 210, sj: "SJ-091026-001" },
]

const KEMANG = [
  { name: "Celana Chino Tapered · S", sku: "CLN-CHN-TP-S", koli: "K01", was: 60, now: 40 },
  { name: "Kaos Crew Basic · L", sku: "KAO-CRW-BS-L", koli: "K01", was: 60, now: 60 },
  { name: "Kemeja Oxford Slim · L", sku: "KMJ-OXF-SL-L", koli: "K02", was: 60, now: 30 },
  { name: "Polo Pique Basic · M", sku: "PLO-PQ-BS-M", koli: "K03", was: 60, now: 60 },
  { name: "Kemeja Linen Relaxed · XL", sku: "KMJ-LNN-RX-XL", koli: "K04", was: 60, now: 60 },
] as const satisfies readonly SkuLine[]

/* The book as chapter 2 left it: ALT-0413's picklists still to pick
   (Kemang's already on the road), below what was there before. */
const BOARD: BoardCard[] = [
  ...BASE,
  ...NEW_0413.filter((c) => c.store !== "Store Kemang"),
  { id: "n0t", lane: "transit", store: "Store Kemang", ref: "SJ-091026-003", pcs: 45, meta: "1 koli" },
]
const ROWS = ALLOTTED

/* ── Window points (1440 × 900) ─────────────────────────────────────── */

const P = {
  /* ALT-0408 is the sixth row: 168 + 5 × 62 + 31. */
  row0408: { x: 520, y: 509 },
  footerRight: { x: 1372, y: 848 },
  chinoQty: { x: 1212, y: 386 },
  oxfordQty: { x: 1212, y: 502 },
  lockRow: { x: 900, y: 251 },
  kemangLock: { x: 664, y: 200 },
  kemangName: { x: 740, y: 200 },
  kemangMove: { x: 754, y: 287 },
  kemangTick: { x: 664, y: 172 },
  bsdName: { x: 740, y: 0 },
  dlgConfirm: { x: 989, y: 785 },
  dlgKeep: { x: 867, y: 785 },
  transitCard: { x: 1010, y: 175 },
  rest: { x: 1100, y: 640 },
}

export function Ob3Edit() {
  const t = useT()

  /* Where we are: MD's Allotments, the warehouse's board, MD again for +30. */
  const onBoard = (t >= b.strip && t < b.add + 4) || t >= b.add + 96
  const fade = onBoard
    ? progress(t, b.strip, b.strip + 10) * (t >= b.add + 96 ? progress(t, b.add + 96, b.add + 106) : 1)
    : t >= b.add ? progress(t, b.add + 4, b.add + 14) : 1

  /* MD: open, Edit, two lines, Save. */
  const sheetIn = progress(t, b.edit + 24, b.edit + 36) * (1 - progress(t, b.save + 40, b.save + 48))
  const editing = t >= b.edit + 74 && t < b.save + 48
  const chino = t >= b.steps + 22 ? 40 : 60
  const oxford = t >= b.steps + 58 ? 30 : 60
  const editLines: EditLine[] = KEMANG.map((l, i) => ({
    name: l.name,
    sku: l.sku,
    now: l.was,
    next: i === 0 ? chino : i === 2 ? oxford : l.was,
  }))
  /* MD again, adding 30 of Celana Chino M to Store Kemang. */
  const a0 = b.add
  const addSheet = progress(t, a0 + 6, a0 + 18) * (1 - progress(t, a0 + 84, a0 + 92))
  const addedRow = t >= a0 + 40

  /* The warehouse. */
  const edited = t >= b.strip && t < b.racks + 40
  const sheetBeside = progress(t, b.sheet + 18, b.sheet + 30) * (1 - progress(t, b.racks + 34, b.racks + 42))
  const dlg = progress(t, b.moveback + 26, b.moveback + 36) * (1 - progress(t, b.racks + 22, b.racks + 30))
  const partialDlg = progress(t, b.partial + 18, b.partial + 28) * (1 - progress(t, b.partial + 100, b.partial + 108))
  const ticked = t >= b.normal + 40 && t < b.partial
  const addedCard = t >= a0 + 100

  const cards: BoardCard[] = [
    ...(addedCard
      ? [{ id: "a1", lane: "pick" as const, store: "Store Kemang", ref: "ALT-0408", pcs: 30, meta: "1 SKU", added: 30 }]
      : []),
    ...BOARD.map((c) =>
      c.id === "k1"
        ? edited
          ? { ...c, edited: { from: 300, to: 250 } }
          : t >= b.racks + 40
            ? { ...c, pcs: 250 }
            : c
        : c
    ),
  ]

  const toastAt = (from: number, to: number) => progress(t, from, from + 8) * (1 - progress(t, to, to + 6))
  const toasts = [
    { k: toastAt(b.save + 40, b.strip - 4), text: "ALT-0408 edited · 50 for the warehouse to move back" },
    { k: toastAt(b.blocked + 30, b.sheet + 10), text: "Store Kemang can’t go yet · move back 50 pcs first" },
    { k: toastAt(b.racks + 24, b.normal + 30), text: "Store Kemang · K01, K02 reopened · labels reprinted · 50 pcs back to their racks" },
    { k: toastAt(a0 + 100, a0 + 160), text: "ALT-0408 edited · +30 to pick" },
  ]

  const CLICKS = [
    b.edit + 20, b.edit + 70,
    b.steps + 10, b.steps + 46,
    b.save + 30,
    b.blocked + 28,
    b.sheet + 14,
    b.moveback + 22,
    b.racks + 18,
    b.normal + 38,
    b.partial + 100,
    a0 + 74,
  ]

  const p = pointerAt(
    t,
    [
      { at: 0, ...P.rest },
      { at: b.edit + 4, ...P.row0408, len: 16 },
      { at: b.edit + 50, ...P.footerRight, len: 18 },
      { at: b.steps, ...P.chinoQty, len: 14 },
      { at: b.steps + 34, ...P.oxfordQty, len: 10 },
      { at: b.lock + 6, ...P.lockRow, len: 16 },
      { at: b.save + 10, x: 1340, y: 848, len: 16 },
      { at: b.strip + 10, ...P.rest, len: 1 },
      { at: b.blocked + 10, ...P.kemangLock, len: 16 },
      { at: b.sheet + 2, ...P.kemangName, len: 10 },
      { at: b.moveback + 6, x: 1330, y: 848, len: 16 },
      { at: b.racks + 2, ...P.dlgConfirm, len: 14 },
      { at: b.normal + 22, ...P.kemangTick, len: 14 },
      { at: b.partial + 80, ...P.dlgKeep, len: 16 },
      { at: b.transit + 4, ...P.transitCard, len: 18 },
      { at: a0 + 10, ...P.rest, len: 1 },
      { at: a0 + 56, x: 1360, y: 848, len: 16 },
    ],
    CLICKS
  )

  /* Cameras. */
  /* A sheet is the window's full height: the camera reads its content,
     goes down to the footer for the button, and comes back up. */
  const SHEET_TOP = { x: 660, y: 20, w: 780, h: 440 }
  const SHEET_FOOT = { x: 660, y: 470, w: 780, h: 420 }
  const mdShots: Shot[] = [
    { at: 0, rect: { x: 300, y: 10, w: 1140, h: 520 } },
    { at: b.edit + 30, len: 22, rect: SHEET_TOP },
    { at: b.edit + 48, len: 18, rect: SHEET_FOOT },
    { at: b.edit + 78, len: 20, rect: { x: 660, y: 100, w: 780, h: 460 } },
    { at: b.lock, len: 20, rect: { x: 660, y: 150, w: 780, h: 220 } },
    { at: b.save, len: 20, rect: SHEET_FOOT },
    { at: a0, len: 1, rect: { x: 660, y: 100, w: 780, h: 460 } },
    { at: a0 + 30, len: 20, rect: { x: 660, y: 420, w: 780, h: 470 } },
  ]
  const DIALOG = { x: 330, y: 80, w: 780, h: 740 }
  const boardShots: Shot[] = [
    { at: 0, rect: { x: 560, y: 60, w: 680, h: 340 } },
    { at: b.sheet + 20, len: 24, rect: { x: 740, y: 20, w: 680, h: 520 } },
    { at: b.moveback, len: 18, rect: { x: 740, y: 520, w: 680, h: 380 } },
    { at: b.moveback + 30, len: 22, rect: DIALOG },
    { at: b.racks + 34, len: 24, rect: { x: 560, y: 60, w: 680, h: 340 } },
    { at: b.partial + 14, len: 22, rect: { x: 350, y: 220, w: 740, h: 470 } },
    { at: b.transit, len: 24, rect: { x: 600, y: 60, w: 840, h: 420 } },
    { at: a0 + 96, len: 1, rect: { x: 60, y: 60, w: 760, h: 400 } },
  ]

  const md = (
    <Camera t={t} shots={mdShots}>
      <AppWindow
        dept="merch"
        active="Allotments"
        badges={{ Allotments: 1 }}
        overlay={
          <>
            <Veil opacity={Math.max(sheetIn, addSheet)} />
            {sheetIn > 0 && (
              <AllotmentSheet
                id="ALT-0408"
                supplier="PT Tekstil Jaya"
                stages={STAGES}
                edit={editing ? { store: "Store Kemang", stage: "Packed", lines: editLines } : undefined}
                foot={{
                  hot: editing ? "save" : "edit",
                  pressed: editing ? press(t, b.save + 30) : press(t, b.edit + 70),
                }}
                x={(1 - sheetIn) * 40}
                opacity={sheetIn}
              />
            )}
            {addSheet > 0 && (
              <AllotmentSheet
                id="ALT-0408"
                supplier="PT Tekstil Jaya"
                stages={[{ store: "Store Kemang", stage: "Packed", pcs: 250 }, STAGES[1]]}
                edit={{
                  store: "Store Kemang",
                  stage: "Packed",
                  lines: KEMANG.map((l) => ({ name: l.name, sku: l.sku, now: l.now, next: l.now })),
                }}
                added={addedRow ? { store: "Store Kemang", name: "Celana Chino Tapered · M", sku: "CLN-CHN-TP-M", qty: 30 } : undefined}
                foot={{ hot: "save", pressed: press(t, a0 + 74) }}
                x={(1 - addSheet) * 40}
                opacity={addSheet}
              />
            )}
            <Pointer {...p} />
          </>
        }
      >
        <AllotmentList rows={ROWS} hot={t >= b.edit + 14 && t < b.save + 48 ? "ALT-0408" : undefined} />
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
            <Veil opacity={Math.max(dlg, partialDlg) * 0.9} />
            {sheetBeside > 0 && (
              <CardSheet
                c={{ ...BASE[6], edited: { from: 300, to: 250 } }}
                lines={KEMANG}
                editedAt="10:42"
                foot={{ hot: t > b.moveback + 14 && t < b.moveback + 26, pressed: press(t, b.moveback + 22) }}
                x={(1 - sheetBeside) * 40}
                opacity={sheetBeside}
              />
            )}
            {dlg > 0 && (
              <MoveBackDialog
                store="Store Kemang"
                allotment="ALT-0408"
                pcs={300}
                to="pick"
                lines={KEMANG.filter((l) => l.was - l.now > 0)
                  .concat(KEMANG.filter((l) => l.was === l.now))
                  .map((l) => ({ name: l.name, sku: l.sku, koli: l.koli, now: l.was, back: l.was - l.now }))}
                outcome="K01, K02 reopened · labels reprinted · 50 pcs go back to their racks · nothing to pick again"
                hot={t > b.racks + 10 ? "confirm" : undefined}
                pressed={press(t, b.racks + 18)}
                style={{ opacity: dlg, scale: String(0.96 + 0.04 * dlg) }}
              />
            )}
            {partialDlg > 0 && (
              <MoveBackDialog
                store="Store BSD"
                allotment="ALT-0405"
                pcs={90}
                to="picked"
                lines={[
                  { name: "Polo Pique Basic · L", sku: "PLO-PQ-BS-L", koli: "K01", now: 45, back: t >= b.partial + 50 ? 30 : 0 },
                  { name: "Kaos Crew Basic · M", sku: "KAO-CRW-BS-M", koli: "K02", now: 45, back: 0 },
                ]}
                outcome={
                  t >= b.partial + 50
                    ? "K01 reopened · label reprinted · 30 pcs go back to the picked pile"
                    : "Nothing chosen yet"
                }
                hot={t > b.partial + 90 ? "keep" : undefined}
                pressed={press(t, b.partial + 100)}
                style={{ opacity: partialDlg, scale: String(0.96 + 0.04 * partialDlg) }}
              />
            )}
            <Pointer {...p} />
          </>
        }
      >
        <Board
          cards={cards}
          looks={{
            k1: {
              pulse: edited ? 1 - progress(t, b.strip + 10, b.strip + 40) : 0,
              selected: ticked,
              hot: t > b.moveback && t < b.moveback + 26,
            },
            a1: { pulse: 1 - progress(t, a0 + 104, a0 + 150) },
            t1: { ring: t >= b.transit + 20 && t < a0 ? 1 : 0 },
          }}
          dispatch={{ enabled: ticked }}
        />
      </AppWindow>
    </Camera>
  )

  return (
    <Frame>
      <AbsoluteFill style={{ opacity: fade }}>{onBoard ? board : md}</AbsoluteFill>
      {toasts.map((one) => (
        <FrameToast key={one.text} k={one.k}>
          {one.text}
        </FrameToast>
      ))}
      <Caption t={t} lines={L.captions} />
      <Band
        chapter={3}
        of={5}
        title="MD mengubah jumlah"
        who={onBoard ? GUDANG : MD}
        steps={OB_STEPS}
        at={onBoard ? (t >= a0 ? 1 : 3) : 0}
        done={onBoard ? 3 : 0}
      />
      <Voice chapter="ob3" ids={narration.map((line) => line.id)} start={b} />
      <Sfx
        cues={[
          ...clicks(CLICKS, 0.4),
          { at: b.strip + 8, src: SFX.whoosh, volume: 0.3 },
          { at: b.racks + 24, src: SFX.tick, volume: 0.3 },
          { at: a0 + 100, src: SFX.ding, volume: 0.25 },
        ]}
      />
    </Frame>
  )
}
