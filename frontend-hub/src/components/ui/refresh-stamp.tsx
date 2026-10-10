import { useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"

import { DockPortal, useDock } from "@/components/shell/dock"
import { dayTime, recentMoment, time } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useOnline } from "@/lib/offline/reference"
import { isRestored } from "@/lib/query-persist"
import { cn } from "@/lib/utils"

/// How old the rows on screen are, and the way to ask again.
///
/// A list paints from the cache the moment it opens (prefetched, or restored
/// from this device's last visit), so what is on screen may be minutes old, or
/// hours. Every screen that draws a table therefore says when its data was
/// read and carries a reload — one piece, here, and `<DataTable refresh>`
/// draws it for every table (owner, 2026-10-09).
///
/// ```tsx
/// <RefreshStamp queries={[orders, suppliers]} />   // anywhere a bar has room
/// <DataTable table={table} refresh={[orders]} />    // above the table, for free
/// ```
///
/// ## The words
///
/// `Updated 14:05` today, `Updated 08 Oct, 14:05` earlier this year, and
/// `Updated 08 Oct 2025, 14:05` before that (the hub's date rule). Several
/// queries say the OLDEST of them: a screen is as fresh as its stalest read.
/// One word is added when it matters, never two: `· offline` when the device
/// has no connection (what is shown is all there is), `· saved` when the rows
/// are the copy restored from the last visit and nothing has read them since.
/// While a read is in flight the words stay and the arrow turns.
///
/// ## Where it goes
///
/// A bar with room draws the whole of it. On a phone the reload is a round 44px
/// button in the dock over the bottom bar, with the other actions, and only the
/// words stay where the stamp was put (`DockPortal` — the thumb's place, never
/// the top of the list).
///
/// ## The turn
///
/// `animation: spin 1s linear` for as long as anything is being read, and when
/// the read ends the arrow finishes the turn it is in rather than snapping back
/// to 0°: a snap reads as a glitch, a finished turn reads as "done". Constant
/// motion is linear; never faster than a turn a second. Under reduced motion it
/// does not turn — it dims while the read is on.

/// The part of a TanStack query result the stamp reads. A `useQuery` and a
/// `useInfiniteQuery` result both fit.
export interface Refreshable {
  /// When the data was last read, ms. 0 is "never".
  readonly dataUpdatedAt: number
  readonly isFetching: boolean
  /// An infinite query paging in as the list scrolls is not a reload: the
  /// arrow does not turn for it.
  readonly isFetchingNextPage?: boolean
  /// Used to find the query in the cache, to ask whether its data is the
  /// restored copy.
  readonly data?: unknown
  /// Refetches what is loaded; an infinite query asks again for the pages it
  /// holds, without resetting them.
  readonly refetch: (options?: { cancelRefetch?: boolean }) => unknown
}

/// "Updated 14:05" for today, with the day for an earlier one and the year
/// when it is not this year. `now` is passed in so the words follow the clock
/// the stamp keeps.
function stampWords(at: number, now: number): string {
  const read = new Date(at)
  const here = new Date(now)
  if (read.getFullYear() !== here.getFullYear())
    return `Updated ${dayTime(read)}`
  const today =
    read.getMonth() === here.getMonth() && read.getDate() === here.getDate()
  return `Updated ${today ? time(read) : recentMoment(read)}`
}

/// Being read again — not paged further.
function reading(query: Refreshable): boolean {
  return query.isFetching && query.isFetchingNextPage !== true
}

/// The oldest read among the queries, or null while none has read anything.
function oldest(queries: readonly Refreshable[]): number | null {
  let at: number | null = null
  for (const query of queries)
    if (query.dataUpdatedAt > 0 && (at === null || query.dataUpdatedAt < at))
      at = query.dataUpdatedAt
  return at
}

/// Whether any query that is not being read right now is showing the copy
/// restored from the last visit. A `Query` is found by the data it holds: a
/// result does not carry its hash.
function useRestored(queries: readonly Refreshable[]): boolean {
  const client = useQueryClient()
  const settled = queries.filter(
    (query) => !reading(query) && query.data !== undefined
  )
  if (settled.length === 0) return false
  const held = client.getQueryCache().getAll()
  return settled.some((query) => {
    const found = held.find((one) => one.state.data === query.data)
    return found !== undefined && isRestored(found.queryHash)
  })
}

/// A clock for the words: the day can change under an open screen, and so can
/// the connection.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

export function RefreshStamp({
  queries,
  className,
}: {
  /// The screen's queries. Their results as they stand — `[orders, suppliers]`.
  queries: readonly Refreshable[]
  className?: string
}) {
  const layout = useLayout()
  const dock = useDock()
  const online = useOnline()
  const now = useNow()
  const restored = useRestored(queries)

  const at = oldest(queries)
  const fetching = queries.some(reading)
  const note = !online ? "offline" : restored ? "saved" : null
  const words =
    at === null ? null : `${stampWords(at, now)}${note ? ` · ${note}` : ""}`

  // Turning: from the moment a read starts until the turn it is in is done.
  const [turning, setTurning] = useState(false)
  if (fetching && !turning) setTurning(true)
  useEffect(() => {
    if (fetching || !turning) return
    // The turn ends on `animationiteration`; this is for the case it never
    // fires (reduced motion, a hidden tab).
    const id = window.setTimeout(() => setTurning(false), 1100)
    return () => window.clearTimeout(id)
  }, [fetching, turning])

  const reload = () => {
    // A press while a read is on would cancel it and start another: two round
    // trips for one answer.
    if (fetching) return
    void Promise.all(
      queries.map((query) => query.refetch({ cancelRefetch: false }))
    )
  }

  const phone = layout === "phone" && dock !== null
  const button = (
    <button
      type="button"
      onClick={reload}
      aria-label={words === null ? "Reload" : `Reload. ${words}`}
      aria-busy={fetching || undefined}
      title="Reload"
      className={cn(
        "grid shrink-0 place-items-center text-body transition-[scale,background-color,color] duration-(--t-press) ease-(--ease-out) active:scale-[0.92]",
        phone
          ? // The dock's round 44, beside the other things it carries.
            "order-first size-11 rounded-full bg-soft-2"
          : "size-control rounded-inner hover:bg-soft-2 hover:text-ink pointer-coarse:size-11"
      )}
    >
      <RefreshCw
        aria-hidden
        onAnimationIteration={() => {
          if (!fetching) setTurning(false)
        }}
        className={cn(
          "size-4",
          turning && "motion-safe:animate-spin motion-reduce:opacity-50"
        )}
      />
    </button>
  )

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[0.875rem] text-mute tabular-nums",
        className
      )}
    >
      {words !== null && <span className="whitespace-nowrap">{words}</span>}
      {phone ? <DockPortal slot="action">{button}</DockPortal> : button}
    </span>
  )
}

/// The stamp as a line of its own over a table — what `<DataTable refresh>`
/// draws. A desk gets it at the right with the reload beside the words; a
/// phone gets the words at the left, and the reload is in the dock.
export function RefreshStrip({
  queries,
  className,
}: {
  queries: readonly Refreshable[]
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-h-control shrink-0 items-center justify-end px-2 max-md:min-h-0 max-md:justify-start max-md:px-1 max-md:pb-2",
        className
      )}
    >
      <RefreshStamp queries={queries} />
    </div>
  )
}
