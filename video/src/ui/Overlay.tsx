/* What stays put while the camera moves: the caption under the stage, and the
   band at the foot — which chapter this is, who is working, and where the
   order is on its way (the rail, with the blue dot on the current step). */
import type { CSSProperties, ReactNode } from "react"
import { enter, leave, lerp } from "../motion"
import { cn } from "./kit"

/* ── Caption ────────────────────────────────────────────────────────── */

export interface Line {
  from: number
  to: number
  text: string
}

/** `**word**` is set in the UI's own bold, for button and status names. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") ? (
          <span key={i} className="font-semibold text-ink">
            {part.slice(2, -2)}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

export function Caption({ t, lines }: { t: number; lines: readonly Line[] }) {
  const line = lines.find((one) => t >= one.from && t < one.to)
  if (!line) return null
  const a = enter(t, line.from, 10)
  const b = leave(t, line.to - 6, 6)
  return (
    /* Anchored at its foot, so a sentence that needs two lines grows up
       toward the stage rather than down into the band. */
    <div
      className="absolute left-20 text-[1.875rem] leading-[2.5rem] font-medium tracking-[-0.012em] text-text"
      style={{
        bottom: 1080 - 922,
        maxWidth: 1640,
        opacity: a.opacity * b.opacity,
        translate: a.opacity < 1 ? a.translate : b.translate,
      }}
    >
      <Rich text={line.text} />
    </div>
  )
}

/* ── The band ───────────────────────────────────────────────────────── */

export const STEPS = [
  "New PO",
  "Submit",
  "Receiving",
  "Review Count",
  "Return PO",
  "Done",
] as const

const SLOT = 168
const railX = (n: number) => 1840 - SLOT * (n - 1)
const RAIL_X = railX(STEPS.length)
const RAIL_Y = 978

export interface Who {
  initials: string
  role: string
  name: string
}

export const BUYER: Who = { initials: "RK", role: "Buyer", name: "Rina Kusuma" }
export const GUDANG: Who = { initials: "YR", role: "Gudang", name: "Yusuf Ramadhan" }
export const MD: Who = { initials: "RK", role: "MD", name: "Rina Kusuma" }

export function Band({
  chapter,
  title,
  who,
  at,
  done = Math.floor(at),
  hideDot,
  steps = STEPS,
  of = 5,
  style,
}: {
  chapter: number
  title: string
  who?: Who
  /** Where the dot is on the rail: 0 = New PO … 5 = Done, fractional while it
      travels. */
  at: number
  /** Steps walked so far (drawn in ink). */
  done?: number
  /** While the dot is somewhere else in the picture (flying in). */
  hideDot?: boolean
  /** The rail's steps; the PO film's by default. */
  steps?: readonly string[]
  /** How many chapters the film has. */
  of?: number
  style?: CSSProperties
}) {
  const x0 = railX(steps.length)
  const dotX = x0 + at * SLOT
  return (
    <div className="absolute inset-x-0 top-[936px] h-[144px]" style={style}>
      <div className="absolute top-0 right-20 left-20 h-px bg-hairline-2" />

      <div className="absolute top-7 left-20 flex items-baseline gap-3">
        <span className="font-mono text-[1.25rem] text-mute">{chapter}/{of}</span>
        <span className="text-[1.375rem] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </span>
      </div>
      {who && (
        <div className="absolute top-[74px] left-20 flex items-center gap-2.5 text-[1.125rem] text-body">
          <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-avatar-from to-avatar-to text-[0.8125rem] font-semibold text-ink">
            {who.initials}
          </span>
          <span>
            <span className="font-medium text-ink">{who.role}</span> · {who.name}
          </span>
        </div>
      )}

      {/* rail */}
      <div
        className="absolute h-[3px] rounded-full bg-hairline-2"
        style={{ left: x0, width: SLOT * (steps.length - 1), top: RAIL_Y - 936 - 1.5 }}
      />
      <div
        className="absolute h-[3px] rounded-full bg-ink"
        style={{ left: x0, width: Math.max(0, at) * SLOT, top: RAIL_Y - 936 - 1.5 }}
      />
      {steps.map((step, i) => {
        const x = x0 + i * SLOT
        const passed = i <= done
        const here = Math.abs(at - i) < 0.5
        return (
          <div key={step}>
            <span
              className={cn(
                "absolute size-3.5 rounded-full border-[3px] bg-canvas",
                passed ? "border-ink" : "border-hairline-strong"
              )}
              style={{ left: x - 7, top: RAIL_Y - 936 - 7 }}
            />
            <span
              className={cn(
                "absolute -translate-x-1/2 text-[1.125rem] whitespace-nowrap",
                here ? "font-semibold text-ink" : passed ? "text-text" : "text-mute"
              )}
              style={{ left: x, top: RAIL_Y - 936 + 18 }}
            >
              {step}
            </span>
          </div>
        )
      })}
      {!hideDot && (
        <span
          className="absolute size-[18px] rounded-full bg-accent shadow-[0_0_0_5px_rgb(37_99_235/14%)]"
          style={{ left: dotX - 9, top: RAIL_Y - 936 - 9 }}
        />
      )}
    </div>
  )
}

/** The dot's rail position while it travels from step a to step b. */
export const along = (k: number, a: number, b: number) => lerp(a, b, k)

/** A step's dot on the rail, in picture pixels. */
export const railPoint = (i: number) => ({ x: RAIL_X + i * SLOT, y: RAIL_Y })

/** A receipt in the picture's own corner, above the band: the hub's toast,
    but where the camera cannot frame it away. */
export function FrameToast({ k, children }: { k: number; children: ReactNode }) {
  if (k <= 0) return null
  return (
    <div
      className="absolute flex items-center gap-3 rounded-card border border-hairline bg-canvas px-5 py-3.5 text-[1.375rem] text-ink shadow-pop"
      style={{ right: 104, top: 752, opacity: k, translate: `0px ${(1 - k) * 10}px`, maxWidth: 1100 }}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ok text-white">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={3}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      {children}
    </div>
  )
}
