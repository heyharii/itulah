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
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { moment } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  auditKeys,
  readAction,
  recentAudit,
  type AuditEntry,
} from "@/lib/queries/audit"
import { tableSetup, type TableSetup } from "@/lib/table"

/// Everything anybody did, newest first.
///
/// The record sheets each show their own slice of this; the point of the whole
/// feed is the question a slice cannot answer — "what happened this morning",
/// and "who has been trying something they are not allowed to do".
///
/// Refusals are kept and shown. A log that only recorded what succeeded would
/// answer "what changed" and quietly lose "who kept trying", which is the more
/// interesting half on a console with roles.

const columns: ColumnDef<TableSetup, AuditEntry>[] = [
  {
    accessorKey: "at",
    header: "When",
    size: 150,
    cell: ({ row }) => (
      <span className="text-body tabular-nums">{moment(row.original.at)}</span>
    ),
  },
  {
    accessorKey: "display_name",
    header: "Who",
    size: 170,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.display_name}</span>
    ),
  },
  {
    id: "action",
    accessorFn: (row) => readAction(row),
    header: "Did",
    size: 130,
    cell: ({ row }) => readAction(row.original),
  },
  {
    id: "subject",
    accessorFn: (row) => row.subject_kind ?? "",
    header: "To",
    size: 240,
    cell: ({ row }) =>
      row.original.subject_kind === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="flex items-center gap-2">
          <Tag>{row.original.subject_kind}</Tag>
          <span className="truncate font-mono text-id text-body">
            {row.original.subject_id}
          </span>
        </span>
      ),
  },
  {
    accessorKey: "status",
    header: "Answer",
    size: 110,
    cell: ({ row }) => (
      <Pill tone={row.original.status >= 400 ? "bad" : "ok"}>
        {row.original.status}
      </Pill>
    ),
  },
  {
    accessorKey: "path",
    header: "Request",
    size: 380,
    cell: ({ row }) => (
      <span className="font-mono text-[0.6875rem] text-mute">
        {row.original.method} {row.original.path}
      </span>
    ),
  },
]

export function ActivityLog() {
  const [query, setQuery] = useState("")
  const [only, setOnly] = useState<"all" | "refused">("all")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "at", desc: true },
  ])

  const feed = useQuery({
    queryKey: auditKeys.feed(null),
    queryFn: ({ signal }) => recentAudit(null, 500, signal),
    // Short, because this is the one screen somebody watches while something
    // is happening.
    staleTime: 5_000,
  })

  const rows = useMemo(() => {
    const all = feed.data ?? []
    return only === "refused" ? all.filter((row) => row.status >= 400) : all
  }, [feed.data, only])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: AuditEntry) => String(row.audit_id),
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, query, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Activity"
        sub="Every action anybody took, and what the server answered. Reads are not recorded — this says who changed things, not who looked."
      />

      <Toolbar>
        <Segmented
          options={[
            { value: "all", label: "Everything" },
            { value: "refused", label: "Refused" },
          ]}
          value={only}
          onChange={setOnly}
        />
        <Toolbar.Spacer />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          className="h-8 w-56"
        />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(feed, {
          loading: "Reading the log…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {only === "refused"
                  ? "Nothing has been refused."
                  : "Nothing has been done yet."}
              </EmptyState>
            ) : (
              <DataTable<AuditEntry>
                table={table}
                className="max-h-[calc(100vh-15rem)]"
              />
            ),
        })}
      </Card>
    </PageContent>
  )
}
