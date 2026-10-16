/* Chapter 3 · Tujuh hasil hitungan.

   The map opens at Receiving and grows a branch for everything a count can
   find. Each branch is then walked the same way, so they can be compared:

     map      the dot runs down the branch; the card says what was ordered,
              what was counted and what was not as ordered (always the same
              600-piece order, only the count changes)
     list     Procurement › Purchase Orders, the order's row
     review   the Review Count, its Difference, and the one button that
              decides it
     result   the stamp, the status word, or the return chip flying to the
              rail's "Return PO"

   Every figure comes from scenarios.ts, i.e. from the Review Count's own
   arithmetic. */
import type { ReactNode } from "react"
import { AbsoluteFill, Sequence } from "remotion"
import { BOOK, OURS, VALUE, type ListRow } from "../data"
import { EASE_IN_OUT, EASE_OUT, arc, lerp, press, progress, typed } from "../motion"
import { BRANCHES, SCENARIOS, correct, summary, type ScenarioId } from "../scenarios"
import narration from "../narration/ch3.json"
import durations from "../narration/ch3.durations.json"
import { useF, useT } from "../timing"
import { AppWindow } from "../ui/AppWindow"
import { Camera, toScreen, type Shot } from "../ui/Camera"
import { FlowMap, STATIONS, branchY, dotOn } from "../ui/FlowMap"
import { Pointer, Stamp, Veil } from "../ui/kit"
import { Band, BUYER, Caption, GUDANG, railPoint } from "../ui/Overlay"
import { PoList } from "../ui/PoList"
import { CountSheet, ReceivingList } from "../ui/Receiving"
import { CloseShortDialog, ReviewCount, type ReviewButton, type ReviewState } from "../ui/ReviewCount"
import { pointerAt } from "./cursor"
import { Frame } from "./Frame"
import { SFX, Sfx, clicks } from "./Sfx"
import { Voice } from "./Voice"
import { makeWarp, type Segment } from "./warp"

/* ── Lengths (authored frames) ──────────────────────────────────────── */

/* Each part was timed by hand at 30 fps (AUTHORED); its segments are held
   until their sentence of src/narration/ch3.json has been said (warp.ts).
   A segment holds on its last frame, so every boundary sits just BEFORE a
   change of picture — the map's crossfade (52), a sheet arriving, a cut. */
type Part = ScenarioId | "intro"
const AUTHORED: Record<Part, number> = {
  intro: 210,
  match: 270,
  shortKeep: 430,
  shortClose: 410,
  over: 400,
  wrong: 560,
  mixed: 420,
  recount: 450,
}
const SEGMENTS: Record<Part, Segment[]> = {
  intro: [{ id: "intro", from: 0 }],
  match: [{ id: "match-map", from: 0 }, { id: "match-ui", from: 52 }],
  shortKeep: [
    { id: "shortKeep-map", from: 0 },
    { id: "shortKeep-review", from: 52 },
    { id: "shortKeep-partial", from: 191 },
    { id: "shortKeep-next", from: 301 },
  ],
  shortClose: [
    { id: "shortClose-map", from: 0 },
    { id: "shortClose-choose", from: 52 },
    { id: "shortClose-removed", from: 262 },
    { id: "shortClose-notcancel", from: 321 },
  ],
  over: [
    { id: "over-map", from: 0 },
    { id: "over-review", from: 52 },
    { id: "over-return", from: 221 },
  ],
  wrong: [
    { id: "wrong-map", from: 0 },
    { id: "wrong-review", from: 52 },
    { id: "wrong-return", from: 231 },
    { id: "wrong-reject", from: 320 },
    { id: "wrong-reject-result", from: 408 },
  ],
  mixed: [
    { id: "mixed-map", from: 0 },
    { id: "mixed-review", from: 52 },
    { id: "mixed-hide", from: 211 },
    { id: "mixed-return", from: 271 },
  ],
  recount: [
    { id: "recount-map", from: 0 },
    { id: "recount-review", from: 52 },
    { id: "recount-send", from: 171 },
    { id: "recount-again", from: 298 },
    { id: "recount-loop", from: 368 },
  ],
}
const WARP = Object.fromEntries(
  (Object.keys(AUTHORED) as Part[]).map((part) => [
    part,
    makeWarp(SEGMENTS[part], narration, durations, AUTHORED[part]),
  ])
) as Record<Part, ReturnType<typeof makeWarp>>

