/* "How far back" (reversibility-prototype.html), redrawn for the film: the
   document's figures, the stage rail with its red Point of no return, the
   current stage's actions — each with its owner, whether it is in the app,
   and Locked with Why not / Instead — and the Activity list.

   Laid out at fixed pixel rows (not flowed) so a chapter knows where every
   button sits in the 1440 × 900 window: the pointer and the camera aim at
   the numbers exported below. */
import type { ReactNode } from "react"
import { Check, Lock } from "lucide-react"
import { EASE_IN_OUT, lerp, progress } from "../motion"
import { WINDOW } from "./AppWindow"
import { cn } from "./kit"

/* ── Geometry (window pixels) ───────────────────────────────────────── */

export const HF = {
  x: 110,
  w: 1220,
  docTop: 72,
  docH: 118,
  railTop: 232,
  railH: 78,
  colsTop: 326,
  leftW: 724,
  gap: 14,
  head: 78,
  stays: 44,
  row: 60,
  lockedRow: 112,
  next: 64,
} as const

const RIGHT_X = HF.x + HF.leftW + HF.gap
const RIGHT_W = HF.w - HF.leftW - HF.gap

/** Where the rows of a stage card start, and where row i's centre is. */
export function rowY(stage: StageView, i: number) {
  let y = HF.colsTop + HF.head + (stage.staysH ?? HF.stays)
  for (let j = 0; j < i; j++) y += actH(stage.acts[j])
  return y + HF.row / 2
}
/** A row's "Do it" button. */
export const doIt = (stage: StageView, i: number) => ({ x: HF.x + HF.leftW - 22 - 34, y: rowY(stage, i) })
/** The nextbar's first button. */
export function nextBtn(stage: StageView) {
  let y = HF.colsTop + HF.head + (stage.staysH ?? HF.stays)
  for (const a of stage.acts) y += actH(a)
  const xs = nextXs(stage.next)
  return { x: xs[0] ?? HF.x + HF.leftW - 22 - 70, y: y + HF.next / 2, top: y, xs }
}
/** The nextbar buttons' centres, right-aligned, from their labels' length. */
function nextXs(labels: readonly string[]) {
  let right = HF.x + HF.leftW - 22
  const out: number[] = []
  for (let i = labels.length - 1; i >= 0; i--) {
    const w = 28 + labels[i].length * 8.2
    out[i] = right - w / 2
    right -= w + 10
  }
  return out
}
const actH = (a: ActView) => a.h ?? (a.on === false ? HF.lockedRow : HF.row)
/** Rail column i's centre. */
export const railCol = (n: number, i: number) => ({
  x: HF.x + (HF.w / n) * (i + 0.5),
  y: HF.railTop + HF.railH / 2,
})

/* ── Data ───────────────────────────────────────────────────────────── */

export type App = "in" | "built" | "new" | "design"
const APP: Record<App, [string, string]> = {
  in: ["bg-ok", "In the app"],
  built: ["bg-accent", "Built, not tested"],
  new: ["bg-warn", "Not in the app"],
  design: ["bg-hairline-strong", "To design"],
}
type Back = "yes" | "part" | "no"
const BACK: Record<Back, [string, string]> = {
  yes: ["bg-ok", "Back: yes"],
  part: ["bg-warn", "Back: part only"],
  no: ["bg-bad", "Back: no"],
}

export interface ActView {
  verb: string
  label: string
  owner: string
  app?: App
  note?: string
  /** false = Locked, with why / instead. */
  on?: boolean
  why?: string
  instead?: string
  /** A taller row, for a Why not that runs to three lines. */
  h?: number
}

export interface StageView {
  label: string
  back: Back
  stays: string
  /** A taller "What stays" row for a sentence that needs two lines. */
  staysH?: number
  acts: readonly ActView[]
  /** The nextbar's buttons; none = "Nothing further in this flow". */
  next: readonly string[]
}

export interface LogEntry {
  at: number
  time: string
  text: string
  who: string
  verb: string
  /** A phrase inside text to mark. */
  em?: string
}

/* ── The window ─────────────────────────────────────────────────────── */

