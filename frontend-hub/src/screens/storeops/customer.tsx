import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, Truncated } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count, money, moment } from "@/lib/format"
import {
  customerTransaction,
  customerTransactions,
  storeopsKeys,
} from "@/lib/queries/storeops"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import type { CustomerTransaction } from "@itulah/contract"

/// One member's own custom: what they bought, what promotions took off, and
/// what they earned for it.
///
/// The member is typed in rather than searched for, and that is the honest
/// description of where this stands: there is no customer identity in this
/// system and no search endpoint for one, so a member id is an argument this
/// screen is given. It is in the URL (`?member=…`) so the answer can be sent to
/// somebody, and the backend's own comment is worth repeating — a member id in
/// a path is an argument, not a credential, and nothing here treats it as one.
///
/// **These are the shops' sales, not the centre's.** The history is built from
/// `edge_sale`, the rows the shops reported over the sync lane, which is where
/// essentially every real sale in this business lives. The centre's own `sale`
/// table (what /storeops/sales lists) is a different set of records, so nothing
/// here links across to it: a receipt id from this list would not resolve there.
///
/// Paged by cursor rather than by offset, because history grows at the newest
/// end and an offset would show somebody a purchase twice.

const columns: ColumnDef<TableSetup, CustomerTransaction>[] = [
  {
    accessorKey: "occurred_at",
    header: "When",
    size: 170,
    /// "Between August and September" is what somebody asks a member's history
    /// — the only question on this screen that is not answered by reading down
    /// the first page.
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => moment(row.original.occurred_at),
  },
  {
    accessorKey: "site_id",
    header: "Store",
    size: 140,
    /// The shops THIS member has used, faceted off their own rows — these are
    /// the shops' own sale records, and the ids they carry are the ones the
    /// shops report, not the ones the centre spells.
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.site_id}</span>
    ),
  },
  {
    accessorKey: "item_count",
    header: "Items",
    size: 100,
    meta: { align: "right" },
    // Units, not lines: two of the same shirt reads as two items on a receipt
    // and should read as two here. Not filtered: basket size is read down the
    // column, never asked as a question.
    cell: ({ row }) => count(row.original.item_count),
  },
  {
    accessorKey: "discount_total_minor",
    header: "Saved",
    size: 140,
    /// "Saved at least something" is the promotions question, and it is the
    /// one this column exists for.
    ///
    /// **No `scale`, despite the `_minor` in the name.** `lib/format.ts` says
    /// it plainly — IDR has no minor unit in practice, so the server's "minor"
    /// is already whole rupiah and `money()` prints it undivided. A
    /// `scale: 100` would multiply every bound typed here by a hundred.
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    cell: ({ row }) =>
      row.original.discount_total_minor > 0 ? (
        <span className="text-ok-fg">
          {money(row.original.discount_total_minor)}
        </span>
      ) : (
        <span className="text-mute">—</span>
      ),
  },
  {
    accessorKey: "points_earned",
    header: "Points",
    size: 100,
    // Not filtered: points are earned in proportion to what was charged, so a
    // clause here is the Charged clause said less clearly.
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.points_earned),
  },
  {
    accessorKey: "total_minor",
    header: "Charged",
    size: 150,
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {money(row.original.total_minor)}
      </span>
    ),
  },
]

