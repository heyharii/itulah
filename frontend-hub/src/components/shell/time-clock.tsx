import { useEffect, useState } from "react"

import { ParticleField } from "@/components/shell/particle-field"
import type { Jump } from "@/components/shell/use-jump"
import { handAngles, momentParts } from "@/lib/time-travel"
import { cn } from "@/lib/utils"

/// The business clock's face and figures — the header's and the panel's.
///
/// Everything here follows one number, the business instant, and animates
/// only when that number JUMPS (`useJump`): between jumps the hands glide a
/// few degrees and the digits swap, which is all a clock should do. The
/// motion itself lives in `styles/index.css` (`time-*`); this file decides
/// when to play it.

interface Hand {
  /// The angle asked for last, 0–360.
  prev: number
  /// The angle drawn — it keeps counting past 360, so the hand never turns
  /// back on itself at 12.
  angle: number
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/// One hand's next angle. Ordinarily the short way round; on a jump, forward
/// (or backward) through `turns` whole extra turns, still ending on target.
function step(hand: Hand, target: number, dir: 0 | 1 | -1, turns: number) {
  let d = (((target - hand.prev) % 360) + 360) % 360
  if (dir === 0) {
    if (d > 180) d -= 360
  } else if (dir > 0) d += 360 * turns
  else d = (d === 0 ? 0 : d - 360) - 360 * turns
  return { prev: target, angle: hand.angle + d }
}

const WHIRL_MINUTE_TURNS = 3
const WHIRL_HOUR_TURNS = 1

/// An analog face: ring, hour hand, minute hand, in `currentColor`.
export function AnalogClock({
  ms,
  jump,
  size,
  ticks = false,
  weight = 1.7,
  className,
}: {
  ms: number
  jump: Jump | null
  size: number
  /// Marks at 12, 3, 6 and 9 — worth drawing only when the face is big.
  ticks?: boolean
  /// Stroke in viewBox units (the face is 24 across).
  weight?: number
  className?: string
}) {
  const target = handAngles(ms)
  const [state, setState] = useState(() => ({
    minute: { prev: target.minute, angle: target.minute } as Hand,
    hour: { prev: target.hour, angle: target.hour } as Hand,
    jumpId: jump?.id ?? 0,
    whirl: false,
  }))
  const whirling = jump !== null && jump.id !== state.jumpId
  if (
    whirling ||
    state.minute.prev !== target.minute ||
    state.hour.prev !== target.hour
  ) {
    const dir = whirling && !reducedMotion() ? jump.dir : 0
    setState({
      minute: step(state.minute, target.minute, dir, WHIRL_MINUTE_TURNS),
      hour: step(state.hour, target.hour, dir, WHIRL_HOUR_TURNS),
      jumpId: jump?.id ?? state.jumpId,
      whirl: dir !== 0,
    })
  }

  const hand = (angle: number) => ({
    transform: `rotate(${angle}deg)`,
    transformOrigin: "12px 12px",
    transformBox: "view-box" as const,
    transition: `transform ${state.whirl ? 650 : 400}ms var(--ease-out)`,
  })

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <circle cx="12" cy="12" r="10" />
      {ticks &&
        [0, 90, 180, 270].map((a) => (
          <line
            key={a}
            x1="12"
            y1="3.4"
            x2="12"
            y2="4.8"
            transform={`rotate(${a} 12 12)`}
          />
        ))}
      <g data-hand="hour" style={hand(state.hour.angle)}>
        <line x1="12" y1="12" x2="12" y2="7.4" />
      </g>
      <g data-hand="minute" style={hand(state.minute.angle)}>
        <line x1="12" y1="12" x2="12" y2="4.6" />
      </g>
    </svg>
  )
}

