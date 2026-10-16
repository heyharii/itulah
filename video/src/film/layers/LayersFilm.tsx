/* Layers film (14 Oct 2026): the hub's layered shell told the way the
   Shopify Editions reel tells its admin — a camera over one tilted plane,
   one idea per shot. Content is the PO book; the look is C (the tray).

   1  Shell     the outer rail lies tilted, the camera drifts down it; the
                plane comes flat as the tray, the inner sidebar and the page
                arrive.
   2  Layers    a PO row opens the record sheet, Edit swaps it to the form,
                + Add item lays the nested sheet over it; the camera tilts and
                the layers lift apart; flat again, Escape walks back the
                same way, one layer at a time.
   3  Tools     the bell's badge → Notifications → a record over it, Escape ×2;
                ⌘K → Search, typing, a result → its record, Escape ×2;
                Ask AI → a question → an answer with its orders, Escape.
   4  Format    one frame walks the page's slots (Header, Summary, Tabs, Bar,
                Table), then the same slots in a sheet (+ Foot), with the
                shared heights drawn as lines.
   5  Row       every surface side by side, the Header and Foot lines running
                straight through all of them. Then the mark.

   Moves, as in the hub: a camera travelling = ease-in-out; anything
   arriving = ease-out; a sheet = the drawer curve in, ease-out back the way
   it came (200ms); a view ⇄ edit swap = out 100ms, in 160ms. */
import type { CSSProperties, ReactNode } from "react"
import { AbsoluteFill } from "remotion"
import { EASE_DRAWER, EASE_IN_OUT, EASE_OUT, enter, lerp, press, progress, typed } from "../../motion"
import { useT } from "../../timing"
import { pointerAt } from "../cursor"
import { clicks, SFX, Sfx, type Cue } from "../Sfx"
import {
  AI_ANSWER,
  AI_PROMPT,
  AI_ROW,
  AI_SEND,
  AiSheet,
  BELL,
  css,
  frames,
  Keycap,
  NestedSheet,
  noteY,
  NotificationsSheet,
  Panel,
  PoPage,
  Pointer,
  Rail,
  RAIL_PROCUREMENT,
  RECORD_ADD,
  RECORD_EDIT,
  RecordSheet,
  ROW0,
  ROW_H,
  SEARCH_FIELD,
  SEARCH_HIT,
  SEARCH_QUERY,
  SearchSheet,
  sheetAt,
  WIN,
  type Box,
  type Look,
} from "../../ui/layers"

/* ── beats (authored frames, 30 fps) ──────────────────────────────────── */

const B = {
  /* 1 shell */
  railIn: 2,
  pillMove: 62,
  tray: 124,
  collapse: 126,
  page: 138,
  /* 2 layers */
  openRow: 226,
  edit: 270,
  add: 306,
  explode: 352,
  labels: 396,
  labelsOut: 456,
  collapseStack: 466,
  esc: [530, 550, 570],
  /* 3 tools */
  bellZoom: 596,
  badge: 634,
  bellClick: 664,
  noteClick: 728,
  noteEsc: [776, 794],
  cmdK: 812,
  cmdPress: 826,
  searchIn: 842,
  type: 858,
  results: 884,
  hitClick: 944,
  searchEsc: [990, 1008],
  aiClick: 1046,
  aiType: 1072,
  send: 1132,
  answer: 1150,
  aiEsc: [1240],
  /* 4 format */
  format: 1258,
  slots: [1290, 1330, 1370, 1410, 1450, 1512, 1552, 1592, 1632],
  formatSheet: 1492,
  formatOut: 1676,
  /* 5 row */
  row: 1680,
  deal: 1704,
  lines: 1736,
  end: 1946,
}
export const LAYERS_LEN = 2030

/* ── the camera ───────────────────────────────────────────────────────── */

interface Pose {
  cx: number
  cy: number
  s: number
  rx: number
  rz: number
}
const FLAT: Pose = { cx: WIN.w / 2, cy: WIN.h / 2, s: 1.2, rx: 0, rz: 0 }

