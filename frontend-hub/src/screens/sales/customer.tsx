import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockPortal } from "@/components/shell/dock"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { DeskFilterButton } from "@/components/ui/desk-filter"
import { Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilterState, type Filter, type FilterField } from "@/lib/filters"
import { count, money, moment, sku } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  customerSummary,
  customerTransaction,
  customerTransactions,
  storeopsKeys,
  type CustomerHistoryScope,
} from "@/lib/queries/storeops"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  CardFigure,
  CardFoot,
  CardName,
  PhoneCard,
} from "@/components/ui/phone-cards"
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
///
/// **The narrowing goes to the server.** The date and amount chips are
/// parameters of the history endpoint, so a filtered list is the member's
/// whole matching history walked page by page — not a narrowing of whatever
/// had been scrolled in, which is what this screen used to say under a banner.
/// The order is newest first and is not offered as a choice: the endpoint's
/// cursor is built on it, and sorting the pages in hand would call a screenful
/// the history.

const columns: ColumnDef<TableSetup, CustomerTransaction>[] = [
  {
    accessorKey: "occurred_at",
    header: "When",
    size: 170,
    enableSorting: false,
    meta: { card: "hide" },
    cell: ({ row }) => moment(row.original.occurred_at),
  },
  {
    accessorKey: "site_id",
    header: "Store",
    size: 140,
    enableSorting: false,
    meta: { card: "hide" },
    /// The shop's own id, as the shops report it — not the one the centre
    /// spells.
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.site_id}</span>
    ),
  },
  {
    accessorKey: "item_count",
    header: "Items",
    size: 100,
    enableSorting: false,
    meta: { align: "right", card: "hide" },
    // Units, not lines: two of the same shirt reads as two items on a receipt
    // and should read as two here.
    cell: ({ row }) => count(row.original.item_count),
  },
  {
    accessorKey: "discount_total_minor",
    header: "Saved",
    size: 140,
    enableSorting: false,
    meta: { align: "right", card: "hide" },
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
    enableSorting: false,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => count(row.original.points_earned),
  },
  {
    accessorKey: "total_minor",
    header: "Charged",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {money(row.original.total_minor)}
      </span>
    ),
  },
  // Three columns that exist only on a card (`cardLead`; a phone): where and
  // when, what was charged as the figure, and the rest of the row — items,
  // points, what the promotions took off (owner, 2026-10-06). A tap opens the
  // receipt, as the row does.
  {
    id: "head",
    accessorFn: (row) => row.site_id,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <CardName
        name={row.original.site_id}
        line={moment(row.original.occurred_at)}
      />
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.total_minor,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <CardFigure value={money(row.original.total_minor)} caption="charged" />
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.item_count,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <CardFoot>
        {count(row.original.item_count)}{" "}
        {row.original.item_count === 1 ? "item" : "items"} ·{" "}
        {count(row.original.points_earned)} points
        {row.original.discount_total_minor > 0 && (
          <span className="text-ok-fg">
            {" "}
            · Saved {money(row.original.discount_total_minor)}
          </span>
        )}
      </CardFoot>
    ),
  },
]

/// The chips this history can carry — each a parameter the endpoint answers,
/// with its operators cut to what the request can hold.
///
/// **No `scale` on the money fields, despite the `_minor` in the names.**
/// `lib/format.ts` says it plainly — IDR has no minor unit in practice, so the
/// server's "minor" is already whole rupiah and a bound goes on the wire as
/// typed.
///
/// There is no Store chip: the server does not count a member's shops, and a
/// picker filled from the rows scrolled in so far would offer only those. The
/// Store column still reads it.
const MONEY_OPERATORS = ["gte", "lte", "between"] as const
const FIELDS: readonly FilterField[] = [
  {
    column: "occurred_at",
    label: "When",
    /// "Between August and September" is what somebody asks a member's
    /// history. Local business days — the server's boundary (WIB).
    spec: {
      kind: "date",
      single: true,
      operators: ["is", "onOrAfter", "onOrBefore", "between"],
    },
  },
  {
    column: "discount_total_minor",
    label: "Saved",
    /// "Saved at least something" is the promotions question.
    spec: {
      kind: "number",
      unit: "Rp",
      single: true,
      operators: MONEY_OPERATORS,
    },
  },
  {
    column: "total_minor",
    label: "Charged",
    spec: {
      kind: "number",
      unit: "Rp",
      single: true,
      operators: MONEY_OPERATORS,
    },
  },
]

