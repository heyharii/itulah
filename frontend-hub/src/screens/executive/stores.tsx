import { useQuery } from "@tanstack/react-query"
import {
  useTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { Card } from "@/components/ui/card"
import { BarSeries } from "@/components/ui/chart"
import { DataTable } from "@/components/ui/data-table"
import { Segmented } from "@/components/ui/segmented"
import { useLayout } from "@/lib/layout"
import { count, money } from "@/lib/format"
import { fleetPools, inventoryKeys } from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { Legend } from "@/screens/executive/overview"
import {
  change,
  changeLabel,
  changeTone,
  percent,
  ratio,
  rupiah,
} from "@/screens/executive/format"
import { Figure, Figures, Head, ReportPage } from "@/screens/executive/parts"
import { useReportScope } from "@/screens/executive/scope"
import { useTrade } from "@/screens/executive/sales"
import { spanDays } from "@itulah/contract/reporting"

/// Store Performance — every shop side by side: how much it sold, how that moved,
/// what a basket is worth there, and how long its shelves would last.

interface StoreRow {
  readonly site_id: string
  readonly name: string
  readonly net: number
  readonly before: number
  readonly change: number | null
  readonly share: number | null
  readonly sales: number
  readonly basket: number | null
  readonly upt: number | null
  readonly stock: number | null
  /// Days the shelves would last at this period's pace. Null when nothing sold.
  readonly cover: number | null
}

const decimal = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const columns: ColumnDef<TableSetup, StoreRow>[] = [
  {
    accessorKey: "name",
    header: "Store",
    size: 170,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "net",
    header: "Net Sales",
    size: 150,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => (
      <span title={money(row.original.net)}>{rupiah(row.original.net)}</span>
    ),
  },
  {
    accessorKey: "change",
    header: "Change",
    size: 110,
    meta: { align: "right", card: "hide" },
    sortUndefined: "last",
    cell: ({ row }) => (
      <span
        className={cn(
          "font-medium",
          changeTone(row.original.change) === "up" && "text-ok-fg",
          changeTone(row.original.change) === "down" && "text-bad-fg",
          changeTone(row.original.change) === "flat" && "text-mute"
        )}
      >
        {changeLabel(row.original.change)}
      </span>
    ),
  },
  {
    accessorKey: "share",
    header: "Share",
    size: 110,
    meta: { align: "right", priority: 3, card: "hide" },
    cell: ({ row }) => percent(row.original.share),
  },
  {
    accessorKey: "sales",
    header: "Transactions",
    size: 110,
    meta: { align: "right", priority: 2, card: "hide" },
    cell: ({ row }) => count(row.original.sales),
  },
  {
    accessorKey: "basket",
    header: "Average Sale",
    size: 130,
    meta: { align: "right", priority: 2, card: "hide" },
    cell: ({ row }) => rupiah(row.original.basket),
  },
  {
    accessorKey: "upt",
    header: "Pcs / Sale",
    size: 110,
    meta: { align: "right", priority: 3, card: "hide" },
    cell: ({ row }) =>
      row.original.upt === null ? "—" : decimal.format(row.original.upt),
  },
  {
    accessorKey: "stock",
    header: "Stock",
    size: 110,
    meta: { align: "right", priority: 3, card: "hide" },
    cell: ({ row }) => count(row.original.stock),
  },
  {
    accessorKey: "cover",
    header: "Stock Cover",
    size: 130,
    meta: { align: "right", priority: 2, card: "hide" },
    cell: ({ row }) =>
      row.original.cover === null
        ? "—"
        : `${count(Math.round(row.original.cover))} days`,
  },

  // Columns that exist only on a phone's card: the shop, the figure the card
  // leads with, what is under it, and how it moved against last period.
  {
    id: "head",
    accessorFn: (row) => row.name,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="min-w-0 break-words">{row.original.name}</span>
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.net,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <span
        title={money(row.original.net)}
        className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink tabular-nums"
      >
        {rupiah(row.original.net)}
      </span>
    ),
  },
  {
    id: "sold",
    accessorFn: (row) => row.sales,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) =>
      row.original.basket === null
        ? `${count(row.original.sales)} transactions`
        : `${count(row.original.sales)} transactions · ${rupiah(row.original.basket)} per sale`,
  },
  {
    id: "shelf",
    accessorFn: (row) => row.stock,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) =>
      `Stock ${count(row.original.stock)}${
        row.original.cover === null
          ? ""
          : ` · cover ${count(Math.round(row.original.cover))} days`
      }`,
  },
  {
    id: "foot",
    accessorFn: (row) => row.change,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) =>
      row.original.change === null ? (
        <span>vs previous period —</span>
      ) : (
        <span>
          <span
            className={cn(
              "font-medium",
              changeTone(row.original.change) === "up" && "text-ok-fg",
              changeTone(row.original.change) === "down" && "text-bad-fg"
            )}
          >
            {changeLabel(row.original.change)}
          </span>{" "}
          vs previous period
          {row.original.share !== null &&
            ` · share ${percent(row.original.share)}`}
        </span>
      ),
  },
]

