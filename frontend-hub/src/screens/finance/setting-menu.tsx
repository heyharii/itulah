import { useSuspenseQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { numberSeriesQuery } from "@/lib/queries/finance-number-series"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useColumnFit } from "@/screens/finance/column-fit"
import { RESET_WORDS, SeriesSheet } from "@/screens/finance/number-series"
import { ScreenPending } from "@/screens/finance/pending"
import type { NumberSeries } from "@itulah/contract"

/// 7Soft's Setting Menu (2.20): one row per transaction menu, and what each
/// one is set to.
///
/// Menu, Display and Kode No Transaksi / No Transaksi are the hub's numbering
/// per kind of document, changed in the sheet a row opens. 7Soft's other
/// columns — Urutan, Tanggal Bisa Edit, Tampil Awal, Auto Insert, Sorting By,
/// Keterangan — have no setting behind them here, so they stand in 7Soft's
/// place and read "—" rather than a switch that saves nothing.
const dash = <span className="text-faint">—</span>

/// A column 7Soft has and the hub has no setting for.
function empty(
  id: string,
  header: string,
  size: number,
  align?: "right" | "center"
): ColumnDef<TableSetup, NumberSeries> {
  return {
    id,
    accessorFn: () => "",
    header,
    size,
    enableSorting: false,
    meta: { card: "hide", ...(align ? { align } : {}) },
    cell: () => dash,
  }
}

const columns: ColumnDef<TableSetup, NumberSeries>[] = [
  {
    accessorKey: "document_kind",
    header: "Menu",
    size: 220,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span className="font-mono text-[0.9375rem] text-body">
        {row.original.document_kind}
      </span>
    ),
  },
  {
    accessorKey: "label",
    header: "Display",
    size: 260,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => <span className="text-ink">{row.original.label}</span>,
  },
  empty("urutan", "Urutan", 100, "right"),
  {
    accessorKey: "pattern",
    header: "Kode No Transaksi",
    size: 240,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <span className="font-mono text-[0.9375rem] text-ink">
        {row.original.pattern}
      </span>
    ),
  },
  {
    id: "reset",
    accessorFn: (row) => RESET_WORDS[row.reset] ?? row.reset,
    header: "No Transaksi",
    size: 150,
    meta: { card: "metric" },
    cell: ({ row }) => RESET_WORDS[row.original.reset] ?? row.original.reset,
  },
  empty("edit_date", "Tanggal Bisa Edit", 170, "center"),
  empty("first", "Tampil Awal", 130, "center"),
  empty("auto_insert", "Auto Insert", 130, "center"),
  empty("sorting", "Sorting By", 160),
  empty("note", "Keterangan", 200),
]

export function SettingMenu() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Master" title="Setting Menu">
          Reading the menus…
        </ScreenPending>
      }
    >
      <SettingMenuScreen />
    </Suspense>
  )
}

function SettingMenuScreen() {
  const phone = useLayout() === "phone"
  const list = useSuspenseQuery(numberSeriesQuery())
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])
  const [editing, setEditing] = useState<string | null>(null)
  const rows = list.data.items

  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: NumberSeries) => row.document_kind,
        state: {
          globalFilter: needle,
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setNeedle,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render: the room is measured, and the columns the
      // card has no room for are given up.
      [rows, needle, sorting, fit]
    )
  )

  return (
    <PageContent>
      <PageHeader crumb="Finance · Master" title="Setting Menu" />

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search menus"
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>

      <DockTools
        search={{ value: needle, onChange: setNeedle, label: "Search menus" }}
        sort={dockSortOf(table)}
      />

      <div ref={measure}>
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          {queryState(list, {
            render: () =>
              rows.length === 0 ? (
                <EmptyState>No document kind is numbered yet.</EmptyState>
              ) : (
                <DataTable<NumberSeries>
                  table={table}
                  refresh={[list]}
                  onRowClick={(row) => setEditing(row.document_kind)}
                  isSelected={(row) => row.document_kind === editing}
                  empty="No menu matches the search."
                  pageScroll
                  cardsApart
                  cardLead
                  cardSort={false}
                  summary={{
                    document_kind: (
                      <span>
                        {count(table.getRowModel().rows.length)}{" "}
                        <span className="font-normal text-body">menus</span>
                      </span>
                    ),
                  }}
                />
              ),
          })}
        </Card>
      </div>

      <SeriesSheet
        series={rows.find((one) => one.document_kind === editing)}
        onClose={() => setEditing(null)}
      />
    </PageContent>
  )
}
