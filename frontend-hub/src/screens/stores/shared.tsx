import type { Tone } from "@/lib/format"
import type { ServerState, StoreStatus } from "@/lib/queries/stores"
import { cn } from "@/lib/utils"

/// Words and tones for the two state machines every Stores screen draws —
/// the store's own lifecycle and its server's — kept in one place so the list
/// and the detail page never disagree about what "waiting for approval" is
/// called or what colour it wears.

export const STORE_STATUS_LABEL: Record<StoreStatus, string> = {
  GETTING_READY: "Getting ready",
  OPEN: "Open",
  CLOSED: "Closed",
}

export const STORE_STATUS_TONE: Record<StoreStatus, Tone> = {
  GETTING_READY: "warn",
  OPEN: "ok",
  CLOSED: "neutral",
}

export const SERVER_STATE_LABEL: Record<ServerState, string> = {
  NOT_INSTALLED: "Not installed",
  WAITING_TO_INSTALL: "Waiting to be installed",
  WAITING_FOR_APPROVAL: "Waiting for approval",
  SYNCING: "Pulling its first data",
  ONLINE: "Online",
  OFFLINE: "Offline",
}

export const SERVER_STATE_TONE: Record<ServerState, Tone> = {
  NOT_INSTALLED: "neutral",
  WAITING_TO_INSTALL: "warn",
  WAITING_FOR_APPROVAL: "warn",
  SYNCING: "info",
  ONLINE: "ok",
  OFFLINE: "bad",
}

/// A small dot in the server's colour, for a list row or an inline mention —
/// the mock's `<span class="dot">`.
export function ServerDot({ state }: { state: ServerState }) {
  const tone = SERVER_STATE_TONE[state]
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-[8px] shrink-0 rounded-full",
        tone === "ok" && "bg-ok",
        tone === "bad" && "bg-bad",
        tone === "warn" && "bg-warn",
        tone === "info" && "bg-info",
        tone === "neutral" && "bg-mute"
      )}
    />
  )
}

/// The readiness ring: how much of the checklist is done, or a plain check
/// once the store is open and the checklist no longer matters. Same
/// construction as the setup card's own ring (`screens/setup/setup-card.tsx`)
/// — one page teaching two rings two different ways to draw a share was the
/// thing this factoring exists to stop.
export function ReadinessRing({
  done,
  total,
  complete,
  size = 34,
}: {
  done: number
  total: number
  /// The store is open: draw a settled check rather than a share that would
  /// otherwise be stuck at less than a full circle if `total` counts things
  /// (first stock, say) that stop applying once trading has started.
  complete?: boolean
  size?: number
}) {
  const share = complete ? 1 : total > 0 ? done / total : 0
  const radius = size / 2 - 3.5
  const round = 2 * Math.PI * radius
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="stroke-hairline-2"
          strokeWidth="3"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={cn(complete ? "stroke-ok" : "stroke-accent")}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={round}
          strokeDashoffset={round * (1 - share)}
        />
      </svg>
      <span className="text-[0.625rem] font-semibold text-ink tabular-nums">
        {complete ? "✓" : `${done}/${total}`}
      </span>
    </div>
  )
}

/// A titled block inside a page: the heading, an optional control beside it,
/// and whatever the section is about. Same shape as `screens/system/shared.tsx`
/// — kept as its own copy rather than imported across modules, the house rule
/// for a component this small.
export function Section({
  title,
  actions,
  children,
}: {
  title: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-card-title font-semibold text-ink">{title}</h4>
        {actions}
      </div>
      {children}
    </div>
  )
}