export function Member() {
  const member = useSheet("member")
  const receipt = useSheet("sale")
  const [typed, setTyped] = useState("")
  // Newest first is the server's own order and the one a counter reads in;
  // sorting is still offered because "what did they spend most on" is the other
  // question this list is opened for.
  const [sorting, setSorting] = useState<SortingState>([
    { id: "occurred_at", desc: true },
  ])

  const customerId = member.value ?? ""

  const history = useInfiniteQuery({
    queryKey: storeopsKeys.customerHistory(customerId),
    queryFn: ({ pageParam, signal }) =>
      customerTransactions(
        customerId,
        {
          limit: 25,
          beforeOccurredAt: pageParam?.at,
          beforeSaleId: pageParam?.id,
        },
        signal
      ),
    initialPageParam: undefined as { at: string; id: string } | undefined,
    getNextPageParam: (last) =>
      last.next_before_occurred_at !== null && last.next_before_sale_id !== null
        ? { at: last.next_before_occurred_at, id: last.next_before_sale_id }
        : undefined,
    enabled: customerId !== "",
  })

  const rows = useMemo(
    () => history.data?.pages.flatMap((page) => page.transactions) ?? [],
    [history.data]
  )

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: CustomerTransaction) => row.sale_id,
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  // Over what has been loaded, and labelled as such. The endpoint that adds a
  // member's whole custom up (`/customer/{id}/summary`) is not this module's,
  // so quoting these as lifetime totals would be a number that changes every
  // time somebody presses "Older".
  const loaded = rows.reduce(
    (sum, row) => ({
      spent: sum.spent + row.total_minor,
      saved: sum.saved + row.discount_total_minor,
      points: sum.points + row.points_earned,
      items: sum.items + row.item_count,
    }),
    { spent: 0, saved: 0, points: 0, items: 0 }
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Store ops"
        title="Member"
        sub="One member's purchases as the shops reported them, newest first."
        actions={
          <>
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && typed.trim() !== "") {
                  member.open(typed.trim())
                }
              }}
              placeholder="Member id"
              className="h-8 w-56 font-mono text-id"
            />
            <Button
              variant="soft"
              disabled={typed.trim() === ""}
              onClick={() => member.open(typed.trim())}
            >
              Look up
            </Button>
          </>
        }
      />

      {customerId === "" ? (
        <Card>
          <EmptyState>
            Type a member id above. There is no customer directory on this node
            to browse — a member is identified by the id their card carries, and
            an id here is an argument rather than a credential.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Banner tone="info" className="mb-[1.125rem]">
            Reading <span className="font-mono">{customerId}</span>. Points are
            what this member has <em>earned</em>, ever — not a balance:
            redemption happens at a till and the centre cannot see it yet.
          </Banner>

          <KpiStrip>
            <Kpi label="Purchases loaded" value={count(rows.length)} />
            <Kpi label="Items" value={count(loaded.items)} />
            <Kpi label="Charged" value={money(loaded.spent)} />
            <Kpi label="Promotions took off" value={money(loaded.saved)} />
            <Kpi label="Points earned" value={count(loaded.points)} />
            <Kpi
              label="Average basket"
              value={
                rows.length === 0
                  ? "—"
                  : money(Math.round(loaded.spent / rows.length))
              }
            />
          </KpiStrip>

          {/* Below the tiles rather than beside the title, deliberately: the
              six figures above are the fold of everything loaded and the
              clauses do not touch them, so the chips belong on the list's side
              of that line. */}
          <Toolbar>
            <FilterPanel model={filters} table={table} />
          </Toolbar>

          {/* A history is read a page at a time, and the filters — like the
              sort — only ever see the pages already fetched. While the server
              still has older purchases to give, a narrowed list here is a
              narrowing of what arrived, which is not the same answer. */}
          {history.hasNextPage && (
            <Truncated limit={rows.length} noun="purchases" />
          )}

          <Card className="overflow-hidden">
            {queryState(history, {
              loading: "Reading their history…",
              render: () =>
                rows.length === 0 ? (
                  <EmptyState>
                    That member holds a card and has not used it yet — no shop
                    has reported a purchase against this id.
                  </EmptyState>
                ) : (
                  <DataTable<CustomerTransaction>
                    table={table}
                    onRowClick={(row) => receipt.open(row.sale_id)}
                    isSelected={(row) => row.sale_id === receipt.value}
                    empty={
                      <>
                        None of the {count(rows.length)} purchases loaded match
                        the filters in force.
                      </>
                    }
                    className="max-h-[calc(100vh-22rem)]"
                  />
                ),
            })}
          </Card>

          {history.hasNextPage && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="ghost"
                disabled={history.isFetchingNextPage}
                onClick={() => history.fetchNextPage()}
              >
                {history.isFetchingNextPage ? "Reading…" : "Older purchases"}
              </Button>
            </div>
          )}
        </>
      )}

      <MemberReceiptSheet
        customerId={customerId}
        saleId={receipt.value ?? null}
        onClose={receipt.close}
      />
    </PageContent>
  )
}

/// One of their receipts.
///
/// Scoped by member as well as by sale, exactly as the server is: a sale id is
/// a uuid somebody could hold from a previous receipt, and a lookup by id alone
/// would hand out another shopper's basket to anyone who kept one.
function MemberReceiptSheet({
  customerId,
  saleId,
  onClose,
}: {
  customerId: string
  saleId: string | null
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: storeopsKeys.customerTransaction(customerId, saleId ?? ""),
    queryFn: ({ signal }) => customerTransaction(customerId, saleId!, signal),
    enabled: saleId !== null && customerId !== "",
  })

  return (
    <Sheet
      open={saleId !== null}
      subject={
        customerId === "" ? undefined : { kind: "customer", id: customerId }
      }
      onOpenChange={(open) => !open && onClose()}
      id={customerId}
      title={detail.data ? detail.data.sale.site_id : "Receipt"}
    >
      {queryState(detail, {
        loading: "Loading the receipt…",
        render: (record) => (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Store">{record.sale.site_id}</Fact>
              <Fact term="When">{moment(record.sale.occurred_at)}</Fact>
              <Fact term="Items">{count(record.sale.item_count)}</Fact>
              <Fact term="Points">{count(record.sale.points_earned)}</Fact>
            </Facts>

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                Basket
              </h4>
              <MiniTable head={["Item", "Qty", "Shelf price", "Charged"]}>
                {record.lines.map((line, index) => {
                  // The shelf-edge price times quantity, against what the line
                  // actually came to. A gap is a promotion, and it is the
                  // question asked at a counter with somebody waiting.
                  const shelf = line.unit_price_minor * line.quantity
                  return (
                    <tr
                      key={`${line.sku_code}-${index}`}
                      className="border-t border-hairline"
                    >
                      <td className="py-2 pr-2">
                        <span className="font-mono text-[0.71875rem] text-ink">
                          {line.sku_code}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(line.quantity)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {money(line.unit_price_minor)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        <span
                          className={
                            line.line_total_minor < shelf
                              ? "font-medium text-ok-fg"
                              : undefined
                          }
                        >
                          {money(line.line_total_minor)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </MiniTable>
            </div>

            {record.sale.discount_total_minor > 0 && (
              <div className="flex items-center gap-2">
                <Tag tone="ok">PROMOTION</Tag>
                <span className="text-meta text-body">
                  {money(record.sale.discount_total_minor)} came off this
                  basket.
                </span>
              </div>
            )}

            <TotalsLadder
              rows={[
                {
                  label: "Promotions took off",
                  value: money(record.sale.discount_total_minor),
                },
                {
                  label: "Points earned",
                  value: count(record.sale.points_earned),
                },
              ]}
              total={{
                label: "Charged",
                value: money(record.sale.total_minor),
              }}
            />
          </div>
        ),
      })}
    </Sheet>
  )
}
