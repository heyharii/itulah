import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Screen } from "@/components/ui/screen"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { useCounts, type StoreCount } from "@/lib/counts"
import { count, day } from "@/lib/format"
import { cn } from "@/lib/utils"
import { CountSheet, CountStatusWord } from "@/screens/stock/count-sheet"
import { kindLabel, poolName } from "@/screens/stock/count-words"

/// Count — what head office asked this store to count, and the counts already
/// sent. The count itself is blind and lives in the sheet.
export function Count() {
  const counts = useCounts()
  const [tab, setTab] = useState<"todo" | "done">("todo")
  const [opened, setOpened] = useState<string | null>(null)

  if (counts.isPending) {
    return (
      <Screen className="[&>div:first-child]:md:mb-6">
        <LoadingState />
      </Screen>
    )
  }
  if (counts.isError) {
    return (
      <Screen className="[&>div:first-child]:md:mb-6">
        <ErrorState
          error={counts.error}
          onRetry={() => void counts.refetch()}
        />
      </Screen>
    )
  }

  const todo = counts.data.filter((one) => one.status === "ACTIVE")
  const done = counts.data.filter((one) => one.status !== "ACTIVE")
  const rows = tab === "todo" ? todo : done
  const live = counts.data.find((one) => one.count_id === opened)

  return (
    <Screen className="[&>div:first-child]:md:mb-6">
      <div
        role="tablist"
        className="mb-6 flex gap-0.5 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-hairline)]"
      >
        {(
          [
            [
              "todo",
              todo.length > 0 ? `To count · ${count(todo.length)}` : "To count",
            ],
            ["done", "Done"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "border-b-2 px-3 pt-2 pb-2.5 text-card-title font-medium whitespace-nowrap transition-colors pointer-coarse:min-h-11",
              tab === value
                ? "border-ink text-ink"
                : "border-transparent text-body hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState>Nothing to count.</EmptyState>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-card border border-hairline bg-canvas">
          <table className="w-full border-collapse text-cell">
            <thead className="max-md:hidden">
              <tr className="h-12 bg-soft text-left font-medium text-body">
                <th className="px-4 font-medium">Count</th>
                <th className="px-4 font-medium">Why</th>
                <th className="w-28 px-4 font-medium">Asked</th>
                <th className="w-36 px-4 font-medium">Status</th>
                <th className="w-32 px-4" />
              </tr>
            </thead>
            <tbody>
              {rows.map((one) => (
                <Row key={one.count_id} one={one} onOpen={setOpened} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {live !== undefined && (
        <CountSheet entry={live} onClose={() => setOpened(null)} />
      )}
    </Screen>
  )
}

function Row({
  one,
  onOpen,
}: {
  one: StoreCount
  onOpen: (id: string) => void
}) {
  const open = () => onOpen(one.count_id)
  return (
    <tr
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          open()
        }
      }}
      tabIndex={0}
      className="h-16 cursor-pointer border-t border-hairline text-text transition-colors outline-none first:border-t-0 hover:bg-soft/60 focus-visible:bg-soft"
    >
      <td className="px-4">
        <span className="block truncate text-card-title font-semibold text-ink">
          {poolName(one.pool_id)}
        </span>
        <span className="mt-1 block truncate text-meta text-mute">
          {kindLabel(one.kind)}
          <span className="md:hidden">
            {" · "}
            {day(one.created_at)}
          </span>
        </span>
      </td>
      <td className="max-w-0 px-4 max-md:hidden">
        <span className="block truncate text-body">
          {one.reason !== null && one.reason !== "" ? one.reason : "—"}
        </span>
      </td>
      <td className="px-4 text-body tabular-nums max-md:hidden">
        {day(one.created_at)}
      </td>
      <td className="px-4">
        <CountStatusWord status={one.status} />
      </td>
      <td className="px-4 text-right max-md:hidden">
        {one.status === "ACTIVE" ? (
          <Button variant="primary" className="h-9">
            Open
          </Button>
        ) : (
          <span className="text-meta text-mute tabular-nums">
            {count(one.counted)}
          </span>
        )}
      </td>
    </tr>
  )
}
