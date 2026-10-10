import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilterState, type Filter, type FilterField } from "@/lib/filters"
import { count, money, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  listReturns,
  returnDetail,
  storeopsKeys,
  type ReturnRow,
  type ReturnScope,
} from "@/lib/queries/storeops"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import {
  CardFigure,
  CardFoot,
  CardName,
  Fig,
  Sentence,
} from "@/components/ui/phone-cards"

/// The refund desk: what went back over the counter and what it cost.
///
/// A return is its own document and never an edit of the sale it came from —
/// a finalized sale is immutable, so the shortfall between what was charged and
/// what came back is a fact the accounts keep rather than a number that gets
/// quietly reduced. That is why this is a list of its own rather than a column
/// on Sales.
///
/// Sorted by what was refunded, because the money leaving is the thing somebody
/// reads this list to check. The sale it was taken against is a click away in
/// the sheet rather than a column here, and it is a real link: a refund with no
/// route back to what was sold is the dead end DESIGN.md forbids.
///
/// **The question goes to the server.** This screen used to fetch the newest
/// 500 refunds and search, sort and filter them in the browser under a banner
/// admitting it. `GET /returns` already paged by cursor; the search, the order
/// and every chip below are its parameters now, and the list walks
/// `next_cursor` as it scrolls.

const columns: ColumnDef<TableSetup, ReturnRow>[] = [
  {
    accessorKey: "return_number",
    header: "Return",
    size: 200,
    // No filter: a document number is something you have in your hand, and
    // the search box beside the title already answers it.
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.return_number}
      </span>
    ),
  },
  {
    accessorKey: "site_id",
    header: "Store",
    size: 130,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.site_id}</span>
    ),
  },
  {
    accessorKey: "reason",
    header: "Reason",
    size: 260,
    // Prose somebody typed at a counter. The search box reads it; an order
    // over free text is not a question anybody asks.
    enableSorting: false,
    meta: { card: "hide" },
    cell: ({ row }) => <span className="text-text">{row.original.reason}</span>,
  },
  {
    accessorKey: "actor_id",
    header: "Taken by",
    size: 150,
    // Filtered, not sorted: the server has no order for it, and sorting the
    // pages in hand would call a screenful the list.
    enableSorting: false,
    meta: { card: "hide" },
  },
  {
    accessorKey: "created_at",
    header: "When",
    size: 160,
    meta: { card: "hide" },
    cell: ({ row }) => moment(row.original.created_at),
  },
  {
    accessorKey: "refund_total_minor",
    header: "Refunded",
    size: 140,
    // The decision metric: money going back out of the till.
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {money(row.original.refund_total_minor)}
      </span>
    ),
  },
  // Four columns that exist only on a card (`cardLead`; a phone): the store over
  // the return's number, what was refunded as the figure, when it was and who
  // rang it, and why it came back as the tag (owner, 2026-10-06).
  {
    id: "head",
    accessorFn: (row) => row.site_id,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <CardName name={row.original.site_id} code={row.original.return_number} />
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.refund_total_minor,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <CardFigure
        value={money(row.original.refund_total_minor)}
        caption="refunded"
      />
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.created_at,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <CardFoot>
        {moment(row.original.created_at)} · {row.original.actor_id}
      </CardFoot>
    ),
  },
  {
    id: "tag",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) =>
      row.original.reason === "" ? null : (
        <Pill
          className="block max-w-[9rem] truncate"
          title={row.original.reason}
        >
          {row.original.reason}
        </Pill>
      ),
  },
]

/// Which column means which of the four orders `GET /returns` names. A column
/// not in here is `enableSorting: false` on its definition.
const SORTS: Record<string, NonNullable<ReturnScope["sort"]>> = {
  return_number: "number",
  site_id: "site",
  created_at: "at",
  refund_total_minor: "refund",
}

/// The chips this list can carry, and only those: each is a parameter the
/// endpoint answers, with its operators cut to what the request can hold.
const FIELDS: readonly FilterField[] = [
  {
    column: "site_id",
    label: "Store",
    /// Counted by the server over the refunds themselves, which is the only
    /// spelling that can match them: the centre and the box standing in a
    /// place do not always agree on its name — the warehouse is `ho` to the
    /// centre and `dc-01` to its own edge node.
    spec: { kind: "option", single: true, operators: ["isAnyOf"] },
  },
  {
    column: "actor_id",
    label: "Taken by",
    /// A closed set in practice — the people standing at the counters — and
    /// "who refunded this" is the question a supervisor opens this list with.
    spec: { kind: "option", single: true, operators: ["isAnyOf"] },
  },
  {
    column: "created_at",
    label: "When",
    /// Local business days, the server's boundary (WIB), not the browser's.
    spec: {
      kind: "date",
      single: true,
      operators: ["is", "onOrAfter", "onOrBefore", "between"],
    },
  },
  {
    column: "refund_total_minor",
    label: "Refunded",
    /// **No `scale`, despite the `_minor` in the name.** `lib/format.ts` says
    /// it plainly — IDR has no minor unit in practice, so the server's "minor"
    /// is already whole rupiah and the bound goes on the wire as typed.
    spec: {
      kind: "number",
      unit: "Rp",
      single: true,
      operators: ["gte", "lte", "between"],
    },
  },
]

