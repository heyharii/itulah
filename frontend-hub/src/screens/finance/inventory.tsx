import { useSuspenseQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { GroupHeading } from "@/components/ui/phone-cards"
import { CellMoney } from "@/components/ui/rows-switch"
import { EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, day, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  inventoryValuationQuery,
  stockVsLedgerQuery,
  type AwaitingSetupRow,
  type InventoryValuationRow,
  type StockLedgerUnitRow,
} from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Code } from "@/screens/finance-final/parts"
import { PhoneChoice, SiteName, SupplierName } from "@/screens/finance/parts"
import { useColumnFit } from "@/screens/finance/column-fit"
import { ScreenPending } from "@/screens/finance/pending"

/// Finance › Inventory. One article is bought once, so what a piece is worth
/// is the price on its PO / receipt; value = quantity × that cost.

const sum = <T,>(rows: readonly T[], pick: (row: T) => number) =>
  rows.reduce((total, row) => total + pick(row), 0)

/// The units a figure can be read for: head office first, then each shop by
/// its code. Closed units are not offered.
function useUnitChoices() {
  const units = useUnits()
  return useMemo(() => {
    const list = (units.data ?? [])
      .filter((unit) => unit.status !== "CLOSED")
      .sort((a, b) => {
        if (a.kind === "HO" && b.kind !== "HO") return -1
        if (b.kind === "HO" && a.kind !== "HO") return 1
        return a.code.localeCompare(b.code)
      })
    const choices: { id: string | null; name: string; code: string | null }[] =
      [
        { id: null, name: "All units", code: null },
        ...list.map((unit) => ({
          id: unit.id,
          name: unit.name,
          code: unit.code,
        })),
      ]
    return choices
  }, [units.data])
}

/// The unit picker, for the bar: one select, the unit's name and code.
export function UnitPick({
  value,
  onChange,
}: {
  value: string | null
  onChange: (id: string | null) => void
}) {
  const choices = useUnitChoices()
  return (
    <Select
      value={value ?? ""}
      onChange={(next) => onChange(next === "" ? null : next)}
      className="h-control w-56"
      aria-label="Unit"
    >
      {choices.map((choice) => (
        <option key={choice.id ?? "all"} value={choice.id ?? ""}>
          {choice.code === null
            ? choice.name
            : `${choice.name} · ${choice.code}`}
        </option>
      ))}
    </Select>
  )
}

/// The same choice on a phone: a chip in the dock and the sheet it opens.
export function UnitDock({
  value,
  onChange,
}: {
  value: string | null
  onChange: (id: string | null) => void
}) {
  const choices = useUnitChoices()
  return (
    <PhoneChoice
      title="Unit"
      value={value ?? ""}
      onChange={(next) => onChange(next === "" ? null : next)}
      options={choices.map((choice) => ({
        value: choice.id ?? "",
        label:
          choice.code === null
            ? choice.name
            : `${choice.name} · ${choice.code}`,
        short: choice.name,
      }))}
    />
  )
}

type ArticleRow = InventoryValuationRow
interface SiteRow {
  readonly id: string
  readonly name: string
  readonly transit: boolean
  readonly pieces: number
  readonly value: number
}

const articleKey = (row: ArticleRow) =>
  `${row.site_id}-${row.in_transit}-${row.article_code}`