export const INTRO_LEN = WARP.intro.len
export const BRANCH_LEN = Object.fromEntries(
  BRANCHES.map((id) => [id, WARP[id].len])
) as Record<ScenarioId, number>
export const CH3_LEN = INTRO_LEN + BRANCHES.reduce((s, id) => s + BRANCH_LEN[id], 0)

/** The authored frame for this part, and the part's warp. */
function usePart(part: Part) {
  const tn = useT()
  const W = WARP[part]
  return { tn, t: W.authored(tn), W }
}

/** Caption, voice and sound of a part, all on the real clock. */
function Narrated({
  tn,
  W,
  cues,
}: {
  tn: number
  W: ReturnType<typeof makeWarp>
  cues: Parameters<typeof W.cues>[0]
}) {
  return (
    <>
      <Caption t={tn} lines={W.captions} />
      <Voice chapter="ch3" ids={W.voiceIds} start={W.voiceStart} />
      <Sfx cues={W.cues(cues)} />
    </>
  )
}

/* ── Shared pieces ──────────────────────────────────────────────────── */

const MAP_LEN = 60

/** The stamp landing: big and faint, then pressed home with a little give. */
const slam = (t: number, at: number) => {
  const k = progress(t, at, at + 7, EASE_OUT)
  return {
    opacity: k,
    scale: String(lerp(1.5, 1, k) * (t > at + 7 && t < at + 11 ? 0.985 : 1)),
    rotate: "-6deg",
  }
}

/** The map beat that opens every branch, and its card. */
function MapBeat({ t, i, walked }: { t: number; i: number; walked: number[] }) {
  const id = BRANCHES[i]
  const sc = SCENARIOS[id]
  const first = STATIONS[id][0].x
  const reach = dotOn(i, 1).x
  const k = progress(t, 4, 34, EASE_IN_OUT) * ((first - 660 + (branchY(i) - branchY(0))) / (reach - 660 + (branchY(i) - branchY(0))))
  const out = progress(t, MAP_LEN - 8, MAP_LEN)
  /* What the checker wrote on the article rows; Not as Ordered apart. */
  const counted = sc.lines.reduce((s, l) => s + correct(l), 0)
  const ordered = sc.lines.reduce((s, l) => s + l.owed, 0)
  const wrong = sc.lines.reduce((s, l) => s + l.wrong, 0)
  const card = progress(t, 8, 18)
  return (
    <AbsoluteFill style={{ opacity: 1 - out, scale: String(1 + out * 0.04) }}>
      <FlowMap walked={walked} current={{ i, k }} focus={i} />
      <div
        className="absolute left-[160px] top-[52px]"
        style={{ opacity: card, translate: `0px ${(1 - card) * 8}px` }}
      >
        <div className="font-mono text-[1.5rem] text-mute">{sc.po}</div>
        <div className="mt-1 flex items-baseline gap-8 text-[2.5rem] font-semibold tracking-[-0.02em] text-ink tabular-nums">
          <span>
            <span className="font-normal text-body">Dipesan </span>
            {ordered}
          </span>
          <span>
            <span className="font-normal text-body">Dihitung </span>
            {counted}
          </span>
          {wrong > 0 && (
            <span className="text-bad-fg">
              <span className="font-normal text-body">Not as Ordered </span>
              {wrong}
            </span>
          )}
        </div>
      </div>
    </AbsoluteFill>
  )
}

/** The UI half fades in through a little blur, so the cut reads as one
    thing turning into another rather than two pictures swapping. */
function UiBeat({ t, children }: { t: number; children: ReactNode }) {
  const k = progress(t, MAP_LEN - 6, MAP_LEN + 6)
  if (k <= 0) return null
  return (
    <AbsoluteFill
      style={{
        opacity: k,
        filter: k < 1 ? `blur(${(1 - k) * 6}px)` : undefined,
        scale: String(0.985 + 0.015 * k),
      }}
    >
      {children}
    </AbsoluteFill>
  )
}

