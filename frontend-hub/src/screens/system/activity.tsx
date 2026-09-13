import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState, Truncated } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
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
///
/// **Every count on this screen is a count of rows that are here.** The facets
/// in the filter panel are computed over the page in the browser, not over the
/// log, and the page is capped — so the banner above the table says how many
/// arrived. On an audit surface an approximate figure is worse than none: "12
/// refusals" read as the week's total, when it is the number of refusals among
/// the newest five hundred actions, is how somebody closes an investigation
/// early. The server counts the whole feed exactly in `facets.outcomes`; when
/// this screen starts narrowing at the server, those are the numbers to show.

const columns: ColumnDef<TableSetup, AuditEntry>[] = [
  {
    accessorKey: "at",
    header: "When",
    size: 150,
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => (
      <span className="text-body tabular-nums">{moment(row.original.at)}</span>
    ),
  },
  {
    accessorKey: "display_name",
    header: "Who",
    size: 170,
    // A console has a dozen accounts, not a thousand, so the set of people who
    // appear here is a set somebody can read down — which is what makes "what
    // did this person do" a pick rather than a typed name they might spell the
    // way the roster does and not the way the log does.
    meta: { filter: { kind: "option", label: "Who" } },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.display_name}</span>
    ),
  },
  {
    id: "action",
    accessorFn: (row) => readAction(row),
    header: "Did",
    size: 130,
    meta: { filter: { kind: "option", label: "Did" } },
    cell: ({ row }) => readAction(row.original),
  },
  {
    id: "subject",
    accessorFn: (row) => row.subject_kind ?? "",
    header: "To",
    size: 240,
    // Empty is a real answer here rather than a missing one: a sign-in changes
    // nothing and names no record, so `is empty` is how somebody separates
    // sessions from edits.
    meta: { filter: { kind: "option", label: "Record kind" } },
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
    // The code itself, not a word for it. "Refused" is the segment above; this
    // is the column that tells a 403 from a 409 — somebody who may not do a
    // thing from somebody who may and was too late.
    meta: { filter: { kind: "option", label: "Answer" } },
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

/// What the feed is asked for. `FEED_MAX_LIMIT` at the server, so this is the
/// most the log will ever hand over in one answer and there is no second page
/// to ask for.
const CAP = 500

export function ActivityLog() {
  const [query, setQuery] = useState("")
  const [only, setOnly] = useState<"all" | "refused">("all")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "at", desc: true },
  ])

  const feed = useQuery({
    queryKey: auditKeys.feed(null),
    queryFn: ({ signal }) => recentAudit(null, CAP, signal),
    // Short, because this is the one screen somebody watches while something
    // is happening.
    staleTime: 5_000,
  })

  // The server answers an envelope now — rows, an exact total and exact facet
  // counts. The screen still narrows "refused" over the page it holds, which is
  // the smallest change that keeps it working; `feed.data.total` and
  // `facets.outcomes` are there when somebody comes to make it a server filter.
  const rows = useMemo(() => {
    const all = feed.data?.rows ?? []
    return only === "refused" ? all.filter((row) => row.status >= 400) : all
  }, [feed.data, only])

  /// How long the answer was, before the segment narrowed it.
  ///
  /// The truncation notice has to be asked of the FEED and not of `rows`:
  /// picking "Refused" throws most of the page away, and testing the remainder
  /// would take the notice down exactly when the reader is looking at a
  /// fraction of a capped page.
  const arrived = feed.data?.rows.length ?? 0

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: AuditEntry) => String(row.audit_id),
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, filters.columns, filters.columnFilters, query, sorting]
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
        <FilterPanel model={filters} table={table} />
        <Toolbar.Spacer />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          className="h-8 w-56"
        />
      </Toolbar>

      {/* Only when the answer came back exactly as long as the question. A
          shorter one proves the log had no more to give; this length proves
          nothing either way — and every clause above narrows these rows and no
          others. */}
      {arrived >= CAP && <Truncated limit={CAP} noun="actions" />}

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