/// One article at one site per row. On a phone the same columns are the card:
/// the article over its code, then what it is worth and how.
const articleColumns: ColumnDef<TableSetup, ArticleRow>[] = [
  {
    id: "article",
    accessorFn: (row) => `${row.article_name} ${row.article_code}`,
    header: "Article",
    size: 300,
    meta: { card: "title", grow: 240 },
    cell: ({ row }) => (
      <span className="flex flex-col whitespace-normal">
        <Code>{row.original.article_code}</Code>
        <span className="text-ink">{row.original.article_name}</span>
      </span>
    ),
  },
  {
    id: "division",
    accessorFn: (row) => row.division_code ?? "",
    header: "Division",
    size: 160,
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) => (
      <span className="text-mute">{row.original.division_code ?? "—"}</span>
    ),
  },
  {
    accessorKey: "quantity",
    header: "Quantity",
    size: 110,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => count(row.original.quantity),
  },
  {
    accessorKey: "unit_cost_minor",
    header: "Unit cost",
    size: 150,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) =>
      row.original.cost_source === "NONE" ? (
        "—"
      ) : (
        <CellMoney minor={row.original.unit_cost_minor} />
      ),
  },
  {
    accessorKey: "value_minor",
    header: "Value",
    size: 160,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => <CellMoney minor={row.original.value_minor} />,
  },
  {
    id: "po",
    accessorFn: (row) => row.po_numbers ?? "",
    header: "PO",
    size: 220,
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) => (
      <span className="whitespace-normal">
        <span>{row.original.po_numbers ?? "—"}</span>
        {row.original.po_count > 1 && (
          <span className="ml-2 text-[0.9375rem] text-mute">
            avg of {row.original.po_count} POs
          </span>
        )}
        {row.original.in_transit && (
          <span className="ml-2 text-[0.9375rem] text-mute">in transit</span>
        )}
      </span>
    ),
  },
]

const siteColumns: ColumnDef<TableSetup, SiteRow>[] = [
  {
    id: "site",
    accessorFn: (row) => row.name,
    header: "Site",
    size: 360,
    meta: { card: "title", grow: 240 },
    cell: ({ row }) =>
      row.original.transit ? (
        <>
          {row.original.name}
          <span className="ml-2 text-[0.9375rem] font-normal text-mute">
            in transit
          </span>
        </>
      ) : (
        <SiteName id={row.original.id} />
      ),
  },
  {
    accessorKey: "pieces",
    header: "Pcs",
    size: 150,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => count(row.original.pieces),
  },
  {
    accessorKey: "value",
    header: "Value",
    size: 200,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => <CellMoney minor={row.original.value} />,
  },
]

const awaitingColumns: ColumnDef<TableSetup, AwaitingSetupRow>[] = [
  {
    accessorKey: "receipt_number",
    header: "Receipt",
    size: 190,
    meta: { card: "meta" },
    cell: ({ row }) => <Code>{row.original.receipt_number}</Code>,
  },
  {
    id: "po",
    accessorFn: (row) => row.po_number ?? "",
    header: "PO",
    size: 150,
    meta: { card: "meta" },
    cell: ({ row }) => row.original.po_number ?? "—",
  },
  {
    id: "supplier",
    accessorFn: (row) => row.supplier_id ?? "",
    header: "Supplier",
    size: 260,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => <SupplierName id={row.original.supplier_id} />,
  },
  {
    id: "received",
    accessorFn: (row) => row.received_on ?? "",
    header: "Received",
    size: 130,
    meta: { card: "meta" },
    cell: ({ row }) =>
      row.original.received_on === null ? "—" : day(row.original.received_on),
  },
  {
    accessorKey: "lines",
    header: "Lines",
    size: 90,
    meta: { align: "right", card: "metric", priority: 2 },
    cell: ({ row }) => count(row.original.lines),
  },
  {
    accessorKey: "quantity",
    header: "Quantity",
    size: 110,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => count(row.original.quantity),
  },
  {
    accessorKey: "value_minor",
    header: "Value",
    size: 160,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => <CellMoney minor={row.original.value_minor} />,
  },
]

export function InventoryValuationScreen() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Inventory"
          title="Inventory Valuation"
          className="max-md:hidden"
        >
          Reading the stock…
        </ScreenPending>
      }
    >
      <InventoryValuation />
    </Suspense>
  )
}

