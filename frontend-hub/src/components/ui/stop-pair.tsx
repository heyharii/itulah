import { MapPin, Target } from "lucide-react"

import { cn } from "@/lib/utils"

/// The stop-pair — DESIGN.md's `A→B` route block, `.route`/`.stop` in
/// `fulfillment-prototype.html`.
///
/// Two stops joined by a faint connector: the origin is an `{accent}`-tint
/// circle with a target glyph, the destination a `{soft-2}` circle with a pin.
/// Each stop is an address in 500 and a status line in `{mute}`.
///
/// This is how every outbound record says where it is going, and it exists as
/// a component because "DC Cikarang → C013 Wonosobo" written as a string in a
/// table cell is the thing it replaces: an arrow in a cell cannot say that the
/// first leg has happened and the second has not.
///
/// The destination turns `{ok}` when it is reached. Note what does **not**
/// happen: nothing here goes sky. `{info}` means *in motion* and belongs on
/// the record's status pill, not on a stop — a stop is a place, and a place is
/// not moving.
export function StopPair({
  from,
  to,
  className,
}: {
  from: Stop
  to: Stop & { done?: boolean }
  className?: string
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <StopRow stop={from} kind="from" />
      <StopRow stop={to} kind="to" done={to.done ?? false} last />
    </div>
  )
}

export interface Stop {
  /// Where. A site id and its name, as one line.
  readonly place: React.ReactNode
  /// What happened, or is expected to. `{mute}`, and the place for "Dispatched
  /// 06 Jun · 240 pcs · 5 cartons".
  readonly detail?: React.ReactNode
  /// Right-aligned and tabular — a time, an ETA, a slippage.
  readonly at?: React.ReactNode
  /// The one thing that reads as wrong: an ETA already missed.
  readonly late?: boolean
}

function StopRow({
  stop,
  kind,
  done = false,
  last = false,
}: {
  stop: Stop
  kind: "from" | "to"
  done?: boolean
  last?: boolean
}) {
  return (
    <div className="relative flex items-start gap-2.5 py-1">
      {/* The connector stops at the last node rather than trailing into
          nothing. */}
      {!last && (
        <span className="absolute top-[1.4375rem] -bottom-1 left-[0.5625rem] w-[1.5px] bg-hairline-2" />
      )}
      <span
        className={cn(
          "z-10 grid size-[1.1875rem] shrink-0 place-items-center rounded-full [&_svg]:size-[0.6875rem]",
          kind === "from" && "bg-accent-bg text-accent",
          kind === "to" && !done && "bg-soft-2 text-body",
          kind === "to" && done && "bg-ok-bg text-ok-fg"
        )}
      >
        {kind === "from" ? <Target /> : <MapPin />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-medium text-ink">
          {stop.place}
        </span>
        {stop.detail && (
          <span
            className={cn(
              "block truncate text-[0.9375rem]",
              stop.late ? "text-bad" : "text-mute"
            )}
          >
            {stop.detail}
          </span>
        )}
      </span>
      {stop.at && (
        <span
          className={cn(
            "shrink-0 text-[0.9375rem] whitespace-nowrap tabular-nums",
            stop.late ? "text-bad" : "text-mute"
          )}
        >
          {stop.at}
        </span>
      )}
    </div>
  )
}