export function HowFarWindow({
  title = "How far back",
  flow = 0,
  children,
  overlay,
}: {
  title?: string
  /** Which flow is on in the segment: PO → DC, DC → store, Store return,
      DC → supplier; null for the pages without one. */
  flow?: number | null
  children: ReactNode
  overlay?: ReactNode
}) {
  const FLOWS = ["PO → DC", "DC → store", "Store return", "DC → supplier"]
  return (
    <div
      className="relative overflow-hidden rounded-shell border border-hairline-2 bg-soft-3 text-ink"
      style={{
        width: WINDOW.w,
        height: WINDOW.h,
        boxShadow: "0 18px 50px rgb(24 39 60 / 10%), 0 60px 140px rgb(24 39 60 / 14%)",
      }}
    >
      <div className="absolute flex items-center justify-between" style={{ left: HF.x, top: 18, width: HF.w, height: 40 }}>
        <span className="text-[1.375rem] leading-[30px] font-semibold tracking-[-0.02em] text-ink">{title}</span>
        {flow !== null && (
        <span className="flex overflow-hidden rounded-inner border border-hairline bg-canvas">
          {FLOWS.map((f, i) => (
            <span
              key={f}
              className={cn(
                "flex h-9 items-center border-l border-hairline px-3.5 text-[0.9375rem] font-medium first:border-l-0",
                i === flow ? "bg-ink text-white" : "text-text"
              )}
            >
              {f}
            </span>
          ))}
        </span>
        )}
      </div>
      {children}
      {overlay}
    </div>
  )
}

/* ── The document ───────────────────────────────────────────────────── */

