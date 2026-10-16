/* Outbound · Bab 1 · MD membuat allotment, narrated (Charon). One beat per
   sentence of src/narration/ob1.json.

   intro       Merchandise › Allotments, Unallotted
   unallotted  goods from received POs, grouped by supplier
   select      Kemeja Oxford Slim ticked → Make new allotment
   matrix      New allotment: SKUs down, stores across, Stock and Left
   fill        the wand → Split evenly across all stores
   tweak       Navy · M: Kemang 10, Bintaro 3 (the row still adds up)
   submit      Submit all → "Saved ALT-0413", and six picklists land on the
               warehouse's board */
import { AbsoluteFill } from "remotion"
import { press, progress, typed } from "../../motion"
import narration from "../../narration/ob1.json"
import durations from "../../narration/ob1.durations.json"
import { useT } from "../../timing"
import { AppWindow } from "../../ui/AppWindow"
import { Camera, FULL, type Shot } from "../../ui/Camera"
import { Pointer } from "../../ui/kit"
import { Band, Caption, FrameToast, GUDANG, MD } from "../../ui/Overlay"
import { Board } from "../../ui/outbound"
import { NewAllotmentPage, UnallottedPage } from "../../ui/outbound2"
import { layout } from "../beats"
import { pointerAt } from "../cursor"
import { Frame } from "../Frame"
import { SFX, Sfx, clicks } from "../Sfx"
import { Voice } from "../Voice"
import { BASE, EVEN, NEW_0413, OB_STEPS, OXFORD_SKUS, SPLIT, STORES } from "./data"

const MINS = { intro: 100, unallotted: 90, select: 100, matrix: 100, fill: 120, tweak: 90, submit: 150 }
const L = layout(narration, durations, MINS)
export const OB1_LEN = L.total + 20
export const OB1_BEATS = L.start
const b = L.start

const GROUPS = [
  {
    supplier: "PT Tekstil Jaya",
    articles: [
      { name: "Kemeja Oxford Slim", code: "00000021", qty: 240, colors: "● Navy, ○ White", sizes: "S – L", date: "08 Oct 2026", shade: "#22304d" },
      { name: "Celana Chino Tapered", code: "00000022", qty: 180, colors: "● Khaki, ● Olive", sizes: "S – XL", date: "08 Oct 2026", shade: "#b59a6d" },
    ],
  },
  {
    supplier: "CV Benang Mas",
    articles: [
      { name: "Kaos Crew Basic", code: "00000019", qty: 300, colors: "● Black, ○ White, +1", sizes: "M – XL", date: "07 Oct 2026", shade: "#1d1f24" },
    ],
  },
]

const P = {
  rest: { x: 1100, y: 620 },
  group: { x: 520, y: 279 },
  tick: { x: 360, y: 377 },
  make: { x: 1035, y: 821 },
  stock: { x: 624, y: 180 },
  left: { x: 1380, y: 180 },
  wand: { x: 560, y: 232 },
  even: { x: 640, y: 332 },
  kemang: { x: 708, y: 338 },
  bintaro: { x: 1124, y: 338 },
  submit: { x: 1220, y: 821 },
}

