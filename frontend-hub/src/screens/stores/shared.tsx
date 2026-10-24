import { useCallback } from "react"
import { useRouterState, type LinkProps } from "@tanstack/react-router"

import type { Tone } from "@/lib/format"
import type { ServerState, StoreStatus } from "@/lib/queries/stores"
import { cn } from "@/lib/utils"

/// Words and tones for the two state machines every Stores screen draws —
/// the store's own lifecycle and its server's — kept in one place so the list
/// and the detail page never disagree about what "waiting for approval" is
/// called or what colour it wears. The server reads "Waiting for the server",
/// "Getting data" and "Ready" — the words the install flow speaks.

const STORE_STATUS_LABEL: Record<StoreStatus, string> = {
  GETTING_READY: "Getting ready",
  OPEN: "Open",
  STOPPED: "Stopped",
  CLOSED: "Removed",
}

const STORE_STATUS_TONE: Record<StoreStatus, Tone> = {
  GETTING_READY: "warn",
  OPEN: "ok",
  STOPPED: "bad",
  CLOSED: "neutral",
}

const SERVER_STATE_LABEL: Record<ServerState, string> = {
  NOT_INSTALLED: "Not installed",
  WAITING_TO_INSTALL: "Waiting for the server",
  WAITING_FOR_APPROVAL: "Waiting for approval",
  SYNCING: "Getting data",
  ONLINE: "Ready",
  OFFLINE: "Offline",
}

const SERVER_STATE_TONE: Record<ServerState, Tone> = {
  NOT_INSTALLED: "neutral",
  WAITING_TO_INSTALL: "warn",
  WAITING_FOR_APPROVAL: "warn",
  SYNCING: "info",
  ONLINE: "ok",
  OFFLINE: "bad",
}

/// `StoreSummary.status` and `StoreServer.state` are generated as plain
/// `string` (see `lib/queries/stores.ts`), so every reader of one goes
/// through a function here rather than indexing the maps above directly —
/// one place casts, and one place falls back for a value the server sends
/// that this app does not have a word for yet.
export function storeStatusLabel(status: string): string {
  return STORE_STATUS_LABEL[status as StoreStatus] ?? status
}

export function storeStatusTone(status: string): Tone {
  return STORE_STATUS_TONE[status as StoreStatus] ?? "neutral"
}

export function serverStateLabel(state: string): string {
  return SERVER_STATE_LABEL[state as ServerState] ?? state
}

function serverStateTone(state: string): Tone {
  return SERVER_STATE_TONE[state as ServerState] ?? "neutral"
}

/// A small dot in the server's colour, for a list row or an inline mention —
/// the mock's `<span class="dot">`.
export function ServerDot({ state }: { state: string }) {
  const tone = serverStateTone(state)
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-[8px] shrink-0 rounded-full",
        // A code is out and the shop has not used it yet: the dot breathes.
        state === "WAITING_TO_INSTALL" && "motion-safe:animate-pulse",
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
  size = 52,
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
      <span className="text-[0.9375rem] leading-none font-semibold text-ink tabular-nums">
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

/// The path of one store's page, from wherever the link sits.
///
/// The Stores screens are filed twice: Master › Stores, where a shop is added
/// and its server installed (owner, 2026-10-11), and Sales › Stores, where
/// shops are watched trading. A link keeps the department it is clicked in, so
/// the sidebar does not change under somebody opening a store; anything outside
/// Sales — Locations, the setup list, the manager links — lands in Master.
export function useStorePath(): (unitId: string) => LinkProps["to"] {
  const inSales = useRouterState({
    select: (state) => state.location.pathname.startsWith("/stores"),
  })
  const base = inSales ? "/stores" : "/master/stores"
  return useCallback(
    (unitId: string) => `${base}/${encodeURIComponent(unitId)}` as LinkProps["to"],
    [base]
  )
}