/** A return chip flying from the order's row to the rail's "Return PO". */
function ReturnChip({
  t,
  at,
  from,
  label,
}: {
  t: number
  at: number
  from: { x: number; y: number }
  label: string
}) {
  const appear = progress(t, at, at + 8)
  const fly = progress(t, at + 22, at + 46, EASE_IN_OUT)
  const gone = progress(t, at + 44, at + 50)
  if (appear <= 0 || gone >= 1) return null
  const to = railPoint(4)
  const p = arc(fly, from, { x: lerp(from.x, to.x, 0.6), y: Math.min(from.y, to.y) - 120 }, to)
  return (
    <div
      className="absolute flex items-center gap-2 rounded-full border border-hairline-2 bg-canvas px-4 py-2 text-[1.25rem] font-medium text-ink shadow-pop"
      style={{
        left: p.x,
        top: p.y,
        translate: "-50% -50%",
        opacity: appear * (1 - gone),
        scale: String(lerp(0.96 + 0.04 * appear, 0.4, fly)),
      }}
    >
      <span className="size-2.5 rounded-full bg-info" />
      <span className="font-mono">{label}</span>
    </div>
  )
}

/* ── The list row, as each branch leaves it ─────────────────────────── */

function rowFor(id: ScenarioId, patch: Partial<ListRow> = {}): ListRow {
  const sc = SCENARIOS[id]
  const ordered = sc.lines.reduce((s, l) => s + l.owed, 0)
  const matched = sc.lines.reduce((s, l) => s + Math.min(correct(l), l.owed), 0)
  const beyond = summary(sc.lines).returnQty
  return OURS(sc.po, {
    items: sc.lines.length,
    ordered,
    orderedValue: id === "mixed" ? 46_920_000 : VALUE,
    received: matched,
    beyond: beyond || undefined,
    receivedValue: Math.round((matched / ordered) * (id === "mixed" ? 46_920_000 : VALUE)),
    ...patch,
  })
}

/* Window points: the first row's Review Count, the sheet's buttons. */
const ROW_Y = 332
const AT = {
  review: { x: 1272, y: ROW_Y },
  close: { x: 1090, y: 848 },
  recount: (short: boolean) => ({ x: short ? 1193 : 1245, y: 848 }),
  partial: { x: 1318, y: 848 },
  submit: { x: 1344, y: 848 },
  send: { x: 1287, y: 848 },
  confirm: { x: 860, y: 556 },
  reason: { x: 720, y: 470 },
}

const LIST_SHOT = { x: 300, y: 10, w: 1140, h: 470 }
const ROW_SHOT = { x: 300, y: 200, w: 1140, h: 260 }
const SHEET_TABLE = { x: 524, y: 20, w: 896, h: 440 }
const SHEET_FOOT = { x: 524, y: 290, w: 896, h: 600 }

/* ── A review branch (3.2 – 3.6) ────────────────────────────────────── */

interface ReviewPlan {
  id: ScenarioId
  i: number
  /** The button that decides it, and when it is pressed. */
  decide: { button: ReviewButton; at: number }
  /** Close Short asks first. */
  dialog?: { reason: string; typeAt: number; confirmAt: number }
  /** What the row reads after. */
  after: Partial<ListRow>
  stamp?: { label: string; tone: "done" | "bad"; at: number }
  ret?: { label: string; at: number }
  /** Hide matched flips on. */
  hideAt?: number
  /** A later delivery that changes the row again. */
  later?: { at: number; patch: Partial<ListRow> }
  /** Anything more, drawn over the list after the decision (frame t). */
  coda?: (t: number) => ReactNode
}

