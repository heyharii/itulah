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

/// The Ops record of what happened, the prototype's activity log made live:
/// one table over the cloud's audit feed — time, who, what, on which document
/// — with each row sorted into the flow it belongs to.
///
/// The log belongs to the cloud. The middleware that writes it stands behind
/// the cloud's own routes, so the floor's work on this warehouse's edge node
/// — a count, a tagging job — never passes it and never appears here. What
/// does appear is everything Ops reaches for on the centre side: the order
/// book, the allotments the outbox is cut from, the returns.
///
/// The flow is read out of the path in the browser. The endpoint has no flow
/// parameter, so the tabs narrow what has loaded; the server still narrows
/// the search, the person, the method and the refused/ok split, and the table
/// walks `next_cursor` as it scrolls.
///
/// Refusals stay in the table. A log that only kept what succeeded would
/// quietly lose "who kept trying".

/// Which flow a request belongs to, read from the path the cloud recorded.
///
/// The prefixes are the route table's own (`cloud/http/mod.rs`), not the
/// shapes they seem to have: the Allotment board is cut from allotments under
/// `/inventory/allotments`, and raising an excess return lives under the
/// order it came from — `POST /purchase-orders/{id}/returns` — so that test
/// runs before the purchase-order one, with the return book
/// (`/purchase-returns`) and the supplier side (`/supplier-returns`).
///
/// The edge's purchase family (`dc/goods-receipts`, `dc/purchase-counts`,
/// `dc/purchase-verifications`) is named for completeness: the cloud log
/// rarely holds those rows, but a classifier that would call one "Other" if
/// it ever saw one would be lying about the flow it came from.
type Flow = "PO receiving" | "Allotment" | "Return to supplier" | "Other"

const FLOWS = [
  "All",
  "PO receiving",
  "Allotment",
  "Return to supplier",
] as const
type FlowTab = (typeof FLOWS)[number]

function flowOf(entry: AuditEntry): Flow {
  const parts = entry.path.replace(/^\/api\/v1\//, "").split("/")
  if (parts[0] === "purchase-orders" && parts[2] === "returns")
    return "Return to supplier"
  if (parts[0] === "purchase-returns" || parts[0] === "supplier-returns")
    return "Return to supplier"
  if (parts[0] === "inventory" && parts[1] === "allotments") return "Allotment"
  if (
    parts[0] === "purchase-orders" ||
    parts[0] === "purchase-order-lines" ||
    parts[0] === "purchase-price-amendments" ||
    parts[0] === "purchase-destinations" ||
    (parts[0] === "dc" &&
      (parts[1] === "goods-receipts" ||
        parts[1] === "purchase-counts" ||
        parts[1] === "purchase-verifications"))
  )
    return "PO receiving"
  return "Other"
}

/// Trailing segments that name an act rather than a record — the same verbs
/// `readAction` knows, plus the action words the route table appends
/// (`settlements`, `returns`, `redeem`). Only consulted when nothing was
/// filed as the subject.
const ACTS: Record<string, true> = {
  returns: true,
  settlements: true,
  "close-short": true,
  cancel: true,
  activate: true,
  deactivate: true,
  execute: true,
  decide: true,
  approve: true,
  submit: true,
  publish: true,
  acknowledge: true,
  redeem: true,
  void: true,
  confirm: true,
  revoke: true,
  renew: true,
  found: true,
  lost: true,
  dispose: true,
}

/// The record a row was filed against. Only writes are recorded (`is_write`
/// in `cloud/http/audit.rs`), and the middleware files the record the route
/// acted on as the subject — from the path's own id when it has one, else
/// what the handler declared. So: the id in the path; else the filed
/// subject, whether that is a created record's uuid or a code the route
/// names (`/vouchers/{code}`); else a code left as the trailing segment.
function documentOf(entry: AuditEntry): string | null {
  const parts = entry.path.replace(/^\/api\/v1\//, "").split("/")
  const isId = (part: string) => /^[0-9a-f-]{20,}$/i.test(part)
  const lastId = parts.map(isId).lastIndexOf(true)
  if (lastId >= 0) return parts[lastId]
  if (entry.subject_id !== null) return entry.subject_id
  // Nothing was filed: a trailing act is the verb, not the record, and a
  // bare collection has no document at all.
  const last = parts[parts.length - 1] ?? ""
  if (parts.length > 1 && !ACTS[last]) return last
  return null
}

/// Which column means which of the orders the endpoint names. A column not
/// in here cannot be sorted — sorting it would sort the loaded pages and
/// call that the log. The path column the System log sorts is not shown
/// here, so it is not offered.
const SORTS: Record<string, AuditScope["sort"]> = {
  at: "at",
  display_name: "actor",
  status: "status",
}

const columns: ColumnDef<TableSetup, AuditEntry>[] = [
  {
    accessorKey: "at",
    header: "Time",
    size: 150,
    cell: ({ row }) => (
      <span className="text-body tabular-nums">{moment(row.original.at)}</span>
    ),
  },
  {
    accessorKey: "display_name",
    header: "Actor",
    size: 170,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.display_name}</span>
    ),
  },
  {
    id: "action",
    accessorFn: (row) => readAction(row),
    header: "Activity",
    size: 130,
    enableSorting: false,
    cell: ({ row }) => readAction(row.original),
  },
  {
    id: "document",
    accessorFn: (row) => documentOf(row) ?? "",
    header: "Document",
    size: 300,
    enableSorting: false,
    cell: ({ row }) => {
      const doc = documentOf(row.original)
      return doc === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="truncate font-mono text-id text-body">{doc}</span>
      )
    },
  },
  {
    id: "flow",
    accessorFn: (row) => flowOf(row),
    header: "Flow",
    size: 170,
    enableSorting: false,
    cell: ({ row }) => <Tag>{flowOf(row.original)}</Tag>,
  },
  {
    accessorKey: "status",
    header: "Answer",
    size: 110,
    // The code itself, not a word for it: this is the column that tells a
    // 403 from a 409 — somebody who may not do a thing from somebody who
    // may and was too late.
    cell: ({ row }) => (
      <Pill tone={row.original.status >= 400 ? "bad" : "ok"}>
        {row.original.status}
      </Pill>
    ),
  },
]

