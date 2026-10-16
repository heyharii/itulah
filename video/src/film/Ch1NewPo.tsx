/* Chapter 1 · Membuat PO, narrated (Charon). Every beat is one sentence of
   src/narration/ch1.json and lasts at least as long as it is spoken
   (beats.ts); inside a beat, times count from the beat's start.

   intro    Ops › Receiving — wherever the buyer happens to be
   menu     the rail's Procurement, its tooltip, Purchase Orders, New order
   header   Supplier (searched), Delivery Date (calendar), Payment Method
   newitem  New item: the Add item sheet, the article's name
   units    50, Lusin, Rp 1.020.000 / lusin
   pieces   Submit: the line rises — 600 pcs (50 lusin), Rp 51.000.000
   review   Review order: the read-only review
   submit   Submit folds into the blue dot, which flies to the rail;
            "PO-081026-001 created"; the new row's blue wash drains
   offline  the same Submit with no connection; Offline, then the number
   cancel   the order's sheet: Cancel while nothing has arrived */
import { AbsoluteFill } from "remotion"
import { BOOK, OURS } from "../data"
import { EASE_IN_OUT, arc, lerp, press, progress, typed } from "../motion"
import narration from "../narration/ch1.json"
import durations from "../narration/ch1.durations.json"
import { useT } from "../timing"
import { AppWindow } from "../ui/AppWindow"
import { Camera, FULL, toScreen, type Shot } from "../ui/Camera"
import { AddItem, Composer, Created, KEMEJA_LINE, type ComposerState } from "../ui/Composer"
import { Pointer, Toast, Veil } from "../ui/kit"
import { Band, BUYER, Caption, railPoint } from "../ui/Overlay"
import { PoList } from "../ui/PoList"
import { PoSheet } from "../ui/PoSheet"
import { ReceivingList } from "../ui/Receiving"
import { layout } from "./beats"
import { pointerAt } from "./cursor"
import { Frame } from "./Frame"
import { SFX, Sfx, clicks } from "./Sfx"
import { Voice } from "./Voice"

/* The least each beat needs for its action, in frames. */
const MINS = {
  intro: 120,
  menu: 170,
  header: 236,
  newitem: 120,
  units: 150,
  pieces: 150,
  review: 110,
  submit: 236,
  offline: 236,
  cancel: 120,
}
const L = layout(narration, durations, MINS)
const OUTRO = 40
export const CH1_LEN = L.total + OUTRO
const b = L.start
/** Beat starts, for the contact sheets. */
export const CH1_BEATS = b

/* Window points (1440 × 900) the pointer visits. */
const P = {
  railProcurement: { x: 34, y: 88 },
  navOrders: { x: 150, y: 82 },
  newOrder: { x: 1349, y: 218 },
  supplier: { x: 492, y: 147 },
  supplierPick: { x: 330, y: 195 },
  delivery: { x: 1100, y: 147 },
  day15: { x: 968, y: 337 },
  method: { x: 1100, y: 239 },
  transfer: { x: 900, y: 311 },
  newItem: { x: 1342, y: 303 },
  name: { x: 1000, y: 147 },
  qty: { x: 600, y: 476 },
  unit: { x: 838, y: 476 },
  lusin: { x: 812, y: 560 },
  price: { x: 1120, y: 476 },
  footer: { x: 1360, y: 848 },
  cancel: { x: 1280, y: 848 },
  rest: { x: 1180, y: 640 },
}

const SHOTS: Shot[] = [
  { at: 0, rect: FULL },
  /* The rail and the column, close enough to read the tooltip; then along
     to New order. */
  { at: b.menu, len: 26, rect: { x: 0, y: 0, w: 900, h: 420 } },
  { at: b.menu + 88, len: 26, rect: { x: 540, y: 0, w: 900, h: 420 } },
  { at: b.menu + 136, len: 24, rect: { x: 172, y: 20, w: 1248, h: 340 } },
  { at: b.newitem, len: 20, rect: { x: 172, y: 230, w: 1248, h: 300 } },
  { at: b.newitem + 30, len: 22, rect: { x: 430, y: 60, w: 1000, h: 480 } },
  { at: b.pieces + 34, len: 22, rect: { x: 180, y: 250, w: 1240, h: 270 } },
  { at: b.review, len: 24, rect: { x: 150, y: 0, w: 1290, h: 900 } },
  { at: b.submit + 58, len: 26, rect: FULL },
  { at: b.submit + 112, len: 24, rect: { x: 300, y: 10, w: 1140, h: 520 } },
  { at: b.offline, len: 20, rect: FULL },
  { at: b.offline + 90, len: 22, rect: { x: 300, y: 10, w: 1140, h: 520 } },
  { at: b.cancel + 4, len: 24, rect: { x: 480, y: 0, w: 960, h: 900 } },
]