/** Shots blend in order: each eases from wherever the camera is. */
function shots(look: Look): { at: number; len: number; pose: Pose }[] {
  const search = sheetAt(look, 540, 1)
  const ai = sheetAt(look, 540, 1)
  return [
    { at: 0, len: 1, pose: { cx: 120, cy: 140, s: 3.1, rx: 48, rz: -32 } },
    { at: 0, len: 120, pose: { cx: 120, cy: 470, s: 2.6, rx: 48, rz: -32 } },
    { at: 100, len: 72, pose: FLAT },
    { at: B.explode - 2, len: 60, pose: { cx: 800, cy: 330, s: 0.62, rx: 50, rz: -30 } },
    { at: B.explode + 53, len: 58, pose: { cx: 800, cy: 330, s: 0.64, rx: 50, rz: -25 } },
    { at: B.collapseStack, len: 52, pose: FLAT },
    { at: B.bellZoom, len: 38, pose: { cx: 120, cy: BELL.y - 40, s: 3.0, rx: 24, rz: -10 } },
    { at: B.bellClick - 2, len: 40, pose: FLAT },
    { at: B.type - 12, len: 28, pose: { cx: search.x + SEARCH_FIELD.dx + 60, cy: search.y + SEARCH_FIELD.y + 50, s: 2.3, rx: 16, rz: -6 } },
    { at: B.results + 8, len: 34, pose: FLAT },
    { at: B.aiType - 16, len: 28, pose: { cx: ai.x + 230, cy: ai.y + ai.h - 80, s: 2.3, rx: 16, rz: -6 } },
    { at: B.send + 6, len: 34, pose: FLAT },
    { at: B.row, len: 60, pose: { cx: 1400, cy: 450, s: 0.62, rx: 36, rz: -16 } },
    { at: B.lines, len: 130, pose: { cx: 4500, cy: 450, s: 0.6, rx: 36, rz: -16 } },
    { at: B.lines + 122, len: 64, pose: { cx: 3500, cy: 380, s: 0.36, rx: 44, rz: -24 } },
  ]
}

function poseAt(t: number, list: ReturnType<typeof shots>): Pose {
  let p = list[0].pose
  for (const shot of list.slice(1)) {
    const k = progress(t, shot.at, shot.at + shot.len, EASE_IN_OUT)
    if (k <= 0) continue
    p = {
      cx: lerp(p.cx, shot.pose.cx, k),
      cy: lerp(p.cy, shot.pose.cy, k),
      s: Math.exp(lerp(Math.log(p.s), Math.log(shot.pose.s), k)),
      rx: lerp(p.rx, shot.pose.rx, k),
      rz: lerp(p.rz, shot.pose.rz, k),
    }
  }
  return p
}

/* ── small helpers ────────────────────────────────────────────────────── */

/** 0 → 1 → 0: in over `inLen` from `a`, out over `outLen` from `b`. */
const span = (t: number, a: number, b: number, inLen = 8, outLen = 8) =>
  progress(t, a, a + inLen) * (1 - progress(t, b, b + outLen))

/** A sheet's slide: in on the drawer curve, back out on ease-out, 200ms. */
const sheetK = (t: number, open: number, close = Infinity) =>
  progress(t, open, open + 12, EASE_DRAWER) * (1 - progress(t, close, close + 6, EASE_OUT))

const RING = "0 0 0 1px rgb(0 0 0 / 5%), 0 2px 8px rgb(0 0 0 / 4%), 0 24px 72px rgb(0 0 0 / 8%)"
const WARM = "0 0 0 1px rgb(80 60 30 / 6%), 0 2px 6px rgb(80 60 30 / 5%)"
const DIM = "rgb(210 208 204 / 48%)"
const BLUE = "#2862dc"
const Z = { rail: 70, tray: 180, page: 300, veil: 320, record: 480, nested: 660 }

function Layer({
  box,
  z = 0,
  slide = 0,
  shadow,
  bg = "#fff",
  opacity = 1,
  children,
}: {
  box: Box
  z?: number
  slide?: number
  shadow?: string
  bg?: string
  opacity?: number
  children?: ReactNode
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        borderRadius: box.r,
        background: bg,
        overflow: "hidden",
        boxShadow: shadow,
        opacity,
        transform: `translate3d(${slide}px, 0px, ${z}px)`,
      }}
    >
      {children}
    </div>
  )
}

/** A sheet in the stack: slides along its own width; dims when covered. */
function Sheet({ box, k, dim = 0, z = 0, children }: { box: Box; k: number; dim?: number; z?: number; children: ReactNode }) {
  if (k <= 0) return null
  return (
    <Layer box={box} z={z} slide={(1 - k) * (box.w + 40)} shadow={RING}>
      {children}
      {dim > 0 && <div style={{ position: "absolute", inset: 0, background: DIM, opacity: dim }} />}
    </Layer>
  )
}