function ReviewBranch({ plan, walked }: { plan: ReviewPlan; walked: number[] }) {
  const { tn, t, W } = usePart(plan.id)
  const sc = SCENARIOS[plan.id]
  const sum = summary(sc.lines)
  const d = plan.decide.at
  const clickReview = MAP_LEN + 40
  const sheetIn = progress(t, clickReview + 4, clickReview + 16)
  const decidedAt = plan.dialog ? plan.dialog.confirmAt : d
  const sheetOut = progress(t, decidedAt + 6, decidedAt + 14)
  const sheet = sheetIn * (1 - sheetOut)
  const reveal = progress(t, clickReview + 24, clickReview + 24 + 8 * sc.lines.length)
  const dialog = plan.dialog
    ? progress(t, d + 4, d + 12) * (1 - progress(t, plan.dialog.confirmAt + 4, plan.dialog.confirmAt + 10))
    : 0
  const decided = t >= decidedAt + 10

  const shots: Shot[] = [
    { at: 0, rect: LIST_SHOT },
    { at: clickReview + 6, len: 24, rect: SHEET_TABLE },
    { at: d - (plan.dialog ? 30 : 40), len: 20, rect: SHEET_FOOT },
    ...(plan.dialog ? [{ at: d + 6, len: 20, rect: { x: 420, y: 150, w: 600, h: 520 } }] : []),
    { at: decidedAt + 8, len: 24, rect: ROW_SHOT },
  ]

  const button = plan.decide.button
  const target =
    button === "close" ? AT.close : button === "partial" ? AT.partial : AT.submit
  const p = pointerAt(
    t,
    [
      { at: 0, x: 1000, y: 600 },
      { at: MAP_LEN + 14, ...AT.review, len: 22 },
      { at: d - 24, ...target, len: 20 },
      ...(plan.dialog
        ? [
            { at: d + 12, ...AT.reason, len: 16 },
            { at: plan.dialog.confirmAt - 16, ...AT.confirm, len: 14 },
          ]
        : []),
      { at: decidedAt + 14, x: 900, y: 700, len: 18 },
    ],
    [clickReview, d, ...(plan.dialog ? [d + 30, plan.dialog.confirmAt] : [])]
  )

  const state: ReviewState = {
    reveal,
    hot: t > d - 8 && t < d + 8 ? button : undefined,
    pressed: press(t, d),
    hideMatched: plan.hideAt !== undefined ? t >= plan.hideAt : undefined,
  }

  const row =
    plan.later && t >= plan.later.at
      ? rowFor(plan.id, plan.later.patch)
      : decided
        ? rowFor(plan.id, plan.after)
        : rowFor(plan.id, { status: "Active" })
  const rows = [row, ...BOOK.slice(0, 4)]
  const look = {
    review: decided ? undefined : { pressed: press(t, clickReview), hover: t > clickReview - 8 && t < clickReview + 4 },
    stamp:
      plan.stamp && t >= plan.stamp.at ? (
        <Stamp tone={plan.stamp.tone} date="8 Oct 2026" style={slam(t, plan.stamp.at)}>
          {plan.stamp.label}
        </Stamp>
      ) : undefined,
  }
  const rowScreen = toScreen(t, shots, { x: 1110, y: ROW_Y })

  return (
    <Frame>
      <MapBeat t={t} i={plan.i} walked={walked} />
      <UiBeat t={t}>
        <Camera t={t} shots={shots}>
          <AppWindow
            dept="procurement"
            active="Purchase Orders"
            badges={{ "Purchase Orders": decided ? 4 : 5, "Return PO": 2 }}
            overlay={
              <>
                <Veil opacity={sheet} />
                {sheet > 0 && (
                  <ReviewCount
                    po={sc.po}
                    supplier="Garmen Nusantara, PT"
                    lines={sc.lines}
                    state={state}
                    x={(1 - sheetIn) * 40 + sheetOut * 40}
                    opacity={sheet}
                  />
                )}
                {dialog > 0 && plan.dialog && (
                  <>
                    <Veil opacity={dialog * 0.6} />
                    <CloseShortDialog
                      shortQty={sum.shortQty}
                      reason={typed(plan.dialog.reason, t, plan.dialog.typeAt, 1.1)}
                      caret={t >= d + 30 && t < plan.dialog.confirmAt - 10}
                      confirm={{
                        pressed: press(t, plan.dialog.confirmAt),
                        hover: t > plan.dialog.confirmAt - 8 && t < plan.dialog.confirmAt + 4,
                      }}
                      style={{ opacity: dialog, scale: String(0.96 + 0.04 * dialog) }}
                    />
                  </>
                )}
                <Pointer {...p} />
              </>
            }
          >
            <PoList rows={rows} looks={{ [sc.po]: look }} />
          </AppWindow>
        </Camera>
        {plan.ret && <ReturnChip t={t} at={plan.ret.at} from={rowScreen} label={plan.ret.label} />}
        <Band
          chapter={3}
          title="Review Count"
          who={BUYER}
          at={plan.stamp && t >= plan.stamp.at + 10 ? lerp(3, 5, progress(t, plan.stamp.at + 10, plan.stamp.at + 34, EASE_IN_OUT)) : 3}
          done={3}
        />
        {plan.coda?.(t)}
      </UiBeat>
      <Narrated
        tn={tn}
        W={W}
        cues={[
          { at: 4, src: SFX.whoosh, volume: 0.25 },
          ...clicks([clickReview, d, ...(plan.dialog ? [d + 30, plan.dialog.confirmAt] : [])], 0.4),
          ...(plan.stamp ? [{ at: plan.stamp.at, src: SFX.stamp, volume: 0.5 }] : []),
          ...(plan.ret ? [{ at: plan.ret.at + 22, src: SFX.whoosh, volume: 0.3 }] : []),
        ]}
      />
    </Frame>
  )
}

