import { ChevronRight } from "lucide-react"

import { Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { count, day, time, countPcs } from "@/lib/format"
import { SHOW_MISSING } from "@/lib/features"
import { cn } from "@/lib/utils"

import { useOpenHere } from "@/screens/operations/board/open-here"
import { arrived, type Trip } from "@/screens/operations/board/trips"

/// **Dispatched**: the board's history, folded behind one button (owner,
/// 15 Oct 2026, from allotment-ops-prototype). Every trip by day with what
/// the stores received; receiving is the store's step, so it is no lane.
/// Read only: after dispatch nothing changes here.
///
/// A trip says who it went to first, where it stands at the right (a dot and
/// a word: On the road, Received 1 of 2, Completed), then when it left, its
/// number, koli and pieces, then what the bay wrote about it — plate, driver,
/// courier (option A "Trips" of allotment-board-options, 17 Oct 2026). A trip
/// to several stores lists them, each with its own word, each opening its
/// delivery note; a trip to one store opens its note itself.
export function DispatchedSheet({
  open,
  onClose,
  trips,
  shop,
}: {
  open: boolean
  onClose: () => void
  trips: readonly Trip[]
  shop: (id: string) => string
}) {
  const openHere = useOpenHere()
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Dispatched"
    >
      {trips.length === 0 ? (
        <EmptyState>Nothing dispatched</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {trips.map((one, index) => {
            const dayLabel = day(one.left)
            const head =
              index > 0 && day(trips[index - 1].left) === dayLabel ? null : (
                <h3 className="mt-3 text-body first:mt-0">{dayLabel}</h3>
              )
            const got = one.stops.filter(arrived).length
            const issues = SHOW_MISSING
              ? one.stops.filter(
                  (stop) => (stop.received?.open_gap_qty ?? 0) > 0
                ).length
              : 0
            const done = got === one.stops.length
            const single = one.stops.length === 1
            const koli = one.stops.reduce(
              (sum, stop) => sum + stop.shipment.koli_count,
              0
            )
            const pieces = one.stops.reduce(
              (sum, stop) => sum + stop.shipment.unit_count,
              0
            )
            const status =
              got === 0
                ? "On the road"
                : !done
                  ? `Received ${got} of ${one.stops.length}`
                  : "Completed"
            const note = one.trip.trip_note?.trim()
            const press = (stop: Trip["stops"][number]) =>
              openHere({ key: "shipment", value: stop.shipment.shipment_id })
            const lead = (
              <>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 font-semibold text-ink">
                    {one.stops
                      .map((stop) => shop(stop.shipment.destination_store_id))
                      .join(", ")}
                  </span>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-2 whitespace-nowrap",
                      done ? "text-ok-fg" : "text-ink"
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-[7px] rounded-full",
                        done ? "bg-ok" : got > 0 ? "bg-warn" : "bg-accent"
                      )}
                    />
                    {status}
                    {issues > 0 && (
                      <span className="text-warn-fg">
                        {` · ${count(issues)} ${issues === 1 ? "issue" : "issues"}`}
                      </span>
                    )}
                  </span>
                </span>
                <span className="text-body tabular-nums">
                  {time(one.left)} · {one.number} · {count(koli)} koli ·{" "}
                  {count(pieces)} {pieces === 1 ? "pc" : "pcs"}
                </span>
                {note !== undefined && note !== "" && (
                  <span className="text-body">{note}</span>
                )}
              </>
            )
            return (
              <div key={one.trip.dispatch_id} className="contents">
                {head}
                <article className="overflow-hidden rounded-card border border-hairline bg-canvas">
                  {single ? (
                    // One store: the whole trip opens its delivery note.
                    <button
                      type="button"
                      onClick={press(one.stops[0])}
                      className="flex w-full flex-col gap-0.5 px-4 py-3.5 text-left transition-colors hover:bg-soft"
                    >
                      {lead}
                    </button>
                  ) : (
                    <div className="flex flex-col gap-0.5 px-4 py-3.5">
                      {lead}
                    </div>
                  )}
                  {!single &&
                    one.stops.map((stop) => (
                      <button
                        key={stop.shipment.shipment_id}
                        type="button"
                        onClick={press(stop)}
                        className="flex min-h-12 w-full items-center gap-3 border-t border-hairline pr-3 pl-4 text-left transition-colors hover:bg-soft"
                      >
                        <span className="min-w-0 flex-1 truncate text-ink">
                          {shop(stop.shipment.destination_store_id)}
                        </span>
                        <span className="shrink-0 text-body tabular-nums">
                          {count(stop.shipment.koli_count)} koli ·{" "}
                          {countPcs(stop.shipment.unit_count)}
                        </span>
                        <span
                          className={cn(
                            "w-26 shrink-0 text-right whitespace-nowrap",
                            arrived(stop) ? "text-ok-fg" : "text-body"
                          )}
                        >
                          {arrived(stop) ? "Received" : "On the road"}
                        </span>
                        <ChevronRight
                          aria-hidden
                          className="size-4 shrink-0 text-faint"
                        />
                      </button>
                    ))}
                </article>
              </div>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}