export function Ob1Create() {
  const t = useT()
  const inMatrix = t >= b.select + 62
  const onBoard = t >= b.submit + 70
  const fade = onBoard ? progress(t, b.submit + 70, b.submit + 82) : inMatrix ? progress(t, b.select + 62, b.select + 74) : 1

  const CLICKS = [b.select + 14, b.select + 56, b.fill + 12, b.fill + 34, b.tweak + 10, b.tweak + 40, b.submit + 16]
  const p = pointerAt(
    t,
    [
      { at: 0, ...P.rest },
      { at: b.unallotted + 10, ...P.group, len: 18 },
      { at: b.select, ...P.tick, len: 14 },
      { at: b.select + 30, ...P.make, len: 18 },
      { at: b.matrix + 10, ...P.stock, len: 18 },
      { at: b.matrix + 50, ...P.left, len: 22 },
      { at: b.fill, ...P.wand, len: 12 },
      { at: b.fill + 20, ...P.even, len: 12 },
      { at: b.tweak, ...P.kemang, len: 10 },
      { at: b.tweak + 28, ...P.bintaro, len: 12 },
      { at: b.submit, ...P.submit, len: 14 },
    ],
    CLICKS
  )

  /* The matrix fills row by row, a frame apart, after Split evenly. */
  const fillAt = b.fill + 36
  const cells = OXFORD_SKUS.map((_, i) =>
    STORES.map((__, j) => {
      if (t < fillAt + i * 3) return 0
      if (i === 1 && j === 0 && t >= b.tweak + 16) return Number(typed("10", t, b.tweak + 14, 0.3) || EVEN[0])
      if (i === 1 && j === 4 && t >= b.tweak + 46) return SPLIT[1][4]
      return EVEN[j]
    })
  )
  const focus =
    t >= b.tweak + 10 && t < b.tweak + 40
      ? { row: 1, col: 0 }
      : t >= b.tweak + 40 && t < b.tweak + 60
        ? { row: 1, col: 4 }
        : undefined
  const menu = progress(t, b.fill + 12, b.fill + 18) * (1 - progress(t, b.fill + 34, b.fill + 38))
  const saved = t >= b.submit + 20 ? "Saved ALT-0413 (Kemeja Oxford Slim)." : undefined

  const mdShots: Shot[] = [
    { at: 0, rect: { x: 300, y: 10, w: 1140, h: 520 } },
    { at: b.unallotted, len: 22, rect: { x: 300, y: 230, w: 1140, h: 400 } },
    { at: b.select + 20, len: 18, rect: { x: 300, y: 400, w: 1140, h: 490 } },
    { at: b.select + 62, len: 1, rect: { x: 300, y: 20, w: 1140, h: 560 } },
    { at: b.fill, len: 20, rect: { x: 300, y: 150, w: 1140, h: 470 } },
    { at: b.submit, len: 20, rect: { x: 300, y: 380, w: 1140, h: 510 } },
  ]

  const md = (
    <Camera t={t} shots={mdShots}>
      <AppWindow dept="merch" active="Allotments" badges={{ Allotments: 1 }} overlay={<Pointer {...p} />}>
        {inMatrix ? (
          <NewAllotmentPage
            supplier="PT Tekstil Jaya"
            article={{ name: "Kemeja Oxford Slim", code: "00000021", shade: "#22304d" }}
            stores={STORES}
            skus={OXFORD_SKUS}
            cells={cells}
            focus={focus}
            menu={{ k: menu, hot: t >= b.fill + 26 ? 1 : undefined }}
            saved={saved}
            submit={{ hot: t > b.submit + 8 && t < b.submit + 20, pressed: press(t, b.submit + 16) }}
          />
        ) : (
          <UnallottedPage
            groups={GROUPS}
            ticked={t >= b.select + 14 ? "00000021" : undefined}
            bar={{
              k: progress(t, b.select + 16, b.select + 28),
              hot: t > b.select + 46 && t < b.select + 60,
              pressed: press(t, b.select + 56),
            }}
          />
        )}
      </AppWindow>
    </Camera>
  )

  const board = (
    <Camera t={t} shots={[{ at: 0, rect: FULL }]}>
      <AppWindow dept="outbound" active="Outbound" column={false}>
        <Board
          cards={[...NEW_0413, ...BASE]}
          looks={Object.fromEntries(
            NEW_0413.map((c, j) => [c.id, { pulse: 1 - progress(t, b.submit + 86 + j * 4, b.submit + 130 + j * 4) }])
          )}
        />
      </AppWindow>
    </Camera>
  )

  const filled = progress(t, fillAt + 4, fillAt + 12) * (1 - progress(t, b.tweak - 6, b.tweak))

  return (
    <Frame>
      <AbsoluteFill style={{ opacity: fade }}>{onBoard ? board : md}</AbsoluteFill>
      <FrameToast k={filled}>Filled 6 SKUs · 240 pcs</FrameToast>
      <Caption t={t} lines={L.captions} />
      <Band
        chapter={1}
        of={5}
        title="MD membuat allotment"
        who={onBoard ? GUDANG : MD}
        steps={OB_STEPS}
        at={onBoard ? progress(t, b.submit + 76, b.submit + 100) : 0}
        done={onBoard ? 1 : 0}
      />
      <Voice chapter="ob1" ids={narration.map((line) => line.id)} start={b} />
      <Sfx
        cues={[
          ...clicks(CLICKS, 0.4),
          { at: fillAt, src: SFX.tick, volume: 0.3 },
          { at: b.submit + 72, src: SFX.whoosh, volume: 0.3 },
          { at: b.submit + 88, src: SFX.ding, volume: 0.25 },
        ]}
      />
    </Frame>
  )
}