/// One group of digits that rolls — the old ones out, the new ones in — when
/// it changes during a jump, and simply swaps when it changes on a tick.
function Roll({
  value,
  order,
  jump,
}: {
  value: string
  /// Position in the stagger: day, month, hour, minute.
  order: number
  jump: Jump | null
}) {
  const [state, setState] = useState<{
    cur: string
    prev: string | null
    jumpId: number
    dir: 1 | -1
  }>({ cur: value, prev: null, jumpId: jump?.id ?? 0, dir: 1 })
  const changed = state.cur !== value
  if (changed || (jump !== null && jump.id !== state.jumpId)) {
    const rolling = changed && jump !== null && jump.id !== state.jumpId
    setState({
      cur: value,
      prev: rolling ? state.cur : changed ? null : state.prev,
      jumpId: jump?.id ?? state.jumpId,
      dir: jump?.dir ?? state.dir,
    })
  }
  const settle = () => setState((now) => ({ ...now, prev: null }))
  // The old figures leave on animationend; this is the net under it, for a
  // browser that never plays the animation.
  const rolling = state.prev !== null
  useEffect(() => {
    if (!rolling) return
    const id = window.setTimeout(settle, 900)
    return () => window.clearTimeout(id)
  }, [rolling, state.cur])

  const delay = { "--time-delay": `${order * 45}ms` } as React.CSSProperties
  const up = state.dir > 0
  return (
    <span className="inline-grid overflow-y-clip align-bottom">
      {state.prev !== null && (
        <span
          key={`out-${state.prev}`}
          aria-hidden
          className={cn(
            "col-start-1 row-start-1",
            up ? "time-out-up" : "time-out-down"
          )}
          style={delay}
          onAnimationEnd={settle}
        >
          {state.prev}
        </span>
      )}
      <span
        key={state.cur}
        className={cn(
          "col-start-1 row-start-1",
          state.prev !== null && (up ? "time-in-up" : "time-in-down")
        )}
        style={delay}
      >
        {state.cur}
      </span>
    </span>
  )
}

/// "Fri 2 Oct 2026 · 14:05", each group rolling on its own.
export function Moment({
  ms,
  jump,
  wrap = false,
}: {
  ms: number
  jump: Jump | null
  /// May break between its groups when the room is short (the panel's card,
  /// on a phone), instead of running under whatever sits beside it.
  wrap?: boolean
}) {
  const p = momentParts(ms)
  return (
    <span className={cn("tabular-nums", !wrap && "whitespace-nowrap")}>
      {p.weekday} <Roll value={p.day} order={0} jump={jump} />{" "}
      <Roll value={p.month} order={1} jump={jump} /> {p.year} ·{" "}
      <Roll value={p.hour} order={2} jump={jump} />:
      <Roll value={p.minute} order={3} jump={jump} />
    </span>
  )
}

/// "● Virtual clock" — said in words whenever the clock is not the wall's. The
/// dot breathes; after a jump a ring leaves it once. Ink for the pale half of
/// the field it sits on (`.space-bg`).
export function VirtualLabel({
  jump,
  className,
}: {
  jump: Jump | null
  className?: string
}) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center gap-2 text-[0.875rem] font-medium whitespace-nowrap text-space-ink",
        className
      )}
    >
      <span className="relative grid size-2 place-items-center">
        {jump !== null && (
          <span
            key={jump.id}
            aria-hidden
            className="time-ping absolute inset-0 rounded-full bg-space-core"
          />
        )}
        <span className="time-breathe size-2 rounded-full bg-space-core" />
      </span>
      Virtual clock
    </span>
  )
}

/// The analog face in its disc — the point the dust flows into. The disc is
/// opaque and darker than the field, so it swallows the grains at its rim and
/// keeps the white hands readable wherever the gradient stands.
export function SpaceClock({
  ms,
  jump,
  size,
  pad = 4,
  ticks,
  weight,
  className,
}: {
  ms: number
  jump: Jump | null
  size: number
  /// Disc beyond the face, in px.
  pad?: number
  ticks?: boolean
  weight?: number
  className?: string
}) {
  return (
    <span
      className={cn(
        "space-core relative grid shrink-0 place-items-center rounded-full",
        className
      )}
      style={{ width: size + pad, height: size + pad }}
    >
      <AnalogClock
        ms={ms}
        jump={jump}
        size={size}
        ticks={ticks}
        weight={weight}
      />
    </span>
  )
}

/// The header's virtual clock: [● Virtual clock ......... (face)], pale
/// lavender at the label and violet at the face, with dust streaming from the
/// left into the face. Fixed width, so the face — the dust's target — stays
/// where `PILL_AIM` says it is.
const PILL_AIM = { x: 0.933, y: 0.5 }

export function VirtualPill({
  ms,
  jump,
  speed,
  paused,
  burst,
}: {
  ms: number
  jump: Jump | null
  speed: number
  paused: boolean
  burst: boolean
}) {
  return (
    <span className="space-bg relative isolate inline-flex h-7 w-[13rem] shrink-0 items-center justify-between overflow-hidden rounded-full pr-0.5 pl-3">
      <ParticleField
        target={PILL_AIM}
        speed={speed}
        burst={burst}
        paused={paused}
      />
      <VirtualLabel jump={jump} />
      <SpaceClock ms={ms} jump={jump} size={20} />
    </span>
  )
}
