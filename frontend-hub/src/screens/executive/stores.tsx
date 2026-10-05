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

/// Kinerja toko — every shop side by side: how much it sold, how that moved,
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
    header: "Toko",
    size: 170,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "net",
    header: "Penjualan Bersih",
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span title={money(row.original.net)}>{rupiah(row.original.net)}</span>
    ),
  },
  {
    accessorKey: "change",
    header: "Perubahan",
    size: 110,
    meta: { align: "right" },
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
    header: "Kontribusi",
    size: 110,
    meta: { align: "right", priority: 3 },
    cell: ({ row }) => percent(row.original.share),
  },
  {
    accessorKey: "sales",
    header: "Transaksi",
    size: 110,
    meta: { align: "right", priority: 2 },
    cell: ({ row }) => count(row.original.sales),
  },
  {
    accessorKey: "basket",
    header: "Rata-rata Struk",
    size: 130,
    meta: { align: "right", priority: 2 },
    cell: ({ row }) => rupiah(row.original.basket),
  },
  {
    accessorKey: "upt",
    header: "Unit / Struk",
    size: 110,
    meta: { align: "right", priority: 3 },
    cell: ({ row }) =>
      row.original.upt === null ? "—" : decimal.format(row.original.upt),
  },
  {
    accessorKey: "stock",
    header: "Stok",
    size: 110,
    meta: { align: "right", priority: 3 },
    cell: ({ row }) => count(row.original.stock),
  },
  {
    accessorKey: "cover",
    header: "Cakupan Stok",
    size: 130,
    meta: { align: "right", priority: 2 },
    cell: ({ row }) =>
      row.original.cover === null
        ? "—"
        : `${count(Math.round(row.original.cover))} hari`,
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
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [shown, sorting]
    )
  )

  const total = trade.query.data?.total
  const basket = (net: number, sales: number) =>
    sales === 0 ? 0 : Math.round(net / sales)

  return (
    <ReportPage title="Kinerja toko" scope={scope}>
      <Figures>
        <Figure
          label="Penjualan bersih"
          value={total ? rupiah(total.net) : "…"}
          now={total?.net}
          before={total?.before}
        />
        <Figure
          label="Transaksi"
          value={total ? count(total.sales) : "…"}
          now={total?.sales}
          before={total?.salesBefore}
        />
        <Figure
          label="Rata-rata struk"
          value={
            total && total.sales > 0
              ? rupiah(basket(total.net, total.sales))
              : "—"
          }
          now={total ? basket(total.net, total.sales) : undefined}
          before={total ? basket(total.before, total.salesBefore) : undefined}
        />
        <Figure
          label="Toko menurun"
          value={trade.query.data ? `${falling} / ${rows.length}` : "…"}
          note="Dibanding periode lalu"
        />
      </Figures>

      <Card className="mb-3 overflow-hidden">
        <Head title="Penjualan per toko">
          <span className="ml-auto flex items-center gap-3 text-mute">
            <Legend tone="accent">Periode ini</Legend>
            <Legend tone="ghost">Periode lalu</Legend>
          </span>
        </Head>
        <div className="px-[1.125rem] pb-4">
          {queryState(trade.query, {
            loading: "Membaca penjualan…",
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
                  { key: "before", label: "Periode lalu", tone: "ghost" },
                  { key: "now", label: "Periode ini", tone: "accent" },
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

      <Card className="overflow-hidden">
        <Head title="Perbandingan toko">
          <Segmented
            options={[
              { value: "all", label: "Semua" },
              { value: "down", label: "Menurun" },
            ]}
            value={only}
            onChange={setOnly}
          />
        </Head>
        {queryState(trade.query, {
          loading: "Membaca toko…",
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
                  ? "Tidak ada toko yang turun dibanding periode lalu."
                  : "Belum ada toko yang berjualan di periode ini."
              }
            />
          ),
        })}
      </Card>
    </ReportPage>
  )
}
