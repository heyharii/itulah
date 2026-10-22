import { Card } from "@/components/ui/card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Screen } from "@/components/ui/screen"
import { useCounts, type StoreCount } from "@/lib/counts"
import { count, day } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import { CountSheet } from "@/screens/stock/count-sheet"
import { kindLabel, poolName } from "@/screens/stock/count-words"
import { useOpenRecord } from "@/screens/stock/open-record"

/// Count — the store's counts in one list (owner, 21 Oct 2026: "list saja
/// langsung"): no To count / Done switch and no Count button. Every count,
/// newest first: where, which kind, when it was asked and the pieces filed
/// (no To do / Done / Not applied, owner 21 Oct 2026). A row opens the count as a sheet over the list (`?count=`);
/// the handheld does the counting.
export function Count() {
  const counts = useCounts()
  const record = useOpenRecord("count")

  const all = [...(counts.data ?? [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  )
  const todo = all.filter((one) => one.status === "ACTIVE")
  const ready = counts.data !== undefined
  const counted = all.reduce((sum, one) => sum + one.counted, 0)

  const columns: ListColumn<StoreCount>[] = [
    {
      id: "pool",
      header: "Place",
      cell: (one) => (
        <span className="font-medium text-ink">{poolName(one.pool_id)}</span>
      ),
      card: "title",
    },
    { id: "kind", header: "Count", cell: (one) => kindLabel(one.kind) },
    {
      id: "asked",
      header: "Asked",
      cell: (one) => day(one.created_at),
      className: "whitespace-nowrap",
    },
    {
      id: "counted",
      header: "Counted",
      align: "right",
      cell: (one) => `${count(one.counted)} ${one.counted === 1 ? "pc" : "pcs"}`,
      className: "whitespace-nowrap tabular-nums",
    },
  ]

  return (
    <Screen counter>
      <KpiStrip>
        <Kpi label="To count" value={ready ? count(todo.length) : "—"} />
        <Kpi label="Counts" value={ready ? count(all.length) : "—"} />
        <Kpi label="Pieces counted" value={ready ? count(counted) : "—"} />
      </KpiStrip>

      {queryState(counts, {
        loading: "Reading the counts…",
        render: () => (
          <Card>
            <ListTable
              rows={all}
              columns={columns}
              rowKey={(one) => one.count_id}
              onOpen={(one) => record.open(one.count_id)}
              roomy
              empty="No count yet."
            />
          </Card>
        ),
      })}

      <CountSheet
        entry={all.find((one) => one.count_id === record.value)}
        onClose={record.close}
      />
    </Screen>
  )
}