export function DocCard({
  doc,
  party,
  status,
  back,
  figs,
  hot,
}: {
  doc: string
  party: string
  status: string
  back: Back
  figs: readonly (readonly [string, number])[]
  /** A figure to mark: its index, 0..1. */
  hot?: [number, number]
}) {
  return (
    <div
      className="absolute rounded-card border border-hairline bg-canvas px-[22px] py-[18px] shadow-soft"
      style={{ left: HF.x, top: HF.docTop, width: HF.w, height: HF.docH }}
    >
      <div className="flex items-baseline gap-3.5">
        <span className="font-mono text-[1.125rem] font-semibold text-ink">{doc}</span>
        <span className="text-[0.9375rem] text-mute">{party}</span>
        <span className="ml-auto flex items-center gap-2 text-[0.9375rem] font-medium text-ink">
          <span className={cn("size-[7px] rounded-full", BACK[back][0])} />
          {status}
        </span>
      </div>
      <div className="mt-3.5 grid grid-cols-6 gap-3">
        {figs.map(([label, value], i) => {
          const k = hot && hot[0] === i ? hot[1] : 0
          return (
            <div key={label} className="relative">
              <span
                className="absolute -inset-x-2 -inset-y-1 rounded-inner bg-accent-bg"
                style={{ opacity: k }}
              />
              <b className="relative block text-[1.5rem] leading-[1.2] font-semibold tracking-[-0.02em] text-ink tabular-nums">
                {value.toLocaleString("en-US")}
              </b>
              <span className="relative text-[0.9375rem] text-mute">{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── The rail ───────────────────────────────────────────────────────── */

export function StageRail({
  stages,
  at,
  bnd,
  pulse = 0,
}: {
  stages: readonly string[]
  /** The current stage; fractional while the highlight travels. */
  at: number
  /** The first stage past the Point of no return. */
  bnd: number
  /** 0..1, the red line drawing attention to itself. */
  pulse?: number
}) {
  const colW = HF.w / stages.length
  const here = Math.round(at)
  const dense = stages.length > 7
  return (
    <>
      <span
        className="absolute text-[0.9375rem] font-medium whitespace-nowrap text-bad-fg"
        style={{ left: HF.x + bnd * colW + 12, top: HF.railTop - 26, scale: String(1 + 0.06 * pulse), transformOrigin: "0 100%" }}
      >
        Point of no return
      </span>
      <div
        className="absolute overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft"
        style={{ left: HF.x, top: HF.railTop, width: HF.w, height: HF.railH }}
      >
        <span
          className="absolute top-0 h-full bg-accent-bg shadow-[inset_0_3px_0_var(--color-accent)]"
          style={{ left: at * colW, width: colW }}
        />
        {stages.map((s, i) => (
          <div
            key={s}
            className={cn(
              "absolute top-0 flex h-full flex-col px-3",
              dense ? "gap-1 py-2" : "gap-1.5 py-3",
              i > 0 && "border-l border-hairline"
            )}
            style={{ left: i * colW, width: colW }}
          >
            <span
              className={cn(
                "grid size-[22px] place-items-center rounded-full text-[0.875rem] font-semibold",
                i < here ? "bg-ink text-white" : i === here ? "bg-accent text-white" : "bg-soft-2 text-mute"
              )}
            >
              {i < here ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span
              className={cn(
                dense ? "text-[0.875rem] leading-[1.2] font-medium" : "text-[0.9375rem] leading-[1.25] font-medium",
                i < here ? "text-mute" : i === here ? "text-ink" : "text-text"
              )}
            >
              {s}
            </span>
          </div>
        ))}
        <span
          className="absolute top-0 h-full bg-bad"
          style={{ left: bnd * colW - 1, width: 3 }}
        />
      </div>
      {pulse > 0 && (
        <span
          className="absolute rounded-full bg-bad"
          style={{
            left: HF.x + bnd * colW - 1 - 6 * pulse,
            top: HF.railTop - 6 * pulse,
            width: 3 + 12 * pulse,
            height: HF.railH + 12 * pulse,
            opacity: 0.18 * pulse,
          }}
        />
      )}
    </>
  )
}

/* ── The stage card ─────────────────────────────────────────────────── */

export interface RowLook {
  /** 0..1, the row is the one being talked about. */
  glow?: number
  /** 0..1, a ring round its "in the app" tag. */
  tag?: number
  hot?: boolean
  pressed?: number
}

export function StageCard({
  stage,
  k = 1,
  looks = {},
  nextLook,
  staysGlow = 0,
}: {
  stage: StageView
  /** 0..1, the "What stays" sentence being talked about. */
  staysGlow?: number
  /** 0..1, the card's content arriving (rows a frame or two apart). */
  k?: number
  looks?: Record<number, RowLook>
  nextLook?: { hot?: boolean; pressed?: number; glow?: number }
}) {
  const bk = BACK[stage.back]
  const top = nextBtn(stage).top
  const height = top - HF.colsTop + HF.next
  const step = (i: number) => {
    const kk = Math.min(1, Math.max(0, k * 1.6 - i * 0.12))
    return { opacity: kk, translate: `0px ${lerp(6, 0, kk)}px` }
  }
  return (
    <div
      className="absolute overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft"
      style={{ left: HF.x, top: HF.colsTop, width: HF.leftW, height }}
    >
      <div className="border-b border-hairline px-[22px] pt-[16px]" style={{ height: HF.head, ...step(0) }}>
        <span className="flex items-center gap-2 text-[0.9375rem] text-mute">
          <span className={cn("size-[7px] rounded-full", bk[0])} />
          {bk[1]}
        </span>
        <div className="mt-0.5 text-[1.125rem] font-semibold text-ink">{stage.label}</div>
      </div>
      <div
        className="flex items-center border-b border-hairline bg-soft px-[22px] text-[0.9375rem] leading-[22px] text-text"
        style={{ height: stage.staysH ?? HF.stays, ...step(0.5) }}
      >
        <span className="absolute inset-x-0 bg-accent-bg" style={{ height: stage.staysH ?? HF.stays, opacity: staysGlow * 0.9 }} />
        <span className={cn("relative", !stage.staysH && "truncate")}>
          <b className="font-medium text-ink">What stays.</b> {stage.stays}
        </span>
      </div>
      {stage.acts.map((a, i) => {
        const look = looks[i] ?? {}
        const locked = a.on === false
        const app = APP[a.app ?? "in"]
        return (
          <div
            key={a.verb + a.label}
            className="relative border-b border-hairline px-[22px]"
            style={{ height: actH(a), ...step(1 + i) }}
          >
            <span className="absolute inset-0 bg-accent-bg" style={{ opacity: (look.glow ?? 0) * 0.9 }} />
            <div className="relative flex items-center gap-3.5" style={{ height: HF.row }}>
              <span className={cn("w-24 shrink-0 text-[0.9375rem] font-medium", locked ? "text-mute" : "text-ink")}>
                {a.verb}
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn("text-[0.9375rem] font-medium", locked ? "text-mute" : "text-ink")}>{a.label}</div>
                <div className="flex items-center gap-2.5 text-[0.875rem] text-mute">
                  <span>{a.owner}</span>
                  {!locked && (
                    <span className="relative flex items-center gap-1.5">
                      <span
                        className="absolute -inset-x-2 -inset-y-0.5 rounded-full border-2 border-warn"
                        style={{ opacity: look.tag ?? 0, scale: String(lerp(1.15, 1, look.tag ?? 0)) }}
                      />
                      <span className={cn("size-[7px] rounded-full", app[0])} />
                      <span className={look.tag ? "text-ink" : undefined}>{app[1]}</span>
                    </span>
                  )}
                  {a.note && <span>{a.note}</span>}
                </div>
              </div>
              <span
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-inner border border-hairline px-3 text-[0.9375rem] font-medium",
                  locked ? "text-mute opacity-60" : look.hot ? "bg-soft text-ink" : "bg-canvas text-ink"
                )}
                style={{ scale: String(look.pressed ?? 1) }}
              >
                {locked && <Lock className="size-3.5" />}
                {locked ? "Locked" : "Do it"}
              </span>
            </div>
            {locked && (
              <div
                className="relative ml-[110px] rounded-inner bg-soft px-3 py-2 text-[0.9375rem] text-text"
                style={{ marginTop: -6 }}
              >
                <b className="font-medium text-ink">Why not.</b> {a.why} <b className="font-medium text-ink">Instead.</b> {a.instead}
              </div>
            )}
          </div>
        )
      })}
      <div
        className="relative flex items-center justify-end gap-2.5 px-[22px]"
        style={{ height: HF.next, ...step(1 + stage.acts.length) }}
      >
        <span className="absolute inset-0 bg-accent-bg" style={{ opacity: (nextLook?.glow ?? 0) * 0.9 }} />
        <span className="relative mr-auto text-[0.9375rem] text-mute">
          {stage.next.length ? "Move the document forward" : "Nothing further in this flow"}
        </span>
        {stage.next.map((n) => (
          <span
            key={n}
            className={cn(
              "relative flex h-9 items-center rounded-inner px-3.5 text-[0.9375rem] font-medium text-white",
              nextLook?.hot ? "bg-[#1f57d6]" : "bg-accent"
            )}
            style={{ scale: String(nextLook?.pressed ?? 1) }}
          >
            {n}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ── Activity ───────────────────────────────────────────────────────── */

const lines = (text: string) => Math.max(1, Math.ceil(text.length / 46))
const entryH = (e: LogEntry) => 16 + lines(e.text) * 22 + 21

export function Activity({
  t,
  entries,
  mark = 0,
  height = 540,
}: {
  t: number
  entries: readonly LogEntry[]
  /** 0..1, the newest entry's marked phrase. */
  mark?: number
  height?: number
}) {
  const shown = entries.filter((e) => t >= e.at).slice().reverse()
  let y = 50
  return (
    <div
      className="absolute overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft"
      style={{ left: RIGHT_X, top: HF.colsTop, width: RIGHT_W, height }}
    >
      <div className="px-[22px] pt-[14px] text-[0.9375rem] font-semibold text-ink">Activity</div>
      {shown.length === 0 && <div className="px-[22px] pt-4 text-[0.9375rem] text-mute">Nothing yet.</div>}
      {shown.map((e, i) => {
        /* The newest opens its room first, then fades in inside it. */
        const k = i === 0 ? progress(t, e.at + 6, e.at + 16) : 1
        const h = entryH(e) * (i === 0 ? progress(t, e.at, e.at + 10, EASE_IN_OUT) : 1)
        const top = y
        y += h
        const parts = e.em && i === 0 ? e.text.split(e.em) : [e.text]
        return (
          <div
            key={`${e.at}-${e.time}`}
            className={cn("absolute inset-x-0 flex gap-2.5 overflow-hidden px-[22px] py-2", i === 0 && "bg-accent-bg")}
            style={{ top, height: h }}
          >
            <span className="w-12 shrink-0 text-[0.9375rem] text-mute tabular-nums" style={{ opacity: k }}>{e.time}</span>
            <span className="min-w-0 text-[0.9375rem] leading-[22px] text-ink" style={{ opacity: k, translate: `0px ${lerp(-4, 0, k)}px` }}>
              {parts.length === 2 ? (
                <>
                  {parts[0]}
                  <span className="rounded-[4px]" style={{ background: `rgb(250 234 205 / ${mark})`, boxShadow: `0 0 0 2px rgb(250 234 205 / ${mark})` }}>
                    {e.em}
                  </span>
                  {parts[1]}
                </>
              ) : (
                e.text
              )}
              <span className="block text-[0.875rem] text-mute">
                {e.who} · {e.verb}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Tables: Four verbs, Cannot go back ─────────────────────────────── */

export const TABLE = { top: 72, head: 46 } as const

/** Row i's top, given every row's height. */
export const tableRowTop = (heights: readonly number[], i: number) =>
  TABLE.top + TABLE.head + heights.slice(0, i).reduce((a, h) => a + h, 0)

export function RuleTable({
  head,
  rows,
  heights,
  widths,
  glow = {},
  k = 1,
}: {
  head: readonly string[]
  rows: readonly (readonly string[])[]
  /** Each row's height in pixels. */
  heights: readonly number[]
  /** The first columns' widths; the last takes the rest. */
  widths: readonly number[]
  /** Row → 0..1, the row being talked about. */
  glow?: Record<number, number>
  /** 0..1, rows arriving one after another. */
  k?: number
}) {
  const total = heights.reduce((a, h) => a + h, 0)
  return (
    <div
      className="absolute overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft"
      style={{ left: HF.x, top: TABLE.top, width: HF.w, height: TABLE.head + total }}
    >
      <div className="flex border-b border-hairline text-[0.9375rem] font-medium text-mute" style={{ height: TABLE.head }}>
        {head.map((h, i) => (
          <span
            key={h}
            className="flex items-center px-4"
            style={i < widths.length ? { width: widths[i] } : { flex: 1 }}
          >
            {h}
          </span>
        ))}
      </div>
      {rows.map((r, i) => {
        const kk = Math.min(1, Math.max(0, k * 1.5 - i * 0.07))
        const g = glow[i] ?? 0
        return (
          <div
            key={r[0]}
            className="relative flex border-b border-hairline last:border-b-0"
            style={{ height: heights[i], opacity: kk, translate: `0px ${lerp(6, 0, kk)}px` }}
          >
            <span className="absolute inset-0 bg-accent-bg" style={{ opacity: g * 0.9 }} />
            <span className="absolute top-0 left-0 h-full w-[3px] bg-accent" style={{ opacity: g }} />
            {r.map((cell, j) => (
              <span
                key={j}
                className={cn(
                  "relative px-4 py-3 text-[0.9375rem] leading-[22px]",
                  j === 0 ? "font-medium text-ink" : "text-text"
                )}
                style={j < widths.length ? { width: widths[j] } : { flex: 1 }}
              >
                {cell}
              </span>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/** The note under a table: "The rule." / "Partly processed." */
export function RuleNote({
  top,
  lead,
  text,
  k = 1,
  glow = 0,
}: {
  top: number
  lead: string
  text: string
  k?: number
  glow?: number
}) {
  return (
    <div
      className="absolute rounded-card border border-hairline bg-canvas px-[18px] py-[14px] text-[1rem] leading-[24px] text-text shadow-soft"
      style={{ left: HF.x, top, width: HF.w, opacity: k, translate: `0px ${lerp(8, 0, k)}px` }}
    >
      <span className="absolute inset-0 rounded-card bg-accent-bg" style={{ opacity: glow * 0.9 }} />
      <span className="relative">
        <b className="font-medium text-ink">{lead}</b> {text}
      </span>
    </div>
  )
}

/* ── Edge cases ─────────────────────────────────────────────────────── */

export function EdgeCard({
  x,
  y,
  w,
  h,
  title,
  tag,
  rule,
  buttons,
  out,
  k = 1,
}: {
  x: number
  y: number
  w: number
  h: number
  title: string
  tag: string
  rule: string
  buttons: readonly { label: string; hot?: boolean; pressed?: number }[]
  /** The outcome box: text and tone, and 0..1 as it arrives. */
  out: { text: string; good?: boolean; k: number }
  k?: number
}) {
  return (
    <div
      className="absolute flex flex-col gap-3 rounded-card border border-hairline bg-canvas px-5 py-[18px] shadow-soft"
      style={{ left: x, top: y, width: w, height: h, opacity: k, translate: `0px ${lerp(8, 0, k)}px` }}
    >
      <span className="text-[1.125rem] font-semibold text-ink">{title}</span>
      <span className="flex items-center gap-2 text-[0.9375rem] text-mute">
        <span className="size-[7px] rounded-full bg-accent" />
        {tag}
      </span>
      <span className="text-[1rem] leading-[24px] text-text">{rule}</span>
      <div className="mt-1 flex flex-col gap-3 border-t border-hairline pt-3.5">
        <div className="flex gap-2.5">
          {buttons.map((b) => (
            <span
              key={b.label}
              className={cn(
                "flex h-9 items-center rounded-inner border border-hairline px-3.5 text-[0.9375rem] font-medium text-ink",
                b.hot ? "bg-soft" : "bg-canvas"
              )}
              style={{ scale: String(b.pressed ?? 1) }}
            >
              {b.label}
            </span>
          ))}
        </div>
        <div
          className={cn(
            "rounded-inner px-3.5 py-3 text-[1rem] leading-[24px]",
            out.good ? "bg-ok-bg text-ok-fg" : "bg-soft text-ink"
          )}
          style={{ opacity: lerp(0.4, 1, out.k) }}
        >
          {out.text}
        </div>
      </div>
    </div>
  )
}