/// The chips as the parameters the endpoint answers.
function scopeFromFilters(filters: readonly Filter[]): CustomerHistoryScope {
  const scope: {
    -readonly [K in keyof CustomerHistoryScope]: CustomerHistoryScope[K]
  } = {}
  const amount = (raw: string | undefined) => {
    const parsed = Number(raw)
    return raw === undefined || raw === "" || !Number.isFinite(parsed)
      ? undefined
      : Math.round(parsed)
  }
  /// A money clause as its two bounds, either of which may be absent.
  const bounds = (
    operator: string,
    values: readonly string[]
  ): { low?: number; high?: number } => {
    if (operator === "gte") return { low: amount(values[0]) }
    if (operator === "lte") return { high: amount(values[0]) }
    if (operator === "between") {
      const [a, b] = [amount(values[0]), amount(values[1])]
      if (a === undefined || b === undefined) return {}
      return { low: Math.min(a, b), high: Math.max(a, b) }
    }
    return {}
  }
  for (const { column, operator, values } of filters) {
    if (values.length === 0) continue
    const [first, second] = values
    if (column === "occurred_at") {
      if (operator === "is") {
        scope.from = first
        scope.to = first
      } else if (operator === "onOrAfter") scope.from = first
      else if (operator === "onOrBefore") scope.to = first
      else if (operator === "between" && second !== undefined) {
        scope.from = first <= second ? first : second
        scope.to = first <= second ? second : first
      }
    } else if (column === "total_minor") {
      const { low, high } = bounds(operator, values)
      scope.minTotal = low
      scope.maxTotal = high
    } else if (column === "discount_total_minor") {
      const { low, high } = bounds(operator, values)
      scope.minSaved = low
      scope.maxSaved = high
    }
  }
  return scope
}