export function ExecutiveStores() {
  const scope = useReportScope()
  const trade = useTrade(scope)
  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })
  const [only, setOnly] = useState<"all" | "down">("all")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "net", desc: true },
  ])
  const phone = useLayout() === "phone"

  const days = spanDays(scope.current.from, scope.current.to)

  const rows = useMemo<StoreRow[]>(() => {
    const data = trade.query.data
    if (!data) return []
    // Shelf stock only: the store's own inventory pools the fleet total counts.
    // A shadowed cloud row and a rollup are real rows, not second pieces.
    const shelves = new Map<string, number>()
    for (const pool of fleet.data?.items ?? []) {
      if (!pool.authority.included_in_fleet_total) continue
      if (pool.group !== "STORE_INVENTORY") continue
      shelves.set(pool.site_id, (shelves.get(pool.site_id) ?? 0) + pool.on_hand)
    }
    const whole = data.stores.reduce((sum, store) => sum + store.net, 0)
    return data.stores
      .filter((store) => store.kind === "STORE")
      .map((store) => {
        const stock = fleet.data ? (shelves.get(store.site_id) ?? 0) : null
        const pace = store.units / days
        return {
          site_id: store.site_id,
          name: store.name,
          net: store.net,
          before: store.before,
          change: change(store.net, store.before),
          share: ratio(store.net, whole),
          sales: store.sales,
          basket:
            store.sales === 0 ? null : Math.round(store.net / store.sales),
          upt: store.sales === 0 ? null : store.units / store.sales,
          stock,
          cover: stock === null || pace === 0 ? null : stock / pace,
        }
      })
  }, [trade.query.data, fleet.data, days])

  const shown = useMemo(
    () => (only === "down" ? rows.filter((row) => row.net < row.before) : rows),
    [rows, only]
  )
  const falling = rows.filter((row) => row.net < row.before).length

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: shown,
        columns,
        getRowId: (row: StoreRow) => row.site_id,
        state: {
          sorting,
          // The card's own columns are drawn on a phone and never on a desk.
          columnVisibility: {
            head: phone,
            lead: phone,
            sold: phone,
            shelf: phone,
            foot: phone,
          },
        },
        onSortingChange: setSorting,
      }),
      [shown, sorting, phone]
    )
  )

  const total = trade.query.data?.total
  const basket = (net: number, sales: number) =>
    sales === 0 ? 0 : Math.round(net / sales)

  return (
    <ReportPage title="Store Performance" scope={scope}>
      <Figures>
        <Figure
          label="Net sales"
          value={total ? rupiah(total.net) : "…"}
          now={total?.net}
          before={total?.before}
        />
        <Figure
          label="Transactions"
          value={total ? count(total.sales) : "…"}
          now={total?.sales}
          before={total?.salesBefore}
        />
        <Figure
          label="Average sale"
          value={
            total && total.sales > 0
              ? rupiah(basket(total.net, total.sales))
              : "—"
          }
          now={total ? basket(total.net, total.sales) : undefined}
          before={total ? basket(total.before, total.salesBefore) : undefined}
        />
        <Figure
          label="Stores down"
          value={trade.query.data ? `${falling} / ${rows.length}` : "…"}
          note="Against the previous period"
        />
      </Figures>

      <Card className="mb-3 overflow-hidden">
        <Head title="Sales by store">
          <span className="ml-auto flex items-center gap-3 text-mute">
            <Legend tone="accent">This period</Legend>
            <Legend tone="ghost">Previous period</Legend>
          </span>
        </Head>
        <div className="px-[1.125rem] pb-4">
          {queryState(trade.query, {
            loading: "Reading the sales…",
            render: () => (
              <BarSeries
                rows={[...rows]
                  .sort((a, b) => b.net - a.net)
                  .map((row) => ({
                    bucket: row.site_id,
                    before: row.before,
                    now: row.net,
                  }))}
                series={[
                  { key: "before", label: "Previous period", tone: "ghost" },
                  { key: "now", label: "This period", tone: "accent" },
                ]}
                format={money}
                titleOf={(id) =>
                  rows.find((row) => row.site_id === id)?.name ?? id
                }
                labelOf={(id) =>
                  (rows.find((row) => row.site_id === id)?.name ?? id).replace(
                    /^Store /,
                    ""
                  )
                }
                className="h-[13rem]"
              />
            ),
          })}
        </div>
      </Card>

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <Head title="Store comparison">
          <Segmented
            options={[
              { value: "all", label: "All" },
              { value: "down", label: "Down" },
            ]}
            value={only}
            onChange={setOnly}
          />
        </Head>
        {queryState(trade.query, {
          loading: "Reading the stores…",
          render: () => (
            <DataTable<StoreRow>
              table={table}
              onRowClick={(row) =>
                scope.setStore(
                  row.site_id === scope.store ? undefined : row.site_id
                )
              }
              isSelected={(row) => row.site_id === scope.store}
              empty={
                only === "down"
                  ? "No store is down against the previous period."
                  : "No store has sold anything in this period yet."
              }
              cardSort={false}
              cardsApart
              cardLead
            />
          ),
        })}
      </Card>
    </ReportPage>
  )
}
