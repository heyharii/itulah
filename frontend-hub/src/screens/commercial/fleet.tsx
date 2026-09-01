import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import {
  commercialFleet,
  commercialKeys,
  type ShopActivation,
} from "@/lib/queries/commercial"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"

/// Which shop is charging which price book, and how far behind it is.
///
/// Reported by the shop itself, in the transaction that put the book into
/// service — never ticked off by hand, so the centre's record and the till's
/// behaviour cannot disagree. "Published" and "in force" are different things
/// and this screen is the difference.

/// A shop that has never activated anything is not "behind by zero" and not
/// "behind by one": it is infinitely behind, which is not a number. Sorted
/// above everything, because it is the row that matters most and the one an
/// activations list would have left out entirely.
const NEVER = Number.MAX_SAFE_INTEGER

/// Between the shop's own clock and the centre's. The gap is the number worth
/// watching: a shop that switched books an hour before the centre heard about
/// it was priced correctly and reporting late, which is a different fault from
/// a shop that never switched.
function reportingGap(row: ShopActivation): number | null {
  if (row.activated_at === null || row.reported_at === null) return null
  const activated = new Date(row.activated_at).getTime()
  const reported = new Date(row.reported_at).getTime()
  if (Number.isNaN(activated) || Number.isNaN(reported)) return null
  return Math.max(0, reported - activated)
}

/// A duration a person says out loud. 400 minutes is "6h", and nobody has ever
/// counted 400 minutes.
function saidAloud(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return "at once"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

const columns: ColumnDef<TableSetup, ShopActivation>[] = [
  {
    id: "shop",
    accessorFn: (row) => row.label ?? row.site_id ?? row.origin_id,
    header: "Shop",
    size: 220,
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {row.original.label ?? row.original.site_id ?? row.original.origin_id}
      </span>
    ),
  },
  {
    accessorKey: "site_id",
    header: "Site",
    size: 120,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.site_id ?? "—"}
      </span>
    ),
  },
  {
    id: "book",
    accessorFn: (row) => row.version ?? -1,
    header: "Charging from",
    size: 220,
    cell: ({ row }) =>
      row.original.version === null ? (
        <Pill tone="bad">Never taken a book</Pill>
      ) : (
        <span className="text-text">
          <span className="font-mono text-id text-body">
            v{row.original.version}
          </span>{" "}
          {row.original.book_name ?? ""}
        </span>
      ),
  },
  {
    id: "behind",
    accessorFn: (row) => row.behind_by ?? NEVER,
    header: "Behind by",
    size: 110,
    meta: { align: "right" },
    // The decision metric. Not a boolean "up to date": a shop can be behind by
    // one book published a minute ago, which is ordinary, or by four published
    // in March, which is not. The screen needs the size.
    cell: ({ row }) => {
      const behind = row.original.behind_by
      if (behind === null)
        return <span className="font-medium text-bad-fg">All of them</span>
      if (behind === 0) return <span className="text-mute">Up to date</span>
      return (
        <span
          className={
            behind > 1 ? "font-medium text-bad-fg" : "font-medium text-warn-fg"
          }
        >
          {count(behind)} book{behind === 1 ? "" : "s"}
        </span>
      )
    },
  },
  {
    accessorKey: "price_rule_count",
    header: "Rules taken",
    size: 110,
    meta: { align: "right" },
    // How much of the book arrived, so a truncated delivery shows as a number
    // rather than as a wrong price weeks later.
    cell: ({ row }) =>
      row.original.price_rule_count === null ? (
        <span className="text-mute">—</span>
      ) : (
        count(row.original.price_rule_count)
      ),
  },
  {
    accessorKey: "activated_at",
    header: "In service since",
    size: 160,
    cell: ({ row }) =>
      row.original.activated_at ? (
        moment(row.original.activated_at)
      ) : (
        <span className="text-mute">—</span>
      ),
  },
  {
    id: "gap",
    accessorFn: (row) => reportingGap(row) ?? -1,
    header: "Told us after",
    size: 120,
    meta: { align: "right" },
    cell: ({ row }) => {
      const gap = reportingGap(row.original)
      if (gap === null) return <span className="text-mute">—</span>
      return (
        <span className={gap > 3_600_000 ? "text-warn-fg" : "text-text"}>
          {saidAloud(gap)}
        </span>
      )
    },
  },
]

export function CommercialFleet() {
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "behind", desc: true },
  ])

  const fleet = useQuery({
    queryKey: commercialKeys.fleet(),
    queryFn: ({ signal }) => commercialFleet(signal),
  })

  const rows = useMemo(() => fleet.data?.items ?? [], [fleet.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: ShopActivation) => row.origin_id,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, query, sorting]
    )
  )

  const stalled = rows.filter(
    (row) => !row.has_ever_activated || (row.behind_by ?? 0) > 0
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Fleet"
        sub="Which shop is charging which book. A book is published by the centre and put into service by the shop, and those are two different moments."
        actions={
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="h-8 w-48"
          />
        }
      />

      {fleet.data && stalled.length > 0 && (
        <Banner tone="warn" className="mb-4">
          {count(stalled.length)} of {count(fleet.data.shop_count)} shop
          {fleet.data.shop_count === 1 ? "" : "s"}{" "}
          {stalled.length === 1 ? "is" : "are"} not on v
          {fleet.data.newest_published_version ?? "—"}, the newest published
          book. Until a shop takes it up, its till charges what it last
          received.
        </Banner>
      )}

      <Card className="overflow-hidden">
        {queryState(fleet, {
          loading: "Asking what each shop is charging…",
          render: (data) =>
            data.items.length === 0 ? (
              <EmptyState>
                No shop origin is registered at the centre, so nothing has been
                sent anywhere. A published book with no fleet reaches no till.
              </EmptyState>
            ) : (
              <DataTable<ShopActivation>
                table={table}
                empty="No shop matches that search."
                className="max-h-[calc(100vh-15rem)]"
              />
            ),
        })}
      </Card>
    </PageContent>
  )
}