function Tag({ x, y, z = 0, k, size = 40, color = "#1d1d1f", align = "left", children }: { x: number; y: number; z?: number; k: number; size?: number; color?: string; align?: "left" | "right"; children: ReactNode }) {
  if (k <= 0) return null
  return (
    <div
      style={{
        position: "absolute",
        left: align === "left" ? x : undefined,
        right: align === "right" ? WIN.w - x : undefined,
        top: y,
        fontSize: size,
        fontWeight: 600,
        letterSpacing: "-.01em",
        color,
        whiteSpace: "nowrap",
        opacity: k,
        transform: `translate3d(0px, ${(1 - k) * 10}px, ${z}px)`,
      }}
    >
      {children}
    </div>
  )
}

/* ── 4 · the format: where each slot sits, in window space ────────────── */

interface Slot {
  name: string
  spec: string
  box: { x: number; y: number; w: number; h: number }
  /** Where its name sits: left edge, vertical centre — in clear space. */
  tag: { x: number; y: number }
}

function formatSlots(look: Look): Slot[] {
  const { page } = frames(look)
  const rec = sheetAt(look, 960, 1)
  const inPage = (y: number, h: number, w = page.w - 56) => ({ x: page.x + 28 - 10, y: page.y + y - 8, w: w + 20, h: h + 16 })
  const inSheet = (y: number, h: number, w = rec.w - 56) => ({ x: rec.x + 28 - 10, y: rec.y + y - 8, w: w + 20, h: h + 16 })
  return [
    { name: "Header", spec: "Title 17 · subtitle 14", box: { x: page.x + 2, y: page.y + 2, w: page.w - 4, h: 111 }, tag: { x: page.x + 520, y: page.y + 57 } },
    { name: "Summary", spec: "Label 14 · figure 16", box: inPage(139, 45, 560), tag: { x: page.x + 640, y: page.y + 161 } },
    { name: "Tabs", spec: "Pages only", box: inPage(204, 39), tag: { x: page.x + 520, y: page.y + 223 } },
    { name: "Bar", spec: "Search left · actions right", box: inPage(257, 36), tag: { x: page.x + 700, y: page.y + 275 } },
    { name: "Table", spec: "Text 15 · one frame", box: inPage(307, 530), tag: { x: page.x + 520, y: page.y + 470 } },
    { name: "Header", spec: "Same height as the page", box: { x: rec.x + 2, y: rec.y + 2, w: rec.w - 4, h: 111 }, tag: { x: rec.x + 400, y: rec.y + 57 } },
    { name: "Summary", spec: "Same line as the page", box: inSheet(139, 45, 600), tag: { x: rec.x + 660, y: rec.y + 161 } },
    { name: "Table", spec: "Same table", box: inSheet(250, 245), tag: { x: rec.x + 420, y: rec.y + 410 } },
    { name: "Foot", spec: "Sheets only · Print left, actions right", box: { x: rec.x + 2, y: rec.y + rec.h - 67, w: rec.w - 4, h: 65 }, tag: { x: rec.x + 150, y: rec.y + rec.h - 34 } },
  ]
}

const LEGEND = ["Header", "Summary", "Tabs", "Bar", "Table", "Foot"]

/* ── 5 · the row: every surface side by side ──────────────────────────── */

const ROW_CARDS = [
  { kind: "record", w: 960, label: "Detail" },
  { kind: "form", w: 960, label: "Form" },
  { kind: "nested", w: 540, label: "Nested" },
  { kind: "notes", w: 540, label: "Notifications" },
  { kind: "search", w: 540, label: "Search" },
  { kind: "ai", w: 540, label: "Ask AI" },
] as const

function rowBoxes(look: Look) {
  const { page } = frames(look)
  let x = WIN.w + 60
  return ROW_CARDS.map((c) => {
    const box: Box = { x, y: page.y, w: c.w, h: page.h, r: 16 }
    x += c.w + 48
    return box
  })
}

/* ── the film ─────────────────────────────────────────────────────────── */

