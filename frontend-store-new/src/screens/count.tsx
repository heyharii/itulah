import { useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { CardList } from "@/components/ui/card-list"
import { LeadCard } from "@/components/ui/lead-card"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Status } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/states"
import { useCounts, type StoreCount } from "@/lib/counts"
import { count, day } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import { CountSheet } from "@/screens/stock/count-sheet"
import { kindLabel, poolName, statusOf } from "@/screens/stock/count-words"
import { useOpenRecord } from "@/screens/stock/open-record"
import { Figures } from "@/screens/stock/parts"

/// Count — what head office asked this store to count, and the counts already
/// sent. The count itself is blind and lives in the sheet.
///
/// Nothing at the top but the title (the top bar's) and one line of figures. To
/// count / Done is the dock's status chip on a phone and a `Segmented` on a
/// desk. A count is a card — the pool and the kind of count, the pieces filed so
/// far as the one figure, and in the foot when it was asked beside a word
/// button, or its state once it is sent — and opens as a sheet over the list
/// (`?count=`).
type View = "todo" | "done"

export function Count() {
  const counts = useCounts()
  const record = useOpenRecord("count")
  const [view, setView] = useState<View>("todo")

  const all = counts.data ?? []
  const todo = all.filter((one) => one.status === "ACTIVE")
  const done = all.filter((one) => one.status !== "ACTIVE")
  const rows = view === "todo" ? todo : done

  return (
    <Screen counter>
      <DockTools
        status={{
          value: view,
          options: [
            { value: "todo", label: "To count", count: todo.length },
            { value: "done", label: "Done", count: done.length },
          ],
          onChange: (next) => setView(next as View),
        }}
      />

      {queryState(counts, {
        loading: "Reading the counts…",
        render: () => (
          <>
            <Figures>
              <b className="font-medium text-ink">{count(todo.length)}</b> to
              count · {count(done.length)} done
            </Figures>

            {/* The desk's switch; on a phone it is the dock's status chip. */}
            <div className="mb-3.5 flex items-center max-md:hidden">
              <Segmented<View>
                value={view}
                onChange={setView}
                options={[
                  { value: "todo", label: `To count · ${count(todo.length)}` },
                  { value: "done", label: `Done · ${count(done.length)}` },
                ]}
              />
            </div>

            {rows.length === 0 ? (
              <EmptyState>
                {view === "todo"
                  ? "Nothing to count."
                  : "No count has been sent yet."}
              </EmptyState>
            ) : (
              <CardList grid>
                {rows.map((one) => (
                  <CountCard
                    key={one.count_id}
                    one={one}
                    selected={record.value === one.count_id}
                    onOpen={() => record.open(one.count_id)}
                  />
                ))}
              </CardList>
            )}
          </>
        ),
      })}

      <CountSheet
        entry={all.find((one) => one.count_id === record.value)}
        onClose={record.close}
      />
    </Screen>
  )
}

/// One count as the uniform card: the pool over the kind of count and why it
/// was asked, the pieces filed so far as the one figure, and in the foot when
/// it was asked. A count still to do carries the word that opens it; one that
/// has gone carries its state.
function CountCard({
  one,
  selected,
  onOpen,
}: {
  one: StoreCount
  selected: boolean
  onOpen: () => void
}) {
  const active = one.status === "ACTIVE"
  const status = statusOf(one.status)
  return (
    <LeadCard
      onOpen={onOpen}
      selected={selected}
      title={poolName(one.pool_id)}
      lines={[kindLabel(one.kind), one.reason]}
      lead={{
        figure: count(one.counted),
        caption: "pcs counted",
        muted: one.counted === 0,
      }}
      foot={{
        info: `Asked ${day(one.created_at)}`,
        action: active ? { label: "Count", onClick: onOpen } : undefined,
        status: active ? undefined : (
          <Status tone={status.tone}>{status.word}</Status>
        ),
      }}
    />
  )
}