/// The chips as the parameters the endpoint answers. One value each: the
/// route compares one column to one value, and both fields are `single`.
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

export function OpsActivityLog() {
  const [flow, setFlow] = useState<FlowTab>("All")
  const [query, setQuery] = useState("")
  const [only, setOnly] = useState<"all" | "refused">("all")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "at", desc: true },
  ])

  const fields = useMemo<FilterField[]>(
    () => [
      {
        column: "actor",
        label: "Actor",
        // A console has a dozen accounts, not a thousand, so the people who
        // appear here are a set somebody can read down — a pick rather than
        // a typed name they might spell the way the roster does.
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

  // The flow is the one thing the server is not asked for, so it narrows
  // what has loaded — which is why the tab row says so.
  const visible = useMemo(
    () => (flow === "All" ? rows : rows.filter((one) => flowOf(one) === flow)),
    [rows, flow]
  )

  /// The first page carries the exact total and facet counts; the pages
  /// after it are asked not to count.
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
    needle !== "" ||
    filters.filters.length > 0 ||
    only === "refused" ||
    flow !== "All"

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: visible,
        columns,
        getRowId: (row: AuditEntry) => String(row.audit_id),
        state: { sorting },
        // The rows arrive in the order the request asked for.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [visible, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Operations"
        title="Activity Log"
        sub="What the centre recorded, newest first, sorted into the flows Ops runs. Work done on this warehouse's edge node never passes the cloud, so floor actions do not appear here."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          options={FLOWS.map((one) => ({ value: one, label: one }))}
          value={flow}
          onChange={setFlow}
        />
        {flow !== "All" && (
          <span className="text-meta text-mute">
            Flow is grouped from what loaded
          </span>
        )}
      </div>

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
            visible.length === 0 ? (
              <EmptyState>
                {only === "refused" &&
                filters.filters.length === 0 &&
                needle === "" &&
                flow === "All"
                  ? "Nothing has been refused."
                  : narrowed
                    ? "No action matches what you asked for."
                    : "Nothing has been done yet."}
              </EmptyState>
            ) : (
              <DataTable<AuditEntry>
                table={table}
                more={feed}
                className="max-h-[calc(100vh-19rem)]"
              />
            ),
        })}
      </Card>
    </PageContent>
  )
}