export function LayersFilm({ look = "c" }: { look?: Look }) {
  const t = useT()
  const f = frames(look)
  const cam = poseAt(t, shots(look))
  /* Laid out at the camera's own scale (never below 1x): crisp in the
     close-ups, exactly 1:1 when the window sits flat. */
  const ZOOM = Math.max(1, cam.s)

  /* 1 · shell */
  const arrive = (n: number) => {
    const order = n < 0 ? 0 : n >= 100 ? 15 + (n - 100) : n + 1
    return progress(t, B.railIn + order * 3, B.railIn + order * 3 + 14)
  }
  const pill = lerp(0, RAIL_PROCUREMENT, progress(t, B.pillMove, B.pillMove + 18, EASE_IN_OUT))
  const expand = 1 - progress(t, B.collapse, B.collapse + 16, EASE_IN_OUT)
  const trayK = progress(t, B.tray, B.tray + 16)
  const panelK = progress(t, B.tray + 8, B.tray + 20)
  const pageK = progress(t, B.page, B.page + 14)
  const slots = (n: number) => progress(t, B.page + 4 + n * 3, B.page + 14 + n * 3)
  const badge = progress(t, B.badge, B.badge + 8) * (1 - progress(t, B.bellClick + 10, B.bellClick + 16))

  /* 2 · layers */
  const e = progress(t, B.explode, B.explode + 52, EASE_IN_OUT) * (1 - progress(t, B.collapseStack, B.collapseStack + 50, EASE_IN_OUT))
  const rec1 = sheetAt(look, 960, 1)
  const nest1 = sheetAt(look, 540, 2)
  const recordK = sheetK(t, B.openRow, B.esc[2])
  const nestedK = sheetK(t, B.add, B.esc[0])
  const view = 1 - progress(t, B.edit + 1, B.edit + 4) + progress(t, B.esc[1] + 3, B.esc[1] + 8)
  const edit = progress(t, B.edit + 4, B.edit + 9) * (1 - progress(t, B.esc[1], B.esc[1] + 3))
  const recordDim = progress(t, B.add, B.add + 10) * (1 - progress(t, B.esc[0], B.esc[0] + 6)) * (1 - e)
  const labelK = (d: number) => progress(t, B.labels + d, B.labels + d + 14) * (1 - progress(t, B.labelsOut, B.labelsOut + 10))

  /* 3 · tools */
  const tool = sheetAt(look, 540, 1)
  const over = sheetAt(look, 960, 2)
  const notesK = sheetK(t, B.bellClick, B.noteEsc[1])
  const notesRecK = sheetK(t, B.noteClick, B.noteEsc[0])
  const notesDim = progress(t, B.noteClick, B.noteClick + 10) * (1 - progress(t, B.noteEsc[0], B.noteEsc[0] + 6))
  const cmd = span(t, B.cmdK, B.searchIn - 2, 8, 8)
  const searchK = sheetK(t, B.searchIn, B.searchEsc[1])
  const searchRecK = sheetK(t, B.hitClick, B.searchEsc[0])
  const searchDim = progress(t, B.hitClick, B.hitClick + 10) * (1 - progress(t, B.searchEsc[0], B.searchEsc[0] + 6))
  const query = typed(SEARCH_QUERY, t, B.type, 0.3)
  const typing = (from: number, to: number) => t >= from && t < to
  const blink = Math.floor(t / 15) % 2 === 0
  const results = (n: number) => progress(t, B.results + n * 3, B.results + 10 + n * 3)
  const aiK = sheetK(t, B.aiClick, B.aiEsc[0])
  const draft = t < B.send ? typed(AI_PROMPT, t, B.aiType, 0.5) : ""
  const sent = progress(t, B.send + 2, B.send + 12)
  const answer = typed(AI_ANSWER, t, B.answer, 0.9)
  const aiRows = (i: number) => progress(t, B.answer + 40 + i * 5, B.answer + 50 + i * 5)

  /* 4 · format */
  const formatK = span(t, B.format, B.formatOut, 18, 14)
  const formatRecK = sheetK(t, B.formatSheet, B.formatOut)
  const fs = formatSlots(look)
  let focus = fs[0].box
  let focusN = 0
  for (let i = 1; i < fs.length; i++) {
    const k = progress(t, B.slots[i], B.slots[i] + 12, EASE_IN_OUT)
    if (k <= 0) break
    focusN = k > 0.5 ? i : i - 1
    focus = {
      x: lerp(focus.x, fs[i].box.x, k),
      y: lerp(focus.y, fs[i].box.y, k),
      w: lerp(focus.w, fs[i].box.w, k),
      h: lerp(focus.h, fs[i].box.h, k),
    }
  }
  const focusK = span(t, B.slots[0] - 8, B.formatOut - 6, 10, 10)
  const tagIn = (i: number) => progress(t, B.slots[i] + (i ? 12 : 0), B.slots[i] + (i ? 22 : 10))
  const lineHead = progress(t, B.slots[5] + 10, B.slots[5] + 34, EASE_IN_OUT)
  const lineSum = progress(t, B.slots[6] + 10, B.slots[6] + 34, EASE_IN_OUT)
  const linesOut = 1 - progress(t, B.formatOut - 6, B.formatOut + 4)

  /* 5 · row */
  const rowK = progress(t, B.row, B.row + 30)
  const boxes = rowBoxes(look)
  const rowEnd = boxes[boxes.length - 1].x + boxes[boxes.length - 1].w
  const deal = (i: number) => progress(t, B.deal + i * 12, B.deal + 16 + i * 12, EASE_DRAWER)
  /* the lines draw along with the dolly, a step ahead of the camera */
  const rowLine = progress(t, B.lines - 6, B.lines + 118, EASE_IN_OUT)
  const endK = progress(t, B.end, B.end + 20)

  /* veils: the page dims under any open sheet; half in the format chapter */
  const veil = Math.max(recordK * (1 - e), notesK, searchK, aiK, formatRecK * 0.5)
  const L = Math.max(e, rowK)
  const bg = `rgb(${Math.round(lerp(234, 246, L))} ${Math.round(lerp(229, 244, L))} ${Math.round(lerp(220, 240, L))})`
  const stoneK = 1 - rowK

  /* the pointer, in window space, drawn on the plane */
  const row5 = { x: f.page.x + 150, y: f.page.y + ROW0 + 5 * ROW_H + ROW_H / 2 }
  const ptr = pointerAt(
    t,
    [
      { at: 0, x: 1180, y: 880 },
      { at: 198, x: row5.x, y: row5.y, len: 20 },
      { at: 242, x: rec1.x + rec1.w + RECORD_EDIT.dx, y: rec1.y + rec1.h + RECORD_EDIT.dy, len: 20 },
      { at: 284, x: rec1.x + rec1.w + RECORD_ADD.dx, y: rec1.y + RECORD_ADD.dy, len: 16 },
      { at: 600, x: 300, y: BELL.y + 70, len: 1 },
      { at: B.badge + 6, x: BELL.x, y: BELL.y, len: 18 },
      { at: B.bellClick + 26, x: tool.x + 180, y: tool.y + noteY(1), len: 20 },
      { at: 900, x: tool.x + 420, y: tool.y + 640, len: 1 },
      { at: 914, x: tool.x + SEARCH_HIT.dx, y: tool.y + SEARCH_HIT.y, len: 20 },
      { at: 1000, x: 400, y: 260, len: 1 },
      { at: 1018, x: AI_ROW.x, y: AI_ROW.y, len: 20 },
      { at: 1100, x: tool.x + tool.w + AI_SEND.dx, y: tool.y + tool.h + AI_SEND.dy, len: 20 },
    ],
    [B.openRow, B.edit, B.add, B.bellClick, B.noteClick, B.hitClick, B.aiClick, B.send]
  )
  const ptrK =
    span(t, 196, 332) + span(t, B.badge + 2, B.noteClick + 14) + span(t, 906, B.hitClick + 12) + span(t, 1012, 1066) + span(t, 1094, B.send + 10)
  const hoverRow = t >= B.openRow - 6 && t < B.openRow + 10 ? 5 : -1
  const hoverNote = t >= B.noteClick - 8 && t < B.noteClick + 10 ? 1 : -1
  const hoverHit = t >= B.hitClick - 8 && t < B.hitClick + 10 ? "PO-0002-OPE6" : ""

  /* the Escape key, bottom centre, whenever the stack walks back */
  const escPresses = [...B.esc, ...B.noteEsc, ...B.searchEsc, ...B.aiEsc]
  const escK = span(t, B.esc[0] - 12, B.esc[2] + 14) + span(t, B.noteEsc[0] - 12, B.noteEsc[1] + 14) + span(t, B.searchEsc[0] - 12, B.searchEsc[1] + 14) + span(t, B.aiEsc[0] - 12, B.aiEsc[0] + 14)
  const escDown = Math.max(...escPresses.map((p) => span(t, p - 1, p + 3, 2, 4)))

  const cues: Cue[] = [
    ...clicks([B.openRow, B.edit, B.add, B.bellClick, B.noteClick, B.hitClick, B.aiClick, B.send]),
    ...[B.openRow, B.add, B.bellClick, B.noteClick, B.searchIn, B.hitClick, B.aiClick, B.formatSheet].map((at) => ({ at, src: SFX.whoosh, volume: 0.16 })),
    { at: B.explode, src: SFX.whoosh, volume: 0.28 },
    { at: B.collapseStack, src: SFX.whoosh, volume: 0.22 },
    { at: B.deal, src: SFX.whoosh, volume: 0.22 },
    { at: B.badge, src: SFX.ding, volume: 0.3 },
    { at: B.answer + 40, src: SFX.ding, volume: 0.2 },
    ...[...escPresses, B.cmdPress].map((at) => ({ at, src: SFX.tick, volume: 0.3 })),
    ...B.slots.map((at) => ({ at, src: SFX.tick, volume: 0.16 })),
  ]

  const planeStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    transformOrigin: "0 0",
    transformStyle: "preserve-3d",
    transform: `translate(960px, 540px) scale3d(${cam.s / ZOOM}, ${cam.s / ZOOM}, ${cam.s / ZOOM}) rotateX(${cam.rx}deg) rotateZ(${cam.rz}deg) translate(${-cam.cx * ZOOM}px, ${-cam.cy * ZOOM}px)`,
    opacity: 1 - endK,
  }

  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden" }}>
      <style>{css}</style>
      <Sfx cues={cues} />
      <div style={{ position: "absolute", inset: 0, perspective: 2400, perspectiveOrigin: "960px 540px" }}>
        <div style={planeStyle}>
          <div className="ly" style={{ position: "absolute", left: 0, top: 0, width: WIN.w, height: WIN.h, zoom: ZOOM, transformStyle: "preserve-3d" }}>
            {/* the stone */}
            <Layer
              box={{ x: 0, y: 0, w: WIN.w, h: WIN.h, r: 28 * e }}
              bg="#eae5dc"
              opacity={stoneK}
              shadow={e > 0 ? `0 0 0 1px rgb(80 60 30 / ${6 * e}%), 0 40px 120px rgb(80 60 30 / ${14 * e}%)` : undefined}
            />
            {/* outer sidebar */}
            <div style={{ position: "absolute", left: 0, top: 0, width: 200, height: WIN.h, opacity: stoneK, transform: `translateZ(${Z.rail * e}px)` }}>
              <Rail expand={expand} pill={pill} arrive={arrive} badge={badge} />
            </div>
            {/* inner sidebar: the tray (C) or the panel card (A) */}
            <Layer
              box={f.tray ?? f.panel}
              z={Z.tray * e}
              slide={(1 - trayK) * -24}
              bg={f.tray ? "#f3efe8" : "#f8f6f2"}
              shadow={WARM}
              opacity={trayK * stoneK}
            >
              <div style={{ position: "absolute", left: f.tray ? 8 : 0, top: f.tray ? 8 : 0, width: f.panel.w, height: f.panel.h }}>
                <Panel k={panelK} />
              </div>
            </Layer>
            {/* the format chapter quiets everything left of the page */}
            {formatK > 0 && (
              <div style={{ position: "absolute", left: 0, top: 0, width: f.page.x - 4, height: WIN.h, background: "#eae5dc", opacity: formatK * 0.95 }} />
            )}
            {/* the page */}
            <Layer
              box={f.page}
              z={Z.page * e}
              slide={(1 - pageK) * 24}
              shadow={look === "c" ? "0 0 0 1px rgb(0 0 0 / 5%), 0 2px 10px rgb(0 0 0 / 6%)" : RING}
              opacity={pageK}
            >
              <PoPage slots={slots} hover={hoverRow} />
            </Layer>
            {veil > 0 && (
              <div style={{ position: "absolute", inset: 0, background: DIM, opacity: veil * stoneK, transform: `translateZ(${Z.veil * e}px)` }} />
            )}

            {/* 2 · the record, its form, the nested sheet */}
            <Sheet box={rec1} k={recordK} dim={recordDim} z={Z.record * e}>
              <RecordSheet view={Math.min(1, view)} edit={edit} pressEdit={press(t, B.edit)} pressAdd={press(t, B.add)} />
            </Sheet>
            <Sheet box={nest1} k={nestedK} z={Z.nested * e}>
              <NestedSheet />
            </Sheet>

            {/* 3 · notifications, search, AI — each a sheet like any other */}
            <Sheet box={tool} k={notesK} dim={notesDim}>
              <NotificationsSheet hover={hoverNote} unread={1 - progress(t, B.noteClick, B.noteClick + 8)} />
            </Sheet>
            <Sheet box={over} k={notesRecK}>
              <RecordSheet />
            </Sheet>
            <Sheet box={tool} k={searchK} dim={searchDim}>
              <SearchSheet query={query} caret={typing(B.type, B.type + 22) || blink} results={results} hover={hoverHit} />
            </Sheet>
            <Sheet box={over} k={searchRecK}>
              <RecordSheet />
            </Sheet>
            <Sheet box={tool} k={aiK}>
              <AiSheet
                draft={draft}
                caret={t < B.send && (typing(B.aiType, B.aiType + 56) || blink)}
                sent={sent}
                answer={answer}
                rows={aiRows}
                pressSend={press(t, B.send)}
              />
            </Sheet>

            {/* 4 · the format */}
            <Sheet box={sheetAt(look, 960, 1)} k={formatRecK}>
              <RecordSheet />
            </Sheet>
            {focusK > 0 && (
              <>
                {lineHead > 0 && (
                  <div style={{ position: "absolute", left: f.page.x - 20, top: f.page.y + 115, width: (rec1.x + rec1.w + 20 - (f.page.x - 20)) * lineHead, height: 2, background: BLUE, opacity: linesOut }} />
                )}
                {lineSum > 0 && (
                  <div style={{ position: "absolute", left: f.page.x - 20, top: f.page.y + 139 + 45 + 4, width: (rec1.x + rec1.w + 20 - (f.page.x - 20)) * lineSum, height: 2, background: BLUE, opacity: linesOut * 0.7 }} />
                )}
                <div
                  style={{
                    position: "absolute",
                    left: focus.x,
                    top: focus.y,
                    width: focus.w,
                    height: focus.h,
                    borderRadius: 10,
                    border: `2px solid ${BLUE}`,
                    background: "rgb(40 98 220 / 6%)",
                    opacity: focusK,
                  }}
                />
                {fs.map((s, i) =>
                  i === focusN ? (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: s.tag.x,
                        top: s.tag.y - 15,
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        opacity: tagIn(i) * focusK,
                        translate: `0px ${(1 - tagIn(i)) * 4}px`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ background: BLUE, color: "#fff", fontSize: 15, fontWeight: 600, padding: "3px 10px", borderRadius: 7 }}>{s.name}</span>
                      <span style={{ color: BLUE, fontSize: 15, fontWeight: 500, background: "rgb(255 255 255 / 85%)", padding: "3px 6px", borderRadius: 6 }}>{s.spec}</span>
                    </div>
                  ) : null
                )}
              </>
            )}

            {/* 5 · every surface side by side */}
            {rowK > 0 &&
              ROW_CARDS.map((c, i) => {
                const k = deal(i)
                if (k <= 0) return null
                const box = boxes[i]
                return (
                  <Layer key={c.kind} box={box} slide={(1 - k) * 600} shadow={RING} opacity={k}>
                    {c.kind === "record" && <RecordSheet />}
                    {c.kind === "form" && <RecordSheet view={0} edit={1} />}
                    {c.kind === "nested" && <NestedSheet />}
                    {c.kind === "notes" && <NotificationsSheet />}
                    {c.kind === "search" && <SearchSheet query={SEARCH_QUERY} caret={false} />}
                    {c.kind === "ai" && <AiSheet draft="" caret={false} sent={1} answer={AI_ANSWER} rows={() => 1} />}
                  </Layer>
                )
              })}
            {rowK > 0 && (
              <>
                <Tag x={f.page.x} y={f.page.y - 86} size={56} k={progress(t, B.row + 20, B.row + 34)}>Page</Tag>
                {ROW_CARDS.map((c, i) => (
                  <Tag key={c.kind} x={boxes[i].x} y={boxes[i].y - 86} size={56} k={deal(i)}>{c.label}</Tag>
                ))}
                {[
                  { y: f.page.y + 115, name: "Header" },
                  { y: f.page.y + f.page.h - 67, name: "Foot" },
                ].map((l) => (
                  <div key={l.name}>
                    <div style={{ position: "absolute", left: f.page.x - 40, top: l.y - 2, width: (rowEnd + 40 - (f.page.x - 40)) * rowLine, height: 6, background: BLUE, borderRadius: 3 }} />
                    <Tag x={f.page.x - 64} y={l.y - 40} k={progress(t, B.lines, B.lines + 14)} size={60} color={BLUE} align="right">{l.name}</Tag>
                  </div>
                ))}
              </>
            )}

            {/* 2 · the layers named, while they float apart */}
            <Tag x={12} y={-66} z={Z.rail * e} k={labelK(0)}>Outer sidebar</Tag>
            <Tag x={(f.tray ?? f.panel).x + 8} y={(f.tray ?? f.panel).y - 66} z={Z.tray * e} k={labelK(4)}>Inner sidebar</Tag>
            <Tag x={f.page.x + 28} y={f.page.y - 66} z={Z.page * e} k={labelK(8)}>Page</Tag>
            <Tag x={rec1.x + 28} y={rec1.y - 66} z={Z.record * e} k={labelK(12)}>Detail ⇄ Form</Tag>
            <Tag x={nest1.x + 28} y={nest1.y - 66} z={Z.nested * e} k={labelK(16)}>Nested</Tag>

            {ptrK > 0 && (
              <div style={{ position: "absolute", left: 0, top: 0, opacity: Math.min(1, ptrK), transform: `translateZ(${Z.nested * e + 20}px)` }}>
                <Pointer x={ptr.x} y={ptr.y} down={ptr.down} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4 · the legend, over the quieted rail */}
      {formatK > 0 && (
        <div style={{ position: "absolute", left: 56, top: 300, opacity: formatK, fontFamily: '"Inter Variable", Inter, sans-serif' }}>
          <div style={{ fontSize: 30, fontWeight: 650, letterSpacing: "-.02em", color: "#1d1d1f", marginBottom: 22 }}>One format</div>
          {LEGEND.map((name, i) => {
            const on = fs[focusN]?.name === name && focusK > 0.5
            const inSheet = focusN >= 5
            const note = name === "Tabs" ? "Pages only" : name === "Foot" ? "Sheets only" : ""
            const off = (name === "Tabs" && inSheet) || (name === "Foot" && !inSheet)
            return (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 12, height: 40, fontSize: 19, fontWeight: on ? 600 : 500, color: on ? "#1d1d1f" : off ? "#b4aea5" : "#77736e" }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: on ? BLUE : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px #c9c3b9" }} />
                {i + 1}&nbsp;&nbsp;{name}
                {note && <span style={{ fontSize: 15, fontWeight: 400, color: "#a29b90" }}>{note}</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* ⌘K, isolated */}
      {cmd > 0 && (
        <AbsoluteFill style={{ background: "#f6f4f0", opacity: cmd, display: "grid", placeItems: "center" }}>
          <div style={{ display: "flex", gap: 28, ...enter(t, B.cmdK, 12) }}>
            <Keycap label="⌘" size={170} down={span(t, B.cmdPress - 2, B.cmdPress + 10, 3, 5)} />
            <Keycap label="K" size={170} down={span(t, B.cmdPress + 1, B.cmdPress + 10, 3, 5)} />
          </div>
        </AbsoluteFill>
      )}

      {/* Escape walks back */}
      {escK > 0 && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 56, display: "grid", placeItems: "center", opacity: Math.min(1, escK), translate: `0px ${(1 - Math.min(1, escK)) * 8}px` }}>
          <Keycap label="esc" size={84} down={escDown} />
        </div>
      )}

      {/* the mark */}
      {endK > 0 && (
        <AbsoluteFill style={{ display: "grid", placeItems: "center", fontFamily: '"Inter Variable", Inter, sans-serif' }}>
          <div style={{ display: "flex", alignItems: "center", gap: 26, ...enter(t, B.end + 12, 16) }}>
            <span style={{ width: 104, height: 104, borderRadius: 28, background: "#1d1d1f", color: "#fff", display: "grid", placeItems: "center", fontSize: 56, fontWeight: 700 }}>C</span>
            <span style={{ fontSize: 68, fontWeight: 650, letterSpacing: "-.03em", color: "#1d1d1f" }}>Central</span>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}