function InventoryValuation() {
  const [unit, setUnit] = useState<string | null>(null)
  const [tab, setTab] = useState("article")
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])

  // The unit select answers at once; the valuation trails it, and the figures
  // in hand stay on screen until the next are read.
  const valuation = useSuspenseQuery(
    inventoryValuationQuery(useDeferredValue(unit))
  )

  const data = valuation.data
  const onHand = useMemo(
    () => (data?.rows ?? []).filter((row) => !row.in_transit),
    [data]
  )
  const transit = useMemo(
    () => (data?.rows ?? []).filter((row) => row.in_transit),
    [data]
  )
  const awaiting = useMemo(() => data?.awaiting_setup ?? [], [data])
  const onHandValue = sum(onHand, (row) => row.value_minor)
  const transitValue = sum(transit, (row) => row.value_minor)
  const awaitingValue = sum(awaiting, (row) => row.value_minor)

  /// What is on hand first, then what is on the road, each by what it is worth.
  const articles = useMemo(() => {
    const q = needle.trim().toLowerCase()
    const pick = (rows: InventoryValuationRow[]) =>
      rows
        .filter(
          (row) =>
            q === "" ||
            row.article_code.toLowerCase().includes(q) ||
            row.article_name.toLowerCase().includes(q) ||
            (row.po_numbers ?? "").toLowerCase().includes(q)
        )
        .sort((a, b) => b.value_minor - a.value_minor)
    return [...pick(onHand), ...pick(transit)]
  }, [onHand, transit, needle])

  const sites = useMemo(() => {
    const map = new Map<string, SiteRow>()
    for (const row of data?.rows ?? []) {
      const key = `${row.site_id}:${row.in_transit}`
      const one = map.get(key) ?? {
        id: row.site_id,
        name: row.site_name,
        transit: row.in_transit,
        pieces: 0,
        value: 0,
      }
      map.set(key, {
        ...one,
        pieces: one.pieces + row.quantity,
        value: one.value + row.value_minor,
      })
    }
    return [...map.values()].sort((a, b) => b.value - a.value)
  }, [data])

  const phone = useLayout() === "phone"
  const [articleMeasure, articleFit] = useColumnFit(articleColumns, phone)
  const [siteMeasure, siteFit] = useColumnFit(siteColumns, phone)
  const [awaitingMeasure, awaitingFit] = useColumnFit(awaitingColumns, phone)
  const articleTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: articles,
        columns: articleColumns,
        getRowId: articleKey,
        state: {
          sorting,
          columnVisibility: articleFit.visibility,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: articleFit.onChange,
      }),
      // The fits are new each render: the room is measured, and the columns
      // the card has no room for are given up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [articles, sorting, phone, articleFit]
    )
  )
  const siteTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: sites,
        columns: siteColumns,
        getRowId: (row: SiteRow) => `${row.id}:${row.transit}`,
        state: {
          sorting,
          columnVisibility: siteFit.visibility,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: siteFit.onChange,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [sites, sorting, phone, siteFit]
    )
  )
  const awaitingTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: awaiting,
        columns: awaitingColumns,
        getRowId: (row: AwaitingSetupRow) => row.receipt_number,
        state: {
          sorting,
          columnVisibility: awaitingFit.visibility,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: awaitingFit.onChange,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [awaiting, sorting, phone, awaitingFit]
    )
  )
  const table =
    tab === "article"
      ? articleTable
      : tab === "site"
        ? siteTable
        : awaitingTable
  const measure =
    tab === "article"
      ? articleMeasure
      : tab === "site"
        ? siteMeasure
        : awaitingMeasure

  const changeTab = (next: string) => {
    setTab(next)
    setSorting([])
  }

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Inventory"
        title="Inventory Valuation"
      />
      <>
        <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
          <Kpi label="Stock on hand" value={money(onHandValue)} />
          <Kpi label="In transit" value={money(transitValue)} />
          <Kpi label="Awaiting setup" value={money(awaitingValue)} />
          <Kpi
            label="Inventory value"
            value={money(onHandValue + transitValue + awaitingValue)}
          />
        </KpiStrip>

        <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
          <SubTabs
            // The three views are the status button in the dock on a phone.
            className="max-md:hidden"
            tabs={[
              { value: "article", label: "By article" },
              { value: "site", label: "By site" },
              { value: "awaiting", label: "Awaiting setup" },
            ]}
            value={tab}
            onChange={changeTab}
          />
          {tab === "article" && (
            <ExpandingSearch
              value={needle}
              onChange={setNeedle}
              label="Search articles"
            />
          )}
          <UnitPick value={unit} onChange={setUnit} />
          <BarSpacer />
          <ColumnsMenu table={table} />
        </div>

        <UnitDock value={unit} onChange={setUnit} />
        <DockTools
          search={
            tab === "article"
              ? {
                  value: needle,
                  onChange: setNeedle,
                  label: "Search articles",
                }
              : undefined
          }
          sort={dockSortOf(table)}
          status={{
            value: tab,
            options: [
              { value: "article", label: "By article" },
              { value: "site", label: "By site" },
              { value: "awaiting", label: "Awaiting setup" },
            ],
            onChange: changeTab,
          }}
        />

        {tab === "article" ? (
          articles.length === 0 ? (
            <EmptyState>
              {needle.trim() === "" ? "No stock to value." : "Nothing matches."}
            </EmptyState>
          ) : (
            <div ref={measure}>
              <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
                <DataTable<ArticleRow>
                  table={table}
                  refresh={[valuation]}
                  pageScroll
                  cardsApart
                  cardSort={false}
                  // What is on the road stands under its own heading, as long
                  // as nobody has chosen another order.
                  renderBefore={
                    sorting.length === 0
                      ? (row, index, all) =>
                          row.in_transit &&
                          (index === 0 || !all[index - 1].in_transit) ? (
                            <GroupHeading title="In transit" />
                          ) : null
                      : undefined
                  }
                  summary={{
                    article: "Total set up",
                    quantity: count(sum(articles, (row) => row.quantity)),
                    value_minor: money(sum(articles, (row) => row.value_minor)),
                  }}
                />
              </Card>
            </div>
          )
        ) : tab === "site" ? (
          sites.length === 0 ? (
            <EmptyState>No stock to value.</EmptyState>
          ) : (
            <div ref={measure}>
              <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
                <DataTable<SiteRow>
                  table={table}
                  refresh={[valuation]}
                  pageScroll
                  cardsApart
                  cardSort={false}
                  summary={{
                    site: "Total set up",
                    pieces: count(sum(sites, (site) => site.pieces)),
                    value: money(sum(sites, (site) => site.value)),
                  }}
                />
              </Card>
            </div>
          )
        ) : awaiting.length === 0 ? (
          <EmptyState>Every receipt has been set up.</EmptyState>
        ) : (
          <>
            <div ref={measure}>
              <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
                <DataTable<AwaitingSetupRow>
                  table={table}
                  refresh={[valuation]}
                  pageScroll
                  cardsApart
                  cardSort={false}
                  summary={{
                    supplier: "Total",
                    lines: count(sum(awaiting, (row) => row.lines)),
                    quantity: count(sum(awaiting, (row) => row.quantity)),
                    value_minor: money(sum(awaiting, (row) => row.value_minor)),
                  }}
                />
              </Card>
            </div>
          </>
        )}
      </>
    </PageContent>
  )
}