/* ── 3.1 Pas: no review at all ──────────────────────────────────────── */

function MatchBranch({ walked }: { walked: number[] }) {
  const { tn, t, W } = usePart("match")
  const stampAt = MAP_LEN + 50
  const shots: Shot[] = [
    { at: 0, rect: LIST_SHOT },
    { at: MAP_LEN + 20, len: 26, rect: ROW_SHOT },
  ]
  const row = rowFor("match", t >= stampAt ? { status: "Fully received" } : { received: 0, receivedValue: 0, beyond: undefined })
  const fill = progress(t, MAP_LEN + 30, stampAt - 2)
  const shown = t >= stampAt ? row : { ...row, received: Math.round(600 * fill), receivedValue: Math.round(VALUE * fill) }
  return (
    <Frame>
      <MapBeat t={t} i={0} walked={walked} />
      <UiBeat t={t}>
        <Camera t={t} shots={shots}>
          <AppWindow dept="procurement" active="Purchase Orders" badges={{ "Purchase Orders": 5, "Return PO": 2 }}>
            <PoList
              rows={[shown, ...BOOK.slice(0, 4)]}
              looks={{
                [SCENARIOS.match.po]: {
                  stamp:
                    t >= stampAt ? (
                      <Stamp tone="done" date="8 Oct 2026" style={slam(t, stampAt)}>
                        Fully received
                      </Stamp>
                    ) : undefined,
                },
              }}
            />
          </AppWindow>
        </Camera>
        <Band
          chapter={3}
          title="Hasil hitungan"
          who={BUYER}
          at={t >= stampAt + 10 ? lerp(2, 5, progress(t, stampAt + 10, stampAt + 40, EASE_IN_OUT)) : 2}
          done={2}
        />
      </UiBeat>
      <Narrated
        tn={tn}
        W={W}
        cues={[
          { at: 4, src: SFX.whoosh, volume: 0.25 },
          { at: stampAt, src: SFX.stamp, volume: 0.5 },
        ]}
      />
    </Frame>
  )
}

/* ── 3.7 Recount ────────────────────────────────────────────────────── */