export function Member() {
  // A phone keeps the card id and Look up in the drawer over the bottom bar and
  // reads the member as one card, then their purchases as cards.
  const phone = useLayout() === "phone"
  const member = useSheet("member")
  const receipt = useSheet("sale")
  const [typed, setTyped] = useState("")

  const customerId = member.value ?? ""

  const filters = useFilterState(FIELDS)
  const scope = useMemo(
    () => scopeFromFilters(filters.filters),
    [filters.filters]
  )

  const history = useInfiniteQuery({
    queryKey: storeopsKeys.customerHistory(customerId, scope),
    queryFn: ({ pageParam, signal }) =>
      customerTransactions(
        customerId,
        {
          ...scope,
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
    // The previous answer stays while a changed chip is asked about.
    placeholderData: (previous) => previous,
  })

  /// The member's whole custom, added up by the server — voided sales left
  /// out. The tiles quote these, never a sum of the pages scrolled in.
  const summary = useQuery({
    queryKey: storeopsKeys.customerSummary(customerId),
    queryFn: ({ signal }) => customerSummary(customerId, signal),
    enabled: customerId !== "",
  })

  const rows = useMemo(
    () => history.data?.pages.flatMap((page) => page.transactions) ?? [],
    [history.data]
  )

  const narrowed = filters.filters.length > 0

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: CustomerTransaction) => row.sale_id,
        // The rows arrive in the server's order, newest first.
        manualSorting: true,
        // The card's own columns are drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone, lead: phone, foot: phone } },
      }),
      [rows, phone]
    )
  )

  const totals = summary.data

  return (
    <PageContent>
      <PageHeader crumb="Sales" title="Member" />

      {/* The scope bar: which member, then what narrows their purchases. On a
          phone the card id is the dock's field and Look up its button. */}
      {!phone && (
        <>
          <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2">
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && typed.trim() !== "") {
                  member.open(typed.trim())
                }
              }}
              aria-label="Member card id"
              placeholder="Member card id"
              className="h-9 w-56 font-mono text-id"
            />
            <Button
              variant="soft"
              // The white look floats a bar's search and Filter to its start;
              // Look up stays against the card id it acts on.
              className="order-[-2]"
              disabled={typed.trim() === ""}
              onClick={() => member.open(typed.trim())}
            >
              Look up
            </Button>
            {customerId !== "" && <DeskFilterButton model={filters} />}
          </div>
        </>
      )}

      {/* The card id is the dock's field and Look up is its button, where the
          other lists have their plus. The ⚙ narrows the purchases. */}
      <DockTools
        search={{ value: typed, onChange: setTyped, label: "Member card id" }}
        filter={{
          count: filters.filters.length,
          panel: { model: filters },
        }}
      />
      <DockPortal slot="action">
        <button
          type="button"
          disabled={typed.trim() === ""}
          onClick={() => member.open(typed.trim())}
          className="dock-wide inline-flex h-9 w-full items-center justify-center rounded-full bg-cta px-4 text-[0.9375rem] font-semibold text-cta-fg shadow-soft transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.96] disabled:opacity-50"
        >
          Look up
        </button>
      </DockPortal>

      {customerId === "" ? (
        <Card>
          <EmptyState>
            Type a member id {phone ? "below" : "above"}. There is no customer
            directory on this node to browse — a member is identified by the id
            their card carries, and an id here is an argument rather than a
            credential.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Banner tone="info" className="mb-[1.125rem]">
            Reading <span className="font-mono">{customerId}</span>. Points are
            what this member has <em>earned</em>, ever — not a balance:
            redemption happens at a till and the centre cannot see it yet.
          </Banner>

          {/* All time, from the server — the chips below narrow the list and
              not these, which is why they sit above the chips. */}
          {phone ? (
            <ul className="mb-4">
              <PhoneCard
                head={<CardName name="Member" code={customerId} />}
                lead={
                  <CardFigure
                    value={
                      totals === undefined ? "—" : money(totals.spent_minor)
                    }
                    caption="charged, all time"
                  />
                }
                foot={
                  <CardFoot>
                    {totals === undefined
                      ? "—"
                      : `${count(totals.transaction_count)} purchases · ${count(totals.points_earned_total)} points earned`}
                    <br />
                    {totals === undefined
                      ? ""
                      : `Promotions took off ${money(totals.saved_minor)}${
                          totals.transaction_count === 0
                            ? ""
                            : ` · Average basket ${money(
                                Math.round(
                                  totals.spent_minor / totals.transaction_count
                                )
                              )}`
                        }`}
                  </CardFoot>
                }
              />
            </ul>
          ) : (
            <KpiStrip>
              <Kpi
                label="Purchases, all time"
                value={
                  totals === undefined ? "—" : count(totals.transaction_count)
                }
              />
              <Kpi
                label="Charged"
                value={totals === undefined ? "—" : money(totals.spent_minor)}
              />
              <Kpi
                label="Promotions took off"
                value={totals === undefined ? "—" : money(totals.saved_minor)}
              />
              <Kpi
                label="Points earned"
                value={
                  totals === undefined ? "—" : count(totals.points_earned_total)
                }
              />
              <Kpi
                label="Average basket"
                value={
                  totals === undefined || totals.transaction_count === 0
                    ? "—"
                    : money(
                        Math.round(
                          totals.spent_minor / totals.transaction_count
                        )
                      )
                }
              />
            </KpiStrip>
          )}

          <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            {queryState(history, {
              loading: "Reading their history…",
              render: () =>
                rows.length === 0 ? (
                  <EmptyState>
                    {narrowed
                      ? "None of this member's purchases match the filters in force."
                      : "That member holds a card and has not used it yet — no shop has reported a purchase against this id."}
                  </EmptyState>
                ) : (
                  <DataTable<CustomerTransaction>
                    refresh={[history]}
                    table={table}
                    onRowClick={(row) => receipt.open(row.sale_id)}
                    isSelected={(row) => row.sale_id === receipt.value}
                    more={history}
                    cardSort={false}
                    cardsApart
                    cardLead
                    className="max-h-[calc(100dvh-22rem)]"
                  />
                ),
            })}
          </Card>
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
              <MiniTable head={["Item", "Quantity", "Shelf Price", "Charged"]}>
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
                        <span className="font-mono text-[0.9375rem] text-ink">
                          {sku(line.sku_code)}
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