/// `cell`: a row's own difference, bare in compact rows; the Total row keeps
/// its "Rp".
function Diff({ minor, cell }: { minor: number; cell?: boolean }) {
  return minor === 0 ? (
    <span className="text-mute">·</span>
  ) : (
    <span className="text-bad-fg">
      {cell ? <CellMoney minor={minor} /> : money(minor)}
    </span>
  )
}

/// One unit per row. On a phone the same columns are the card: the unit over
/// what its stock and its ledger say, the difference in red where there is one.
const ledgerColumns: ColumnDef<TableSetup, StockLedgerUnitRow>[] = [
  {
    accessorKey: "unit_name",
    header: "Unit",
    size: 260,
    meta: { card: "title", grow: 160 },
    cell: ({ row }) => row.original.unit_name,
  },
  {
    accessorKey: "on_hand_minor",
    header: "On hand",
    size: 150,
    meta: { align: "right", card: "metric", priority: 3 },
    cell: ({ row }) => <CellMoney minor={row.original.on_hand_minor} />,
  },
  {
    accessorKey: "awaiting_setup_minor",
    header: "Awaiting setup",
    size: 160,
    meta: { align: "right", card: "metric", priority: 3 },
    cell: ({ row }) => <CellMoney minor={row.original.awaiting_setup_minor} />,
  },
  {
    accessorKey: "stock_minor",
    header: "Stock",
    size: 150,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => <CellMoney minor={row.original.stock_minor} />,
  },
  {
    accessorKey: "ledger_minor",
    header: "Ledger",
    size: 150,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => <CellMoney minor={row.original.ledger_minor} />,
  },
  {
    accessorKey: "difference_minor",
    header: "Difference",
    size: 150,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => <Diff minor={row.original.difference_minor} cell />,
  },
  {
    accessorKey: "in_transit_stock_minor",
    header: "In transit",
    size: 150,
    meta: { align: "right", card: "metric", priority: 3 },
    cell: ({ row }) => (
      <CellMoney minor={row.original.in_transit_stock_minor} />
    ),
  },
  {
    accessorKey: "in_transit_ledger_minor",
    header: "In transit ledger",
    size: 170,
    meta: { align: "right", card: "metric", priority: 3 },
    cell: ({ row }) => (
      <CellMoney minor={row.original.in_transit_ledger_minor} />
    ),
  },
  {
    id: "in_transit_difference",
    accessorFn: (row) => row.in_transit_difference_minor,
    header: "Transit difference",
    size: 170,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <Diff minor={row.original.in_transit_difference_minor} cell />
    ),
  },
]