function RecountBranch({ walked }: { walked: number[] }) {
  const { tn, t, W } = usePart("recount")
  const sc = SCENARIOS.recount
  const clickReview = MAP_LEN + 40
  const recountAt = 170
  const sendAt = 262
  const sheetIn = progress(t, clickReview + 4, clickReview + 16)
  const sheetOut = progress(t, sendAt + 6, sendAt + 14)
  const sheet = sheetIn * (1 - sheetOut)
  const recounting = t >= recountAt + 4
  const ops = t >= 300
  const loop = progress(t, 380, 440, EASE_IN_OUT)
  const shots: Shot[] = [
    { at: 0, rect: LIST_SHOT },
    { at: clickReview + 6, len: 24, rect: SHEET_TABLE },
    { at: recountAt - 30, len: 20, rect: SHEET_FOOT },
    { at: recountAt + 10, len: 22, rect: { x: 524, y: 120, w: 896, h: 520 } },
    { at: sendAt - 24, len: 18, rect: SHEET_FOOT },
    { at: 300, len: 1, rect: { x: 300, y: 10, w: 1140, h: 470 } },
  ]
  const p = pointerAt(
    t,
    [
      { at: 0, x: 1000, y: 600 },
      { at: MAP_LEN + 14, ...AT.review, len: 22 },
      { at: recountAt - 22, ...AT.recount(true), len: 18 },
      { at: recountAt + 14, x: 820, y: 520, len: 16 },
      { at: sendAt - 20, ...AT.send, len: 16 },
      { at: sendAt + 14, x: 900, y: 700, len: 18 },
    ],
    [clickReview, recountAt, recountAt + 30, sendAt]
  )
  const why = "Hitung ulang, rak belakang belum terhitung"
  const state: ReviewState = {
    reveal: progress(t, clickReview + 24, clickReview + 32),
    hot: t > recountAt - 8 && t < recountAt + 6 ? "recount" : t > sendAt - 8 && t < sendAt + 6 ? "send" : undefined,
    pressed: t < recountAt + 10 ? press(t, recountAt) : press(t, sendAt),
    recount: recounting ? { ticked: [0], why: typed(why, t, recountAt + 34, 0.9), caret: t >= recountAt + 30 && t < sendAt - 12 } : undefined,
  }
  return (
    <Frame>
      <MapBeat t={t} i={6} walked={walked} />
      {t < 380 && (
        <UiBeat t={t}>
          <Camera t={t} shots={shots}>
            {ops ? (
              <AppWindow dept="ops" active="Receiving" badges={{ Receiving: 4, Allotment: 8, "Return PO": 2 }}>
                <ReceivingList
                  rows={[
                    { supplier: "Garmen Nusantara, PT", po: sc.po, items: 1, again: true },
                    { supplier: "Sepatu Sejahtera, CV", po: "PO-071026-004", items: 2 },
                    { supplier: "Sinar Tekstil Nusantara, PT", po: "PO-061026-002", items: 3 },
                    { supplier: "Srikandi Busana Mandiri, CV", po: "PO-051026-003", items: 1 },
                  ]}
                  hot={{ po: sc.po, pressed: 1 }}
                />
              </AppWindow>
            ) : (
              <AppWindow
                dept="procurement"
                active="Purchase Orders"
                badges={{ "Purchase Orders": 5, "Return PO": 2 }}
                overlay={
                  <>
                    <Veil opacity={sheet} />
                    {sheet > 0 && (
                      <ReviewCount
                        po={sc.po}
                        supplier="Garmen Nusantara, PT"
                        lines={sc.lines}
                        state={state}
                        x={(1 - sheetIn) * 40 + sheetOut * 40}
                        opacity={sheet}
                      />
                    )}
                    <Pointer {...p} />
                  </>
                }
              >
                <PoList
                  rows={[rowFor("recount"), ...BOOK.slice(0, 4)]}
                  looks={{ [sc.po]: { review: { pressed: press(t, clickReview), hover: t > clickReview - 8 && t < clickReview + 4 } } }}
                />
              </AppWindow>
            )}
          </Camera>
          <Band
            chapter={3}
            title={ops ? "Kembali ke Gudang" : "Review Count"}
            who={ops ? GUDANG : BUYER}
            at={ops ? lerp(3, 2, progress(t, 304, 330, EASE_IN_OUT)) : 3}
            done={2}
          />
        </UiBeat>
      )}
      {t >= 370 && (
        <AbsoluteFill style={{ opacity: progress(t, 370, 380) }}>
          <FlowMap walked={[...walked, ...(loop >= 1 ? [6] : [])]} current={loop < 1 ? { i: 6, k: 1 } : undefined} trunk={2} />
          <LoopDot k={loop} />
        </AbsoluteFill>
      )}
      <Narrated
        tn={tn}
        W={W}
        cues={[
          { at: 4, src: SFX.whoosh, volume: 0.25 },
          ...clicks([clickReview, recountAt, recountAt + 30, sendAt], 0.4),
          { at: 380, src: SFX.whoosh, volume: 0.25 },
        ]}
      />
    </Frame>
  )
}