/// The chips as the parameters the endpoint answers.
function scopeFromFilters(filters: readonly Filter[]): ReturnScope {
  const scope: { -readonly [K in keyof ReturnScope]: ReturnScope[K] } = {}
  const amount = (raw: string | undefined) => {
    const parsed = Number(raw)
    return raw === undefined || raw === "" || !Number.isFinite(parsed)
      ? undefined
      : Math.round(parsed)
  }
  for (const { column, operator, values } of filters) {
    if (values.length === 0) continue
    const [first, second] = values
    if (column === "site_id" && operator === "isAnyOf") scope.siteId = first
    else if (column === "actor_id" && operator === "isAnyOf")
      scope.actorId = first
    else if (column === "created_at") {
      if (operator === "is") {
        scope.from = first
        scope.to = first
      } else if (operator === "onOrAfter") scope.from = first
      else if (operator === "onOrBefore") scope.to = first
      else if (operator === "between" && second !== undefined) {
        // Either order: a range typed backwards still means the same days.
        scope.from = first <= second ? first : second
        scope.to = first <= second ? second : first
      }
    } else if (column === "refund_total_minor") {
      if (operator === "gte") scope.minRefund = amount(first)
      else if (operator === "lte") scope.maxRefund = amount(first)
      else if (operator === "between") {
        const [low, high] = [amount(first), amount(second)]
        if (low !== undefined && high !== undefined) {
          scope.minRefund = Math.min(low, high)
          scope.maxRefund = Math.max(low, high)
        }
      }
    }
  }
  return scope
}

/// A page the size the server defaults to. The table virtualises past 150.
const PAGE = 100

export function Returns() {
  // A phone draws the rows as cards and keeps the search and the filters in the
  // drawer over the bottom bar (`DockTools`).
  const phone = useLayout() === "phone"
  const [query, setQuery] = useState("")
  const refund = useSheet("refund")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "refund_total_minor", desc: true },
  ])

  const filters = useFilterState(FIELDS)

  // Debounced, because every keystroke is a query over every refund.
  const needle = useDebounced(query.trim(), 400)
  const scope = useMemo<ReturnScope>(() => {
    const by = sorting[0]
    const sort = by === undefined ? undefined : SORTS[by.id]
    return {
      ...scopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
      ...(sort === undefined
        ? {}
        : {
            sort,
            dir: by?.desc === false ? ("asc" as const) : ("desc" as const),
          }),
      limit: PAGE,
    }
  }, [filters.filters, needle, sorting])

  const returns = useInfiniteQuery({
    queryKey: storeopsKeys.returnsPage(scope),
    queryFn: ({ pageParam, signal }) =>
      listReturns({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // The previous answer stays while the next is fetched, so a keystroke
    // does not empty the table to a loading line.
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => returns.data?.pages.flatMap((page) => page.rows) ?? [],
    [returns.data]
  )
  /// Every page carries the whole matched set's total and facets; the first
  /// is read so they do not flicker while the next page lands.
  const head = returns.data?.pages[0]

  /// The same fields, carrying the server's tally over everything the search
  /// matches — never a count of the rows that happen to be loaded.
  const counted = useMemo<FilterField[]>(() => {
    const facets = head?.facets
    if (!facets) return [...FIELDS]
    return FIELDS.map((field) =>
      field.column === "site_id"
        ? { ...field, spec: { ...field.spec, counted: facets.sites } }
        : field.column === "actor_id"
          ? { ...field, spec: { ...field.spec, counted: facets.actors } }
          : field
    )
  }, [head])

  const narrowed = needle !== "" || filters.filters.length > 0

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: ReturnRow) => row.id,
        state: {
          sorting,
          // The card's own columns are drawn on a phone and never on a desk.
          columnVisibility: {
            head: phone,
            lead: phone,
            foot: phone,
            tag: phone,
          },
        },
        // The rows arrive in the order the request asked for.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, sorting, phone]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Sales"
        title="Returns"
        sub="What came back over the counter, what it was refunded with, and whether it went back on the floor."
        actions={
          phone ? undefined : (
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 w-56"
            />
          )
        }
      />

      {!phone && (
        <Toolbar>
          <FilterPanel model={{ ...filters, fields: counted }} />
        </Toolbar>
      )}

      {/* The server's figures over everything the search and the chips match,
          whatever has been scrolled into view. */}
      {head !== undefined &&
        (phone ? (
          <Sentence>
            <Fig>{count(head.total)}</Fig>{" "}
            {head.total === 1 ? "return" : "returns"},{" "}
            <Fig>{money(head.refund_total_minor)}</Fig> refunded.
          </Sentence>
        ) : (
          <KpiStrip>
            <Kpi label="Returns" value={count(head.total)} />
            <Kpi label="Refunded" value={money(head.refund_total_minor)} />
          </KpiStrip>
        ))}

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(returns, {
          loading: "Loading the returns…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {narrowed
                  ? "No return matches this search and the filters in force."
                  : "Nothing has been taken back yet. A return is raised against a completed sale, from that sale's own record."}
              </EmptyState>
            ) : (
              <DataTable<ReturnRow>
                refresh={[returns]}
                table={table}
                onRowClick={(row) => refund.open(row.id)}
                isSelected={(row) => row.id === refund.value}
                more={returns}
                cardSort={false}
                cardsApart
                cardLead
                className="max-h-[calc(100dvh-20rem)]"
              />
            ),
        })}
      </Card>

      {/* On a phone the search, the filters and the sort live in the drawer
          over the bottom bar, not at the top of the list. */}
      <DockTools
        search={{ value: query, onChange: setQuery, label: "Search Returns" }}
        filter={{
          count: filters.filters.length,
          panel: {
            model: filters,
            filterModel: { ...filters, fields: counted },
            table,
          },
        }}
        sort={dockSortOf(table)}
      />

      <ReturnSheet id={refund.value ?? null} onClose={refund.close} />
    </PageContent>
  )
}