export function StockVsLedger() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Inventory"
          title="Stock vs Ledger"
          className="max-md:hidden"
        >
          Reading stock and ledger…
        </ScreenPending>
      }
    >
      <StockVsLedgerScreen />
    </Suspense>
  )
}

function StockVsLedgerScreen() {
  const result = useSuspenseQuery(stockVsLedgerQuery())
  const rows = result.data
  const [sorting, setSorting] = useState<SortingState>([])
  const stock = sum(rows, (row) => row.stock_minor)
  const ledger = sum(rows, (row) => row.ledger_minor)
  const difference = sum(rows, (row) => row.difference_minor)

  const phone = useLayout() === "phone"
  const [measure, fit] = useColumnFit(ledgerColumns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: ledgerColumns,
        getRowId: (row: StockLedgerUnitRow) => row.unit_id,
        state: {
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render: the room is measured, and the columns the
      // card has no room for are given up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, sorting, phone, fit]
    )
  )

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Inventory"
        title="Stock vs Ledger"
      />
      {rows.length === 0 ? (
        <EmptyState>No unit holds stock yet.</EmptyState>
      ) : (
        <>
          <KpiStrip className="md:grid-cols-3 xl:grid-cols-3">
            <Kpi label="Stock" value={money(stock)} />
            <Kpi label="Ledger" value={money(ledger)} />
            <Kpi
              label="Difference"
              value={
                <span
                  className={difference === 0 ? "text-ok-fg" : "text-bad-fg"}
                >
                  {money(difference)}
                </span>
              }
            />
          </KpiStrip>

          <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
            <BarSpacer />
            <ColumnsMenu table={table} />
          </div>
          <DockTools sort={dockSortOf(table)} />

          <div ref={measure}>
            <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
              <DataTable<StockLedgerUnitRow>
                table={table}
                refresh={[result]}
                pageScroll
                cardsApart
                cardSort={false}
                summary={{
                  unit_name: "Total",
                  on_hand_minor: money(sum(rows, (r) => r.on_hand_minor)),
                  awaiting_setup_minor: money(
                    sum(rows, (r) => r.awaiting_setup_minor)
                  ),
                  stock_minor: money(stock),
                  ledger_minor: money(ledger),
                  difference_minor: <Diff minor={difference} />,
                  // Not added up: the unit that sent a box and the unit it is
                  // bound for both carry it until it is counted in, so a total
                  // across units would count every box twice.
                  in_transit_stock_minor: (
                    <span title="Sender and receiver both carry a box until it is counted in, so units are not added">
                      —
                    </span>
                  ),
                  in_transit_ledger_minor: (
                    <span title="Sender and receiver both carry a box until it is counted in, so units are not added">
                      —
                    </span>
                  ),
                  in_transit_difference: (
                    <Diff
                      minor={sum(rows, (r) => r.in_transit_difference_minor)}
                    />
                  ),
                }}
              />
            </Card>
          </div>
        </>
      )}
    </PageContent>
  )
}