/** The dot riding Recount's loop back up to Receiving. */
function LoopDot({ k }: { k: number }) {
  if (k <= 0 || k >= 1) return null
  const y = branchY(6)
  const pts = [
    { x: 860, y },
    { x: 940, y: y + 32 },
    { x: 860, y: y + 64 },
    { x: 600, y: y + 64 },
    { x: 560, y: y + 24 },
    { x: 560, y: branchY(0) + 28 },
    { x: 600, y: branchY(0) },
    { x: 660, y: branchY(0) },
  ]
  const lens = pts.slice(1).map((pt, j) => Math.hypot(pt.x - pts[j].x, pt.y - pts[j].y))
  let dd = k * lens.reduce((a, b) => a + b, 0)
  let at = pts[pts.length - 1]
  for (let j = 0; j < lens.length; j++) {
    if (dd <= lens[j]) {
      at = { x: lerp(pts[j].x, pts[j + 1].x, dd / lens[j]), y: lerp(pts[j].y, pts[j + 1].y, dd / lens[j]) }
      break
    }
    dd -= lens[j]
  }
  return (
    <span
      className="absolute size-[26px] rounded-full bg-accent shadow-[0_0_0_8px_rgb(37_99_235/16%)]"
      style={{ left: at.x - 13, top: at.y - 13 }}
    />
  )
}

/* ── The intro: the map grows its branches ──────────────────────────── */

function Intro() {
  const { tn, t, W } = usePart("intro")
  const draw = progress(t, 6, 96, EASE_IN_OUT)
  const head = progress(t, 4, 16)
  const f1 = progress(t, 100, 112)
  const f2 = progress(t, 120, 132)
  return (
    <Frame>
      <FlowMap draw={draw} trunk={2} />
      <div className="absolute top-[56px] left-[160px]" style={{ opacity: head, translate: `0px ${(1 - head) * 8}px` }}>
        <div className="text-[3.25rem] leading-none font-semibold tracking-[-0.025em] text-ink">
          Tujuh hasil hitungan
        </div>
      </div>
      <div className="absolute top-[58px] right-[120px] text-right text-[1.625rem] leading-[2.5rem] text-body">
        <div style={{ opacity: f1, translate: `0px ${(1 - f1) * 8}px` }}>
          <b className="font-semibold text-ink">Selisih</b> = Dihitung − Masih ditunggu
        </div>
        <div style={{ opacity: f2, translate: `0px ${(1 - f2) * 8}px` }}>
          <b className="font-semibold text-ink">Not as Ordered</b>: dihitung terpisah, selalu dikembalikan
        </div>
      </div>
      <Narrated tn={tn} W={W} cues={[{ at: 8, src: SFX.whoosh, volume: 0.3 }]} />
    </Frame>
  )
}

/* ── The plans ──────────────────────────────────────────────────────── */

const PLANS: Record<Exclude<ScenarioId, "match" | "recount">, ReviewPlan> = {
  shortKeep: {
    id: "shortKeep",
    i: 1,
    decide: { button: "partial", at: 230 },
    after: { status: "Partially received", beyond: undefined },
    later: { at: 360, patch: { status: "Fully received", received: 600, receivedValue: VALUE, beyond: undefined } },
    stamp: { label: "Fully received", tone: "done", at: 372 },
  },
  shortClose: {
    id: "shortClose",
    i: 2,
    decide: { button: "close", at: 196 },
    dialog: { reason: "Supplier tidak bisa kirim sisa 20", typeAt: 232, confirmAt: 296 },
    after: { status: "Closed short", beyond: undefined },
    stamp: { label: "Closed short", tone: "bad", at: 330 },
  },
  over: {
    id: "over",
    i: 3,
    decide: { button: "submit", at: 220 },
    after: { status: "Fully received" },
    stamp: { label: "Fully received", tone: "done", at: 250 },
    ret: { label: "RS-00000001 · 20 pcs", at: 262 },
  },
  wrong: {
    id: "wrong",
    i: 4,
    decide: { button: "partial", at: 230 },
    after: { status: "Partially received" },
    ret: { label: "RS-00000002 · 15 pcs", at: 248 },
    coda: (t) => <RejectAll t={t} />,
  },
  mixed: {
    id: "mixed",
    i: 5,
    decide: { button: "submit", at: 270 },
    after: { status: "Fully received" },
    stamp: { label: "Fully received", tone: "done", at: 300 },
    ret: { label: "RS-00000003 · 30 pcs", at: 312 },
    hideAt: 214,
  },
}