const CLICKS = [
  b.menu + 40,
  b.menu + 84,
  b.menu + 128,
  b.header + 24,
  b.header + 54,
  b.header + 84,
  b.header + 110,
  b.header + 144,
  b.header + 170,
  b.newitem + 26,
  b.units + 10,
  b.units + 44,
  b.units + 64,
  b.units + 86,
  b.pieces + 30,
  b.review + 44,
  b.submit + 40,
  b.offline + 70,
]

const MOVES = [
  { at: 0, ...P.rest },
  { at: b.menu + 2, ...P.railProcurement, len: 26 },
  { at: b.menu + 60, ...P.navOrders, len: 18 },
  { at: b.menu + 100, ...P.newOrder, len: 24 },
  { at: b.header + 6, ...P.supplier, len: 18 },
  { at: b.header + 42, ...P.supplierPick, len: 10 },
  { at: b.header + 64, ...P.delivery, len: 18 },
  { at: b.header + 92, ...P.day15, len: 14 },
  { at: b.header + 124, ...P.method, len: 16 },
  { at: b.header + 154, ...P.transfer, len: 12 },
  { at: b.newitem + 6, ...P.newItem, len: 18 },
  { at: b.newitem + 40, ...P.name, len: 14 },
  { at: b.units, ...P.qty, len: 10 },
  { at: b.units + 32, ...P.unit, len: 10 },
  { at: b.units + 54, ...P.lusin, len: 8 },
  { at: b.units + 74, ...P.price, len: 10 },
  { at: b.pieces + 8, ...P.footer, len: 20 },
  { at: b.review + 20, ...P.footer, len: 16 },
  { at: b.submit + 18, ...P.footer, len: 10 },
  { at: b.offline + 40, ...P.footer, len: 18 },
  { at: b.offline + 90, ...P.rest, len: 16 },
  { at: b.cancel + 30, ...P.cancel, len: 18 },
]

