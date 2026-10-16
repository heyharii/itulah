import { Sheet } from "@/components/ui/sheet"
import { count, day, time } from "@/lib/format"
import { SHOW_MISSING } from "@/lib/features"
import { cn } from "@/lib/utils"

import { useOpenHere } from "@/screens/operations/board/open-here"
import { arrived, type Trip } from "@/screens/operations/board/trips"

/// **Dispatched**: the board's history, folded behind one button (owner,
/// 15 Oct 2026, from allotment-ops-prototype). Every trip by day with what
/// the stores received; receiving is the store's step, so it is no lane.
/// Read only: after dispatch nothing changes here.
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
        <p className="py-10 text-center text-body">Nothing dispatched</p>
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
                ? "Not received yet"
                : !done
                  ? `Received ${got} of ${one.stops.length}`
                  : "Completed"
            return (
              <div key={one.trip.dispatch_id} className="contents">
                {head}
                <article
                  className={cn(
                    "relative rounded-[0.625rem] border border-hairline px-4 py-3 transition-[border-color,transform] duration-(--t-press) ease-(--ease-out)",
                    done ? "bg-soft" : "bg-canvas",
                    single &&
                      "hover:border-hairline-strong has-[button:active]:scale-[0.98] motion-reduce:transition-none"
                  )}
                >
                  {/* One store: the whole trip opens its delivery note. */}
                  {single && (
                    <button
                      type="button"
                      aria-label={`Open ${one.number}`}
                      onClick={openHere({
                        key: "shipment",
                        value: one.stops[0].shipment.shipment_id,
                      })}
                      className="absolute inset-0 rounded-[0.625rem]"
                    />
                  )}
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold text-ink">
                      {time(one.left)} ·{" "}
                      {one.stops.length === 1
                        ? shop(one.stops[0].shipment.destination_store_id)
                        : `${count(one.stops.length)} stores`}
                    </span>
                    <span className="shrink-0 text-body tabular-nums">
                      {count(koli)} koli
                    </span>
                  </div>
                  <div className="font-mono text-mute">{one.number}</div>
                  <div className="mt-1 tabular-nums">
                    <span className="font-semibold text-ink">
                      {count(pieces)}
                    </span>{" "}
                    <span className="text-body">pcs · </span>
                    <span
                      className={cn(
                        issues > 0
                          ? "text-warn-fg"
                          : done
                            ? "text-ok-fg"
                            : "text-body"
                      )}
                    >
                      {status}
                      {issues > 0 &&
                        ` · ${count(issues)} ${issues === 1 ? "issue" : "issues"}`}
                    </span>
                  </div>
                  {!single && (
                    <div className="mt-2 flex flex-col border-t border-hairline">
                      {one.stops.map((stop) => {
                        const press = openHere({
                          key: "shipment",
                          value: stop.shipment.shipment_id,
                        })
                        return (
                          <button
                            key={stop.shipment.shipment_id}
                            type="button"
                            onClick={press}
                            className="flex min-h-11 items-center justify-between gap-3 border-b border-hairline text-left last:border-b-0 hover:text-ink"
                          >
                            <span className="min-w-0 truncate text-ink">
                              {shop(stop.shipment.destination_store_id)}
                            </span>
                            <span className="shrink-0 text-body tabular-nums">
                              {count(stop.shipment.unit_count)} pcs ·{" "}
                              {arrived(stop) ? "Received" : "On the road"}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </article>
              </div>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}