/** The coda of "tidak sesuai": the whole delivery written as not as ordered. */
function RejectAll({ t }: { t: number }) {
  /* No fade at the end: the branch cuts to the next map from here, and the
     last sentence is held on this picture. */
  const k = progress(t, 322, 334)
  if (k <= 0) return null
  const review = t >= 410
  const sheetIn = progress(t, 410, 422)
  /* The table first (0 counted, −600), then down to what happens to it. */
  const shots: Shot[] = review
    ? [{ at: 0, rect: SHEET_TABLE }, { at: 470, len: 24, rect: SHEET_FOOT }]
    : [{ at: 0, rect: { x: 400, y: 80, w: 1020, h: 420 } }]
  return (
    <AbsoluteFill style={{ opacity: k, background: "#efeff1" }}>
      <Camera t={t} shots={shots}>
        {review ? (
          <AppWindow
            dept="procurement"
            active="Purchase Orders"
            badges={{ "Purchase Orders": 5, "Return PO": 2 }}
            overlay={
              <>
                <Veil opacity={sheetIn} />
                <ReviewCount
                  po={REJECTED.po}
                  supplier="Garmen Nusantara, PT"
                  lines={REJECTED.lines}
                  state={{ reveal: progress(t, 426, 434) }}
                  x={(1 - sheetIn) * 40}
                  opacity={sheetIn}
                />
              </>
            }
          >
            <PoList rows={[rowFor("wrong", { status: "Active" }), ...BOOK.slice(0, 4)]} />
          </AppWindow>
        ) : (
          <AppWindow
            dept="ops"
            active="Receiving"
            badges={{ Receiving: 4 }}
            overlay={
              <>
                <Veil opacity={1} />
                <CountSheet
                  po={REJECTED.po}
                  supplier="Garmen Nusantara, PT"
                  lines={[
                    {
                      article: "Kemeja Oxford Lengan Panjang",
                      kind: "Pria · Kemeja",
                      /* Rejecting the whole lorry: none of it is the
                         article, so the article is counted 0 and every
                         piece goes to Not as Ordered. */
                      typed: "0",
                      unit: "Piece",
                      pieces: 0,
                    },
                  ]}
                  wrong={{ typed: typed("600", t, 350, 0.25), caret: t >= 346 && t < 380, pieces: t >= 362 ? 600 : 0 }}
                  submit={{ enabled: true }}
                />
              </>
            }
          >
            <div />
          </AppWindow>
        )}
      </Camera>
      <Band
        chapter={3}
        title={review ? "Review Count" : "Menolak seluruh kiriman"}
        who={review ? BUYER : GUDANG}
        at={review ? 3 : 2}
        done={2}
      />
    </AbsoluteFill>
  )
}

/** The rejected lorry as the Review Count sees it: 0 of the article, all
    600 pieces not as ordered (stored on the line, as the node keeps them). */
const REJECTED = {
  po: "PO-081026-009",
  lines: [
    {
      article: "Kemeja Oxford Lengan Panjang",
      kind: "Pria · Kemeja",
      owed: 600,
      counted: 600,
      wrong: 600,
    },
  ],
}

/* ── The chapter ────────────────────────────────────────────────────── */

export function Ch3Outcomes() {
  const f = useF()
  let from = INTRO_LEN
  const parts: ReactNode[] = [
    <Sequence key="intro" durationInFrames={f(INTRO_LEN)} name="Intro">
      <Intro />
    </Sequence>,
  ]
  BRANCHES.forEach((id, i) => {
    const walked = Array.from({ length: i }, (_, j) => j).filter((j) => j !== 6)
    const body =
      id === "match" ? (
        <MatchBranch walked={walked} />
      ) : id === "recount" ? (
        <RecountBranch walked={walked} />
      ) : (
        <ReviewBranch plan={PLANS[id]} walked={walked} />
      )
    parts.push(
      <Sequence key={id} from={f(from)} durationInFrames={f(BRANCH_LEN[id])} name={SCENARIOS[id].name}>
        {body}
      </Sequence>
    )
    from += BRANCH_LEN[id]
  })
  return <AbsoluteFill>{parts}</AbsoluteFill>
}

/** One branch on its own, for the per-branch clips. */
export function Ch3Branch({ id }: { id: ScenarioId }) {
  const i = BRANCHES.indexOf(id)
  const walked = Array.from({ length: i }, (_, j) => j)
  if (id === "match") return <MatchBranch walked={walked} />
  if (id === "recount") return <RecountBranch walked={walked} />
  return <ReviewBranch plan={PLANS[id]} walked={walked} />
}

export { Intro as Ch3Intro }