export function Ch1NewPo() {
  const t = useT()
  const p = pointerAt(t, MOVES, CLICKS)

  /* Where the buyer is: Ops until the rail's Procurement is clicked. */
  const inProcurement = t >= b.menu + 42
  const swap = inProcurement ? progress(t, b.menu + 42, b.menu + 50) : 1
  const tip = progress(t, b.menu + 26, b.menu + 32) * (1 - progress(t, b.menu + 46, b.menu + 50))

  /* The composer and its pickers. */
  const composerIn = progress(t, b.menu + 132, b.menu + 144)
  const h = (n: number) => b.header + n
  const supplierChosen = t >= h(54)
  const supplierSearch = t >= h(24) && !supplierChosen
  const supplierMenu = progress(t, h(30), h(36)) * (1 - progress(t, h(54), h(58)))
  const calendar = progress(t, h(84), h(90)) * (1 - progress(t, h(110), h(114)))
  const methodMenu = progress(t, h(144), h(150)) * (1 - progress(t, h(170), h(174)))

  const addIn = progress(t, b.newitem + 28, b.newitem + 40)
  const addOut = progress(t, b.pieces + 32, b.pieces + 40)
  const unitMenu = progress(t, b.units + 44, b.units + 50) * (1 - progress(t, b.units + 64, b.units + 68))
  const lineIn = progress(t, b.pieces + 42, b.pieces + 54)
  const reviewing = t >= b.review + 48
  const s0 = b.submit
  const composerOut = progress(t, s0 + 56, s0 + 66)
  const pending = t >= s0 + 41 && t < s0 + 56

  /* The fold: the Submit button becomes the dot and flies to the rail. */
  const fold = progress(t, s0 + 50, s0 + 58)
  const fly = progress(t, s0 + 56, s0 + 82, EASE_IN_OUT)
  const from = toScreen(t, SHOTS, { x: 1378, y: 848 })
  const to = railPoint(1)
  const flight = arc(fly, from, { x: lerp(from.x, to.x, 0.5), y: Math.min(from.y, to.y) - 220 }, to)
  const landed = t >= s0 + 82

  /* Offline: a second order made with no connection. */
  const o0 = b.offline
  const offlineSheet = progress(t, o0 + 4, o0 + 16) * (1 - progress(t, o0 + 74, o0 + 82))
  const offlineRow = t >= o0 + 76
  const backOnline = t >= o0 + 160
  const savedToast = progress(t, o0 + 76, o0 + 84) * (1 - progress(t, o0 + 140, o0 + 146))
  const sentToast = progress(t, o0 + 162, o0 + 170) * (1 - progress(t, o0 + 220, o0 + 226))

  const ours = OURS("PO-081026-001")
  const kaos = { supplier: "Sinar Tekstil Nusantara, PT", ordered: 240, orderedValue: 8_400_000 }
  const second = OURS("PO-081026-008", backOnline ? kaos : { ...kaos, status: "Offline" })
  const rows = offlineRow
    ? [second, ours, ...BOOK.slice(0, 4)]
    : t >= s0 + 100
      ? [ours, ...BOOK]
      : BOOK
  const fresh = t < s0 + 100 ? 0 : 1 - progress(t, s0 + 120, s0 + 190)
  const freshSecond = backOnline ? 1 - progress(t, o0 + 170, o0 + 230) : 0
  const sheetIn = progress(t, b.cancel + 2, b.cancel + 16)

  const state: ComposerState = {
    supplier: supplierChosen ? "Garmen Nusantara, PT" : undefined,
    supplierQuery: supplierSearch ? typed("Garm", t, h(28), 0.4) : undefined,
    supplierMenu,
    supplierHover: 0,
    delivery: t >= h(110) ? "15 Oct 2026" : undefined,
    deliveryFocus: calendar > 0,
    calendar,
    dayHover: t >= h(100) ? 15 : undefined,
    method: t >= h(170) ? "Transfer" : undefined,
    methodFocus: methodMenu > 0,
    methodMenu,
    methodHover: t >= h(162) ? "Transfer" : undefined,
    lines: t < b.pieces + 40 ? [] : [KEMEJA_LINE],
    lineIn,
    step: reviewing ? "review" : "edit",
    review: { pressed: press(t, b.review + 44), hover: t > b.review + 36 && t < b.review + 48 },
    submit: { pressed: press(t, s0 + 40), hover: t > s0 + 30 && t < s0 + 56, pending },
  }
  const showComposer = composerIn > 0 && t < s0 + 66
  const veil = showComposer ? composerIn * (1 - composerOut) : Math.max(offlineSheet, sheetIn)

  return (
    <Frame>
      <Camera t={t} shots={SHOTS}>
        <AppWindow
          dept={inProcurement ? "procurement" : "ops"}
          active={inProcurement ? "Purchase Orders" : "Receiving"}
          badges={
            inProcurement
              ? { "Purchase Orders": 5, "Return PO": 2 }
              : { Receiving: 4, Allotment: 8, "Return PO": 2 }
          }
          tip={{ label: "Procurement", index: 0, k: tip }}
          swap={swap}
          pageIn={swap}
          overlay={
            <>
              <Veil opacity={veil} />
              {showComposer && (
                <Composer
                  state={state}
                  x={(1 - composerIn) * 40 + composerOut * 40}
                  opacity={composerIn * (1 - composerOut)}
                />
              )}
              {addIn > 0 && addOut < 1 && (
                <AddItem
                  name={typed("Kemeja Oxford Lengan Panjang", t, b.newitem + 46, 1.2)}
                  nameCaret={t >= b.newitem + 44 && t < b.newitem + 76}
                  division={t >= b.newitem + 84 ? "Pria" : undefined}
                  tags={t >= b.newitem + 92 ? "Kemeja" : undefined}
                  qty={typed("50", t, b.units + 14, 0.3)}
                  qtyCaret={t >= b.units + 10 && t < b.units + 32}
                  unit={t >= b.units + 64 ? "Lusin" : "Piece"}
                  unitOpen={unitMenu}
                  price={typed("1.020.000", t, b.units + 90, 0.55)}
                  priceCaret={t >= b.units + 86 && t < b.pieces + 20}
                  submit={{ pressed: press(t, b.pieces + 30), hover: t > b.pieces + 22 && t < b.pieces + 34 }}
                  x={(1 - addIn) * 40 + addOut * 40}
                  opacity={addIn * (1 - addOut)}
                />
              )}
              {t >= s0 + 66 && t < s0 + 116 && (
                <Created
                  po="PO-081026-001"
                  style={{
                    opacity: progress(t, s0 + 68, s0 + 76) * (1 - progress(t, s0 + 106, s0 + 112)),
                    scale: String(0.96 + 0.04 * progress(t, s0 + 68, s0 + 76)),
                  }}
                >
                  600 pcs · Garmen Nusantara, PT
                </Created>
              )}
              {offlineSheet > 0 && (
                <Composer
                  state={{
                    supplier: kaos.supplier,
                    delivery: "17 Oct 2026",
                    method: "Transfer",
                    lines: [
                      {
                        name: "Kaos Basic Katun Combed",
                        kind: "Pria · Kaos",
                        pieces: 240,
                        inUnit: "12 kodi",
                        price: "Rp 700.000 / kodi",
                        amount: 8_400_000,
                      },
                    ],
                    step: "review",
                    offline: true,
                    submit: { pressed: press(t, o0 + 70), hover: t > o0 + 60 && t < o0 + 74 },
                  }}
                  x={(1 - offlineSheet) * 40}
                  opacity={offlineSheet}
                />
              )}
              {savedToast > 0 && (
                <Toast style={{ opacity: savedToast, translate: `0px ${(1 - savedToast) * 8}px` }}>
                  Saved on this device. It will be sent when you are back online.
                </Toast>
              )}
              {sentToast > 0 && (
                <Toast style={{ opacity: sentToast, translate: `0px ${(1 - sentToast) * 8}px` }}>
                  <span className="font-mono">PO-081026-008</span> created
                </Toast>
              )}
              {sheetIn > 0 && (
                <PoSheet
                  po="PO-081026-001"
                  supplier="Garmen Nusantara, PT"
                  cancel={{ hover: t > b.cancel + 46 }}
                  x={(1 - sheetIn) * 40}
                  opacity={sheetIn}
                />
              )}
              <Pointer {...p} opacity={(t > s0 + 56 && t < s0 + 112 ? 0 : 1) * progress(t, 8, 16)} />
            </>
          }
        >
          {inProcurement ? (
            <PoList
              rows={rows}
              newOrder={{ pressed: press(t, b.menu + 128), hover: t > b.menu + 116 && t < b.menu + 132 }}
              looks={{
                "PO-081026-001": { fresh: offlineRow ? 0 : fresh },
                "PO-081026-008": { fresh: freshSecond },
              }}
            />
          ) : (
            <ReceivingList
              rows={[
                { supplier: "Sepatu Sejahtera, CV", po: "PO-071026-004", items: 2 },
                { supplier: "Sinar Tekstil Nusantara, PT", po: "PO-061026-002", items: 3 },
                { supplier: "Srikandi Busana Mandiri, CV", po: "PO-051026-003", items: 1 },
                {
                  supplier: "Garmen Nusantara, PT",
                  po: "PO-041026-011",
                  items: 1,
                  counted: { pieces: 360, by: "Yusuf Ramadhan", at: "07 Oct, 16:40" },
                },
              ]}
            />
          )}
        </AppWindow>
      </Camera>

      {/* the fold and the flight */}
      {fold > 0 && !landed && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <span
            className="absolute bg-accent"
            style={{
              left: flight.x,
              top: flight.y,
              width: lerp(70 * from.scale, 20, fold),
              height: lerp(36 * from.scale, 20, fold),
              borderRadius: lerp(8 * from.scale, 10, fold),
              translate: "-50% -50%",
              boxShadow: "0 0 0 6px rgb(37 99 235 / 14%)",
            }}
          />
        </AbsoluteFill>
      )}

      <Caption t={t} lines={L.captions} />
      <Band
        chapter={1}
        title="Membuat PO"
        who={BUYER}
        at={landed ? lerp(1, 2, progress(t, L.total + 4, L.total + 34, EASE_IN_OUT)) : 0}
        done={landed ? 1 : 0}
        hideDot={fold > 0 && !landed}
      />
      <Voice chapter="ch1" ids={narration.map((line) => line.id)} start={b} />
      <Sfx
        cues={[
          ...clicks(CLICKS, 0.4),
          { at: s0 + 56, src: SFX.whoosh, volume: 0.4 },
          { at: s0 + 82, src: SFX.ding, volume: 0.35 },
          { at: o0 + 76, src: SFX.tick, volume: 0.3 },
          { at: o0 + 162, src: SFX.ding, volume: 0.25 },
        ]}
      />
    </Frame>
  )
}