/// One return document: what came back, where it went, and how the money was
/// handed over.
function ReturnSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: storeopsKeys.saleReturn(id ?? ""),
    queryFn: ({ signal }) => returnDetail(id!, signal),
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "return", id }}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.return_number}
      title={detail.data?.site_id ?? "Return"}
    >
      {queryState(detail, {
        loading: "Loading the return…",
        render: (record) => (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Store">{record.site_id}</Fact>
              <Fact term="Taken by">{record.actor_id}</Fact>
              <Fact term="When">{moment(record.created_at)}</Fact>
              <Fact term="Against">
                {/* The crossing DESIGN.md asks for: a refund is always about a
                    sale, and this opens that sale's own record rather than
                    restating it here. */}
                <AppLink
                  to="/sales"
                  sheet={{ key: "sale", value: record.sale_id }}
                  className="font-mono text-id text-accent hover:underline"
                >
                  {record.sale_number}
                </AppLink>
              </Fact>
            </Facts>

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                Why
              </h4>
              <p className="text-meta text-text">{record.reason}</p>
            </div>

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                What came back
              </h4>
              <MiniTable head={["Item", "Went to", "Quantity", "Refund"]}>
                {record.lines.map((line) => (
                  <tr key={line.id} className="border-t border-hairline">
                    <td className="py-2 pr-2">
                      <span className="block text-[0.875rem] text-ink">
                        {line.article_name}
                      </span>
                      <span className="font-mono text-[0.875rem] text-mute">
                        {line.sku_code}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      {/* Not a note: `restock` decides which pool the garment
                          moved into, so it is the difference between stock the
                          shop can sell again and stock it cannot. */}
                      <Tag tone={line.restock ? "ok" : "warn"}>
                        {line.restock ? "FLOOR" : "REJECT"}
                      </Tag>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {count(line.quantity)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {money(line.refund_minor)}
                    </td>
                  </tr>
                ))}
              </MiniTable>
            </div>

            {record.refunds.length > 0 && (
              <div>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Refunded with
                </h4>
                <MiniTable head={["Method", "Reference", "Amount"]}>
                  {record.refunds.map((entry, index) => (
                    <tr
                      key={`${entry.method}-${index}`}
                      className="border-t border-hairline"
                    >
                      <td className="py-2 pr-2">
                        <Tag>{entry.method}</Tag>
                      </td>
                      <td className="py-2 text-right text-[0.875rem] text-mute">
                        {entry.reference ?? "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {money(entry.amount_minor)}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              </div>
            )}

            <TotalsLadder
              rows={[
                { label: "Lines returned", value: count(record.lines.length) },
                {
                  label: "Back on the floor",
                  value: count(
                    record.lines.filter((line) => line.restock).length
                  ),
                },
                {
                  label: "To the reject pool",
                  value: count(
                    record.lines.filter((line) => !line.restock).length
                  ),
                },
              ]}
              total={{
                label: "Refunded",
                value: money(record.refund_total_minor),
              }}
            />
          </div>
        ),
      })}
    </Sheet>
  )
}
