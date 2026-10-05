import { useInfiniteQuery } from "@tanstack/react-query"
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
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilterState, type Filter, type FilterField } from "@/lib/filters"
import { count, moment } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  auditKeys,
  auditPage,
  readAction,
  type AuditEntry,
  type AuditScope,
} from "@/lib/queries/audit"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"

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
/// **The question goes to the server.** The search, who acted, the method, the
/// refused/ok split and the order are all parameters `GET /api/v1/audit`
/// answers, and the log is walked with `next_cursor` as the table scrolls. It
/// used to ask for the newest five hundred actions and narrow them in the
/// browser under a banner; every count here is now the server's exact
/// `COUNT(*)` over the whole log — on an audit surface an approximate figure
/// is worse than none.
///
/// What the server cannot narrow is not offered: the "Did" wording is read out
/// of the path in the browser, and a chip on it would narrow only the loaded
/// rows.

/// Which column means which of the four orders the endpoint names. A column
/// not in here cannot be sorted — sorting it would sort the loaded pages and
/// call that the log.
const SORTS: Record<string, AuditScope["sort"]> = {
  at: "at",
  display_name: "actor",
  status: "status",
  path: "path",
}

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
    enableSorting: false,
    cell: ({ row }) => readAction(row.original),
  },
  {
    id: "subject",
    accessorFn: (row) => row.subject_kind ?? "",
    header: "To",
    size: 240,
    enableSorting: false,
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
      <span className="font-mono text-[0.875rem] text-mute">
        {row.original.method} {row.original.path}
      </span>
    ),
  },
]

/// The chips as the parameters the endpoint answers. One value each: the route
/// compares one column to one value, and both fields are `single`.
function scopeFromFilters(filters: readonly Filter[]): {
  actor?: string
  method?: string
} {
  const scope: { actor?: string; method?: string } = {}
  for (const { column, operator, values } of filters) {
    if (values.length === 0 || operator !== "isAnyOf") continue
    if (column === "actor") scope.actor = values[0]
    else if (column === "method") scope.method = values[0]
  }
  return scope
}

export function ActivityLog() {
  const [query, setQuery] = useState("")
  const [only, setOnly] = useState<"all" | "refused">("all")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "at", desc: true },
  ])

  const fields = useMemo<FilterField[]>(
    () => [
      {
        column: "actor",
        label: "Who",
        // A console has a dozen accounts, not a thousand, so the people who
        // appear here are a set somebody can read down — a pick rather than a
        // typed name they might spell the way the roster does.
        spec: { kind: "option", single: true, operators: ["isAnyOf"] },
      },
      {
        column: "method",
        label: "Method",
        spec: { kind: "option", single: true, operators: ["isAnyOf"] },
      },
    ],
    []
  )
  const filters = useFilterState(fields)

  // Debounced, because every keystroke is a query over the whole log.
  const needle = useDebounced(query.trim(), 400)
  const scope = useMemo<AuditScope>(() => {
    const by = sorting[0]
    const sort = by === undefined ? undefined : SORTS[by.id]
    return {
      ...scopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
      ...(only === "refused" ? { outcome: "REFUSED" as const } : {}),
      ...(sort === undefined ? {} : { sort, desc: by?.desc !== false }),
    }
  }, [filters.filters, needle, only, sorting])

  const feed = useInfiniteQuery({
    queryKey: auditKeys.feed(scope),
    queryFn: ({ pageParam, signal }) =>
      auditPage({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
    // Short, because this is the one screen somebody watches while something
    // is happening.
    staleTime: 5_000,
  })

  const rows = useMemo(
    () => feed.data?.pages.flatMap((page) => page.rows) ?? [],
    [feed.data]
  )
  /// The first page carries the exact total and facet counts; the pages after
  /// it are asked not to count.
  const head = feed.data?.pages[0]

  /// The same fields, carrying the server's exact tally over everything the
  /// search matches — not a count of the rows that happen to be loaded.
  const counted = useMemo<FilterField[]>(() => {
    const facets = head?.facets
    if (!facets) return fields
    const names = new Map<string, string>(
      facets.actors.map((one) => [one.value, one.label ?? one.value] as const)
    )
    return fields.map((field) =>
      field.column === "actor"
        ? {
            ...field,
            spec: {
              ...field.spec,
              counted: facets.actors,
              format: (value: string) => names.get(value) ?? value,
            },
          }
        : field.column === "method"
          ? { ...field, spec: { ...field.spec, counted: facets.methods } }
          : field
    )
  }, [fields, head])

  const refused = head?.facets?.outcomes.find(
    (one) => one.value === "REFUSED"
  )?.count

  const narrowed =
    needle !== "" || filters.filters.length > 0 || only === "refused"

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: AuditEntry) => String(row.audit_id),
        state: { sorting },
        // The rows arrive in the order the request asked for.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, sorting]
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
            {
              value: "refused",
              label:
                refused === undefined
                  ? "Refused"
                  : `Refused · ${count(refused)}`,
            },
          ]}
          value={only}
          onChange={setOnly}
        />
        <FilterPanel model={{ ...filters, fields: counted }} />
        <Toolbar.Spacer />
        {head?.total !== undefined && head.total !== null && (
          <span className="text-meta text-mute tabular-nums">
            {count(head.total)} actions
          </span>
        )}
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 w-56"
        />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(feed, {
          loading: "Reading the log…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {only === "refused" &&
                filters.filters.length === 0 &&
                needle === ""
                  ? "Nothing has been refused."
                  : narrowed
                    ? "No action matches what you asked for."
                    : "Nothing has been done yet."}
              </EmptyState>
            ) : (
              <DataTable<AuditEntry>
                table={table}
                more={feed}
                className="max-h-[calc(100vh-15rem)]"
              />
            ),
        })}
      </Card>
    </PageContent>
  )
}
