import { useQueries, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { DayRange } from "@/components/ui/day-range"
import { ExportButton } from "@/components/ui/export-button"
import { Input, Select } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { Toolbar } from "@/components/ui/segmented"
import { useFilters } from "@/lib/filters"
import { count, day, money } from "@/lib/format"
import type { ExportCell, ExportSheet } from "@/lib/export-xlsx"
import {
  billItemLines,
  financeKeys,
  listCreditNotes,
  listOpenAdvances,
  partyMovements,
  payablesAgingQuery,
} from "@/lib/queries/finance"
import { listPurchaseOrders } from "@/lib/queries/procurement"
import { useSiteLabel } from "@/lib/queries/organisation"
import {
  supplierReturns,
  supplierReturnKeys,
} from "@/lib/queries/supplier-returns"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { todayIso } from "@/screens/finance/chart"
import {
  useAsOf,
  useSuppliers,
  useSupplierName,
  useWindow,
} from "@/screens/finance/hooks"
import { AGEING_BUCKETS } from "@/screens/finance/measures"
import { SiteSelect, SupplierPicker, UnitSelect } from "@/screens/finance/parts"
import {
  billStatus,
  noteStatus,
  useBillsInWindow,
  useOpenItems,
  useSettlementLines,
  useSupplierMovements,
} from "@/screens/finance/purchasing"
import { supplierDisplayName } from "@/screens/procurement/supplier-format"

/// 7Soft's Laporan Pembelian (4.6, manual hal. 131-137): all 33 reports, in
/// 7Soft's order and under its names. Each opens in a sheet over the list, with
/// the boxes 7Soft's parameter dialog asks (a day, a window, a supplier, a
/// faktur number, a Gudang, Jenis item), and exports to Excel.
///
/// What a report is drawn from:
///
/// - Bills, payments, credit notes, advances and the payment ledger (2, 3, 12,
///   15, 22, 24 to 33) and the item lines of the bills (1, 4, 6 to 9).
/// - The order book and the supplier returns (17, 20, 21, 23).
/// - Reports the data cannot answer yet (5, 10, 11, 13, 14, 16, 18, 19) open
///   with 7Soft's columns and "—" in them, so the report is there and what it
///   waits for is plain. Those that belong to Procurement also say where.

type Ask =
  "asOf" | "window" | "supplier" | "unit" | "jenis" | "nofaktur" | "gudang"

interface ReportDef {
  /// 7Soft's number and name, as the list prints them.
  readonly no: number
  readonly name: string
  /// 7Soft's Keterangan column.
  readonly group:
    "Pembelian" | "Retur" | "Uang muka" | "Hutang" | "Supplier" | "PO"
  /// What 7Soft's parameter dialog asks.
  readonly asks: readonly Ask[]
  /// Where the same question is worked in Procurement, when it is.
  readonly home?: string
  /// The columns 7Soft prints, for a report the data cannot fill yet.
  readonly columns?: readonly string[]
}

const ITEM_ASKS: readonly Ask[] = ["window", "jenis"]

const REPORTS: readonly ReportDef[] = [
  {
    no: 1,
    name: "Laporan Harian Detail Pembelian Item",
    group: "Pembelian",
    asks: ITEM_ASKS,
  },
  {
    no: 2,
    name: "Laporan Pembelian Bulanan",
    group: "Pembelian",
    asks: ["window", "jenis"],
  },
  {
    no: 3,
    name: "Summary Pembelian",
    group: "Pembelian",
    asks: ["window", "nofaktur", "supplier", "gudang", "jenis"],
  },
  {
    no: 4,
    name: "Rekap Detail Faktur Pembelian",
    group: "Pembelian",
    asks: ITEM_ASKS,
  },
  {
    no: 5,
    name: "Laporan Barang Datang (Nilai)",
    group: "PO",
    asks: [],
    home: "/operations/intake",
    columns: [
      "Tanggal",
      "No BPB",
      "Supplier",
      "No PO",
      "Gudang",
      "Kode item",
      "Nama item",
      "Jml",
      "Harga",
      "Nilai",
    ],
  },
  {
    no: 6,
    name: "Laporan Harian Pembelian Item Detail Supplier",
    group: "Pembelian",
    asks: ITEM_ASKS,
  },
  {
    no: 7,
    name: "Laporan Harian Pembelian Per Supplier Detail Item",
    group: "Pembelian",
    asks: ITEM_ASKS,
  },
  {
    no: 8,
    name: "Laporan Bulanan Pembelian Item Detail Supplier",
    group: "Pembelian",
    asks: ITEM_ASKS,
  },
  {
    no: 9,
    name: "Laporan Bulanan Pembelian Per Supplier Detail Item",
    group: "Pembelian",
    asks: ITEM_ASKS,
  },
  {
    no: 10,
    name: "Laporan Daftar Harga",
    group: "Pembelian",
    asks: [],
    home: "/procurement/catalogue",
    columns: [
      "Kode item",
      "Nama item",
      "Satuan",
      "Harga beli",
      "Harga jual",
      "Supplier",
    ],
  },
  {
    no: 11,
    name: "Laporan History Harga Pembelian",
    group: "Pembelian",
    asks: [],
    home: "/procurement/amendments",
    columns: [
      "Tanggal",
      "No faktur",
      "Supplier",
      "Kode item",
      "Nama item",
      "Jml",
      "Satuan",
      "Harga",
    ],
  },
  {
    no: 12,
    name: "Summary Pembelian PPN",
    group: "Pembelian",
    asks: ["window"],
  },
  {
    no: 13,
    name: "Laporan Summary Uang Muka Pembelian",
    group: "Uang muka",
    asks: [],
    columns: [
      "No UM",
      "Tanggal",
      "Supplier",
      "Total UM",
      "No faktur diapply",
      "Diapply",
      "Sisa",
    ],
  },
  {
    no: 14,
    name: "Laporan Detail Uang Muka Pembelian",
    group: "Uang muka",
    asks: [],
    columns: [
      "No UM",
      "Tanggal",
      "Supplier",
      "No faktur diapply",
      "Kode item",
      "Nama item",
      "Jml",
      "Harga",
      "Total",
    ],
  },
  {
    no: 15,
    name: "Laporan Summary Outstanding Uang Muka Pembelian",
    group: "Uang muka",
    asks: [],
  },
  {
    no: 16,
    name: "Laporan Detail Outstanding Uang Muka Pembelian",
    group: "Uang muka",
    asks: [],
    columns: [
      "No UM",
      "Tanggal",
      "Supplier",
      "No faktur diapply",
      "Kode item",
      "Nama item",
      "Jml",
      "Harga",
      "Total",
      "Sisa UM",
    ],
  },
  {
    no: 17,
    name: "Laporan Summary PO",
    group: "PO",
    asks: ["window"],
    home: "/procurement/orders",
  },
  {
    no: 18,
    name: "Laporan Detail PO",
    group: "PO",
    asks: [],
    home: "/procurement/orders",
    columns: [
      "Tanggal",
      "No PO",
      "Supplier",
      "Kode item",
      "Nama item",
      "Jml",
      "Satuan",
      "Harga",
      "Total",
      "Status",
    ],
  },
  {
    no: 19,
    name: "Perbandingan PO Outstanding dengan stok saat ini",
    group: "PO",
    asks: [],
    home: "/procurement/outstanding",
    columns: [
      "Kode item",
      "Nama item",
      "Satuan",
      "Stok saat ini",
      "PO outstanding",
      "Selisih",
    ],
  },
  {
    no: 20,
    name: "PO Outstanding",
    group: "PO",
    asks: ["window"],
    home: "/procurement/outstanding",
  },
  {
    no: 21,
    name: "Laporan Realisasi PO",
    group: "PO",
    asks: [],
    home: "/procurement/orders",
  },
  {
    no: 22,
    name: "Laporan Summary Retur Pembelian",
    group: "Retur",
    asks: ["window", "nofaktur", "supplier", "gudang"],
  },
  {
    no: 23,
    name: "Laporan Detail Retur Pembelian",
    group: "Retur",
    asks: [],
    home: "/procurement/returns",
  },
  {
    no: 24,
    name: "Laporan Detail Pelunasan Nota Pembelian",
    group: "Hutang",
    asks: ["window", "supplier"],
  },
  {
    no: 25,
    name: "Hutang Jatuh Tempo",
    group: "Hutang",
    asks: ["asOf", "unit"],
  },
  {
    no: 26,
    name: "Summary Hutang Dagang",
    group: "Hutang",
    asks: ["window", "unit"],
  },
  {
    no: 27,
    name: "Summary Hutang Dagang Per Tanggal",
    group: "Hutang",
    asks: ["window", "unit"],
  },
  {
    no: 28,
    name: "Kartu Hutang",
    group: "Hutang",
    asks: ["supplier", "window", "unit"],
  },
  {
    no: 29,
    name: "Sisa Hutang Dagang",
    group: "Hutang",
    asks: ["asOf", "unit"],
  },
  {
    no: 30,
    name: "Umur Hutang Dagang Per Supplier Per Faktur",
    group: "Hutang",
    asks: ["asOf", "unit"],
  },
  {
    no: 31,
    name: "Sisa Hutang Dagang per Supplier",
    group: "Hutang",
    asks: ["asOf", "supplier", "unit"],
  },
  { no: 32, name: "Umur Hutang", group: "Hutang", asks: ["asOf", "unit"] },
  { no: 33, name: "List Supplier", group: "Supplier", asks: [] },
]

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

const reportColumns: ColumnDef<TableSetup, ReportDef>[] = [
  {
    accessorKey: "no",
    header: "No",
    size: 80,
    enableSorting: false,
    meta: { card: "id" },
    cell: ({ row }) => (
      <span className="text-mute tabular-nums">{row.original.no}</span>
    ),
  },
  {
    accessorKey: "name",
    header: "Laporan",
    size: 520,
    enableSorting: false,
    meta: { card: "title", grow: 360 },
    cell: ({ row }) => (
      <span className="block truncate font-medium text-ink">
        {row.original.name}
      </span>
    ),
  },
  {
    accessorKey: "group",
    header: "Keterangan",
    size: 160,
    enableSorting: false,
    meta: { card: "meta", filter: { kind: "option" } },
    cell: ({ row }) => <span className="text-body">{row.original.group}</span>,
  },
]

export function PurchasingReports() {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<ReportDef | null>(null)
  const filters = useFilters(reportColumns)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: REPORTS as ReportDef[],
        columns: filters.columns,
        getRowId: (row: ReportDef) => String(row.no),
        state: { columnFilters: filters.columnFilters, globalFilter: query },
        onGlobalFilterChange: setQuery,
      }),
      [filters.columns, filters.columnFilters, query, setQuery]
    )
  )
  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Payables"
        title="Laporan Pembelian"
      />
      <Toolbar className="group/bar">
        <FilterPanel
          model={filters}
          table={table}
          search={{ value: query, onChange: setQuery, label: "Search reports" }}
        />
      </Toolbar>
      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <DataTable<ReportDef>
          table={table}
          onRowClick={setOpen}
          pageScroll
          cardSort={false}
          cardsApart
          cardLead
          empty={<EmptyState>No report matches the search.</EmptyState>}
        />
      </Card>
      <Sheet
        open={open !== null}
        onOpenChange={(next) => !next && setOpen(null)}
        id={open === null ? undefined : String(open.no)}
        title={open?.name ?? "Laporan"}
        size="table"
      >
        {open !== null && <ReportBody key={open.no} def={open} />}
      </Sheet>
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// One report: 7Soft's parameter dialog, then the report
// ---------------------------------------------------------------------------

type Jenis = "" | "MERCHANDISE" | "EXPENSE"

interface Params {
  readonly asOf: string
  readonly from: string
  readonly to: string
  /// A supplier code, or "" for every supplier.
  readonly supplier: string
  readonly unit: string
  readonly jenis: Jenis
  /// 7Soft's No Faktur box: a part of the number, or "" for every faktur.
  readonly invoice: string
  /// A site id, or "" for every Gudang.
  readonly site: string
}

function ReportBody({ def }: { def: ReportDef }) {
  const navigate = useNavigate()
  const [invoice, setInvoice] = useState("")
  const [site, setSite] = useState("")
  const asOf = useAsOf()
  const month = useWindow()
  const suppliers = useSuppliers()
  const [supplier, setSupplier] = useState("")
  const [unit, setUnit] = useState("")
  const [jenis, setJenis] = useState<Jenis>("")
  const chosen = (suppliers.data ?? []).find(
    (one) => one.supplier_code === supplier
  )
  const params: Params = {
    asOf: asOf.value,
    // An open end of the box is the earliest day the books can have, or today.
    from: month.from === "" ? "2000-01-01" : month.from,
    to: month.to === "" ? todayIso() : month.to,
    supplier,
    unit,
    jenis,
    invoice,
    site,
  }
  const asks = (ask: Ask) => def.asks.includes(ask)
  return (
    <div className="flex flex-col gap-4">
      {def.asks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {asks("supplier") && (
            <SupplierPicker
              value={chosen?.supplier_id ?? ""}
              onPick={(next) => setSupplier(next?.supplier_code ?? "")}
              label="Supplier"
              className="h-control w-72"
            />
          )}
          {asks("window") && (
            <DayRange
              label="Periode"
              placeholder="Periode"
              value={{ from: month.from, to: month.to }}
              onChange={(next) => {
                month.setFrom(next.from)
                month.setTo(next.to)
              }}
              className="h-control min-h-0 w-52 shrink-0 py-0"
            />
          )}
          {asks("asOf") && (
            <label className="flex items-center gap-1.5 text-[0.9375rem] text-mute">
              Tanggal
              <Day
                value={asOf.value}
                onChange={asOf.set}
                className="h-8 w-40"
                label="Tanggal"
              />
            </label>
          )}
          {asks("unit") && (
            <UnitSelect
              value={unit}
              onChange={setUnit}
              className="h-control w-44"
              aria-label="Unit"
            />
          )}
          {asks("nofaktur") && (
            <Input
              value={invoice}
              onChange={(event) => setInvoice(event.target.value)}
              placeholder="No faktur"
              aria-label="No faktur"
              className="h-control w-44"
            />
          )}
          {asks("gudang") && (
            <SiteSelect
              value={site}
              onChange={setSite}
              emptyLabel="All gudang"
              className="h-control w-44"
              aria-label="Gudang"
            />
          )}
          {asks("jenis") && (
            <Select
              value={jenis}
              onChange={(next) => setJenis(next as Jenis)}
              className="h-control w-44"
              aria-label="Jenis item"
            >
              <option value="">All</option>
              <option value="MERCHANDISE">Stok</option>
              <option value="EXPENSE">Jasa</option>
            </Select>
          )}
        </div>
      )}
      {def.home !== undefined && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={() => void navigate({ to: def.home } as never)}
          >
            Open in{" "}
            {def.home.startsWith("/operations") ? "Operations" : "Procurement"}
          </Button>
        </div>
      )}
      <Report def={def} p={params} />
    </div>
  )
}

/// Which report body draws report `no`. One component per question, because
/// each reads its own queries.
function Report({ def, p }: { def: ReportDef; p: Params }) {
  switch (def.no) {
    case 1:
      return <ItemsReport mode="detail" title={def.name} p={p} />
    case 4:
      return <ItemsReport mode="detail" title={def.name} p={p} />
    case 6:
    case 8:
      return <ItemsReport mode="item" title={def.name} p={p} />
    case 7:
    case 9:
      return <ItemsReport mode="supplier" title={def.name} p={p} />
    case 17:
      return <OrdersReport mode="summary" p={p} />
    case 20:
      return <OrdersReport mode="outstanding" p={p} />
    case 21:
      return <OrdersReport mode="realisasi" p={p} />
    case 23:
      return <ReturnLinesReport p={p} />
    case 2:
      return <PurchasesReport mode="monthly" p={p} />
    case 3:
      return <PurchasesReport mode="summary" p={p} />
    case 12:
      return <PurchasesReport mode="ppn" p={p} />
    case 15:
      return <AdvancesReport />
    case 22:
      return <ReturnsReport p={p} />
    case 24:
      return <PaymentsReport p={p} />
    case 25:
      return <OpenItemsReport mode="due" p={p} />
    case 26:
      return <BalancesReport mode="periode" p={p} />
    case 27:
      return <BalancesReport mode="tanggal" p={p} />
    case 28:
      return <KartuReport p={p} />
    case 29:
      return <AgingReport mode="sisa" p={p} />
    case 30:
      return <OpenItemsReport mode="umur" p={p} />
    case 31:
      return <OpenItemsReport mode="sisa" p={p} />
    case 32:
      return <AgingReport mode="umur" p={p} />
    case 33:
      return <SupplierListReport />
    default:
      return <PendingReport columns={def.columns ?? []} />
  }
}

// ---------------------------------------------------------------------------
// The shape every report ends in
// ---------------------------------------------------------------------------

/// A report as rows and typed columns: what is drawn is what is exported, so
/// the .xlsx is the page, not a second opinion.
function ReportView({ sheet }: { sheet: ExportSheet }) {
  const cell = (
    kind: ExportSheet["columns"][number]["kind"],
    value: ExportCell
  ): React.ReactNode => {
    if (value === null || value === undefined || value === "") return ""
    if (kind === "money") return money(Number(value))
    if (kind === "number") return count(Number(value))
    if (kind === "date") return day(String(value))
    return String(value)
  }
  const right = (kind: string) =>
    kind === "money" || kind === "number" ? "right" : undefined
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.9375rem] text-mute">{sheet.subtitle}</span>
        <ExportButton build={() => sheet} variant="ghost" />
      </div>
      {sheet.rows.length === 0 ? (
        <EmptyState>Nothing to report for this question.</EmptyState>
      ) : (
        <Grid>
          <thead>
            <tr>
              {sheet.columns.map((column, index) => (
                <Th key={index} align={right(column.kind)}>
                  {column.header}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, at) => (
              <tr key={at}>
                {row.map((value, index) => (
                  <Td key={index} align={right(sheet.columns[index].kind)}>
                    {cell(sheet.columns[index].kind, value)}
                  </Td>
                ))}
              </tr>
            ))}
            {sheet.totalRow !== undefined && (
              <TotalRow>
                {sheet.totalRow.map((value, index) => (
                  <Td key={index} align={right(sheet.columns[index].kind)}>
                    {cell(sheet.columns[index].kind, value)}
                  </Td>
                ))}
              </TotalRow>
            )}
          </tbody>
        </Grid>
      )}
    </div>
  )
}

const text = (header: string, width?: number) =>
  ({ header, kind: "text", width }) as const
const date = (header: string) => ({ header, kind: "date" }) as const
const moneyCol = (header: string) => ({ header, kind: "money" }) as const
const num = (header: string) => ({ header, kind: "number" }) as const

const sum = <T,>(rows: readonly T[], pick: (row: T) => number) =>
  rows.reduce((total, row) => total + pick(row), 0)

const span = (p: Params) => `${day(p.from)} – ${day(p.to)}`

// ---------------------------------------------------------------------------
// Pembelian: 2, 3, 12
// ---------------------------------------------------------------------------

function PurchasesReport({
  mode,
  p,
}: {
  mode: "monthly" | "summary" | "ppn"
  p: Params
}) {
  const bills = useBillsInWindow(
    mode === "summary" ? p.supplier : "",
    p.from,
    p.to
  )
  const supplierName = useSupplierName()
  const site = useSiteLabel()
  if (!bills.complete) return <LoadingState>Reading the bills…</LoadingState>
  const rows = bills.rows
    .filter((bill) => mode === "ppn" || p.jenis === "" || bill.kind === p.jenis)
    .filter((bill) => mode !== "ppn" || bill.tax_minor > 0)
    .filter(
      (bill) =>
        mode !== "summary" ||
        ((p.invoice.trim() === "" ||
          bill.invoice_number
            .toLowerCase()
            .includes(p.invoice.trim().toLowerCase())) &&
          (p.site === "" || bill.site_id === p.site))
    )
    .slice()
    .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date))
  const name = (supplierId: string, given: string | null) =>
    supplierName(supplierId, given)

  if (mode === "monthly") {
    // Per supplier: how many invoices and what they came to, the biggest
    // first.
    const by = new Map<
      string,
      { name: string; invoices: number; total: number; tax: number }
    >()
    for (const bill of rows) {
      const one = by.get(bill.supplier_id) ?? {
        name: name(bill.supplier_id, bill.supplier_name),
        invoices: 0,
        total: 0,
        tax: 0,
      }
      one.invoices += 1
      one.total += bill.total_minor
      one.tax += bill.tax_minor
      by.set(bill.supplier_id, one)
    }
    const lines = [...by.values()].sort((a, b) => b.total - a.total)
    return (
      <ReportView
        sheet={{
          filename: `Laporan-Pembelian-Bulanan-${p.from}`,
          sheet: "Pembelian Bulanan",
          title: "Laporan Pembelian Bulanan",
          subtitle: span(p),
          columns: [
            text("Supplier", 36),
            num("Faktur"),
            moneyCol("PPN"),
            moneyCol("Total"),
          ],
          rows: lines.map((one) => [
            one.name,
            one.invoices,
            one.tax,
            one.total,
          ]),
          totalRow: [
            "Total",
            sum(lines, (one) => one.invoices),
            sum(lines, (one) => one.tax),
            sum(lines, (one) => one.total),
          ],
        }}
      />
    )
  }
  if (mode === "ppn") {
    return (
      <ReportView
        sheet={{
          filename: `Summary-Pembelian-PPN-${p.from}`,
          sheet: "Pembelian PPN",
          title: "Summary Pembelian PPN",
          subtitle: span(p),
          columns: [
            date("Tanggal"),
            text("No faktur", 18),
            text("Supplier", 36),
            moneyCol("DPP"),
            moneyCol("PPN"),
            moneyCol("Total"),
          ],
          rows: rows.map((bill) => [
            bill.invoice_date,
            bill.invoice_number,
            name(bill.supplier_id, bill.supplier_name),
            bill.subtotal_minor - bill.discount_minor,
            bill.tax_minor,
            bill.total_minor,
          ]),
          totalRow: [
            "Total",
            null,
            null,
            sum(rows, (bill) => bill.subtotal_minor - bill.discount_minor),
            sum(rows, (bill) => bill.tax_minor),
            sum(rows, (bill) => bill.total_minor),
          ],
        }}
      />
    )
  }
  return (
    <ReportView
      sheet={{
        filename: `Summary-Pembelian-${p.from}`,
        sheet: "Summary Pembelian",
        title: "Summary Pembelian",
        subtitle: span(p),
        columns: [
          date("Tanggal"),
          text("No faktur", 18),
          text("Supplier", 36),
          text("Gudang", 20),
          text("Status", 12),
          date("JTempo"),
          moneyCol("PPN"),
          moneyCol("Total"),
        ],
        rows: rows.map((bill) => [
          bill.invoice_date,
          bill.invoice_number,
          name(bill.supplier_id, bill.supplier_name),
          site(bill.site_id),
          billStatus(bill).word,
          bill.due_date,
          bill.tax_minor,
          bill.total_minor,
        ]),
        totalRow: [
          "Total",
          null,
          null,
          null,
          null,
          null,
          sum(rows, (bill) => bill.tax_minor),
          sum(rows, (bill) => bill.total_minor),
        ],
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Uang muka and Retur: 15, 22
// ---------------------------------------------------------------------------

function AdvancesReport() {
  const advances = useQuery({
    queryKey: [...financeKeys.all, "supplier-advances", "all-open"],
    queryFn: ({ signal }) => listOpenAdvances(signal),
  })
  const supplierName = useSupplierName()
  if (advances.isPending)
    return <LoadingState>Reading the advances…</LoadingState>
  const rows = (advances.data ?? []).filter(
    (one) => one.status === "POSTED" && one.outstanding_minor > 0
  )
  return (
    <ReportView
      sheet={{
        filename: "Summary-Outstanding-Uang-Muka-Pembelian",
        sheet: "Uang Muka Outstanding",
        title: "Laporan Summary Outstanding Uang Muka Pembelian",
        subtitle: `Sampai ${day(todayIso())}`,
        columns: [
          text("No faktur", 18),
          date("Tanggal"),
          text("Supplier", 36),
          text("No PO", 18),
          text("No reff", 18),
          moneyCol("Total"),
          moneyCol("Uang muka diapply"),
          moneyCol("Sisa"),
        ],
        rows: rows.map((one) => [
          one.advance_number,
          one.advance_date,
          supplierName(one.supplier_id),
          one.po_number,
          one.reference,
          one.amount_minor,
          one.applied_minor,
          one.outstanding_minor,
        ]),
        totalRow: [
          "Total",
          null,
          null,
          null,
          null,
          sum(rows, (one) => one.amount_minor),
          sum(rows, (one) => one.applied_minor),
          sum(rows, (one) => one.outstanding_minor),
        ],
      }}
    />
  )
}

function ReturnsReport({ p }: { p: Params }) {
  const notes = useQuery({
    queryKey: financeKeys.creditNotes(
      null,
      p.supplier === "" ? null : p.supplier
    ),
    queryFn: ({ signal }) =>
      listCreditNotes(
        { supplier: p.supplier === "" ? undefined : p.supplier },
        signal
      ),
  })
  const supplierName = useSupplierName()
  const site = useSiteLabel()
  if (notes.isPending) return <LoadingState>Reading the returns…</LoadingState>
  const rows = (notes.data ?? [])
    .filter((note) => {
      const at = note.credit_date.slice(0, 10)
      return at >= p.from && at <= p.to
    })
    .filter(
      (note) =>
        (p.invoice.trim() === "" ||
          note.credit_number
            .toLowerCase()
            .includes(p.invoice.trim().toLowerCase()) ||
          note.invoice_number
            .toLowerCase()
            .includes(p.invoice.trim().toLowerCase())) &&
        (p.site === "" || note.site_id === p.site)
    )
    .sort((a, b) => a.credit_date.localeCompare(b.credit_date))
  return (
    <ReportView
      sheet={{
        filename: `Summary-Retur-Pembelian-${p.from}`,
        sheet: "Summary Retur",
        title: "Laporan Summary Retur Pembelian",
        subtitle: span(p),
        columns: [
          date("Tanggal"),
          text("No faktur", 18),
          text("Faktur diretur", 18),
          text("Supplier", 36),
          text("Gudang", 20),
          text("Status", 12),
          moneyCol("Total"),
        ],
        rows: rows.map((note) => [
          note.credit_date,
          note.credit_number,
          note.invoice_number,
          supplierName(note.supplier_id),
          site(note.site_id),
          noteStatus(note.status).word,
          note.total_minor,
        ]),
        totalRow: [
          "Total",
          null,
          null,
          null,
          null,
          null,
          sum(rows, (note) => note.total_minor),
        ],
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Hutang: 24 to 33
// ---------------------------------------------------------------------------

function PaymentsReport({ p }: { p: Params }) {
  // A report is drawn whole: every page of the window is read first.
  const { query, rows } = useSettlementLines(p.supplier, p.from, p.to, true)
  const supplierName = useSupplierName()
  if ((query.isPending && p.from <= p.to) || query.hasNextPage)
    return <LoadingState>Reading the payments…</LoadingState>
  return (
    <ReportView
      sheet={{
        filename: `Detail-Pelunasan-Nota-Pembelian-${p.from}`,
        sheet: "Pelunasan Nota",
        title: "Laporan Detail Pelunasan Nota Pembelian",
        subtitle: span(p),
        columns: [
          text("No faktur", 18),
          text("No voucher", 18),
          date("Tanggal"),
          text("Kas/Bank", 22),
          text("Supplier", 36),
          moneyCol("Nilai faktur"),
          moneyCol("Potongan"),
          moneyCol("Bayar"),
        ],
        rows: rows.map((line) => [
          line.invoice,
          line.voucher,
          line.date,
          line.bank,
          supplierName(line.supplierId, line.supplierName),
          line.invoiceTotal,
          line.discount,
          line.paid,
        ]),
        totalRow: [
          "Total",
          null,
          null,
          null,
          null,
          null,
          sum(rows, (line) => line.discount),
          sum(rows, (line) => line.paid),
        ],
      }}
    />
  )
}

/// 25, 30 and 31: every bill and delivery still open as at the day asked.
function OpenItemsReport({
  mode,
  p,
}: {
  mode: "due" | "umur" | "sisa"
  p: Params
}) {
  const { items, pending } = useOpenItems(p.asOf, p.unit)
  const supplierName = useSupplierName()
  if (pending) return <LoadingState>Working out what is owed…</LoadingState>
  const name = (id: string, given: string | null) => supplierName(id, given)
  const rows = items
    .filter((item) => p.supplier === "" || item.supplierId === p.supplier)
    .filter(
      (item) => mode !== "due" || (item.due !== null && item.due <= p.asOf)
    )
    .slice()
    .sort(
      (a, b) =>
        name(a.supplierId, a.supplierName).localeCompare(
          name(b.supplierId, b.supplierName)
        ) || a.date.localeCompare(b.date)
    )
  const subtitle = `Per ${day(p.asOf)}`
  if (mode === "umur") {
    // Aged by days past due: the same five bands as the ageing report.
    const band = (age: number) =>
      age <= 0 ? 0 : age <= 30 ? 1 : age <= 60 ? 2 : age <= 90 ? 3 : 4
    return (
      <ReportView
        sheet={{
          filename: `Umur-Hutang-Per-Faktur-${p.asOf}`,
          sheet: "Umur Hutang Per Faktur",
          title: "Umur Hutang Dagang Per Supplier Per Faktur",
          subtitle,
          columns: [
            text("Supplier", 36),
            text("No faktur", 18),
            date("Tanggal"),
            date("JTempo"),
            moneyCol("Sisa"),
            ...AGEING_BUCKETS.map((one) => moneyCol(one.short)),
          ],
          rows: rows.map((item) => [
            name(item.supplierId, item.supplierName),
            item.number,
            item.date,
            item.due,
            item.left,
            ...AGEING_BUCKETS.map((_, at) =>
              band(item.age) === at ? item.left : 0
            ),
          ]),
          totalRow: [
            "Total",
            null,
            null,
            null,
            sum(rows, (item) => item.left),
            ...AGEING_BUCKETS.map((_, at) =>
              sum(rows, (item) => (band(item.age) === at ? item.left : 0))
            ),
          ],
        }}
      />
    )
  }
  return (
    <ReportView
      sheet={{
        filename: `${mode === "due" ? "Hutang-Jatuh-Tempo" : "Sisa-Hutang-Per-Supplier"}-${p.asOf}`,
        sheet: mode === "due" ? "Hutang Jatuh Tempo" : "Sisa Hutang",
        title:
          mode === "due"
            ? "Hutang Jatuh Tempo"
            : "Sisa Hutang Dagang per Supplier",
        subtitle,
        columns: [
          text("Supplier", 36),
          text("No faktur", 18),
          date("Tanggal"),
          date("JTempo"),
          ...(mode === "due" ? [num("Terlambat (hari)")] : []),
          moneyCol("Total"),
          moneyCol("Bayar"),
          moneyCol("Sisa"),
        ],
        rows: rows.map((item) => [
          name(item.supplierId, item.supplierName),
          item.number,
          item.date,
          item.due,
          ...(mode === "due" ? [Math.max(0, item.age)] : []),
          item.total,
          item.paid,
          item.left,
        ]),
        totalRow: [
          "Total",
          null,
          null,
          null,
          ...(mode === "due" ? [null] : []),
          sum(rows, (item) => item.total),
          sum(rows, (item) => item.paid),
          sum(rows, (item) => item.left),
        ],
      }}
    />
  )
}

/// 29 and 32: what each supplier is owed as at the day — the server's ageing.
function AgingReport({ mode, p }: { mode: "sisa" | "umur"; p: Params }) {
  const aging = useQuery(
    payablesAgingQuery(p.asOf, p.unit === "" ? null : p.unit)
  )
  const supplierName = useSupplierName()
  if (aging.isPending)
    return <LoadingState>Working out what is owed…</LoadingState>
  const data = aging.data
  const rows = data?.suppliers ?? []
  const subtitle = `Per ${day(p.asOf)}`
  if (mode === "sisa") {
    return (
      <ReportView
        sheet={{
          filename: `Sisa-Hutang-Dagang-${p.asOf}`,
          sheet: "Sisa Hutang Dagang",
          title: "Sisa Hutang Dagang",
          subtitle,
          columns: [
            text("Supplier", 36),
            text("Kode", 14),
            moneyCol("Sisa hutang"),
          ],
          rows: rows.map((row) => [
            supplierName(row.supplier_id, row.supplier_name),
            row.supplier_id,
            row.buckets.total_minor,
          ]),
          totalRow: ["Total", null, data?.total.total_minor ?? 0],
        }}
      />
    )
  }
  return (
    <ReportView
      sheet={{
        filename: `Umur-Hutang-${p.asOf}`,
        sheet: "Umur Hutang",
        title: "Umur Hutang",
        subtitle,
        columns: [
          text("Supplier", 36),
          num("Faktur"),
          ...AGEING_BUCKETS.map((one) => moneyCol(one.short)),
          moneyCol("Total"),
        ],
        rows: rows.map((row) => [
          supplierName(row.supplier_id, row.supplier_name),
          row.open_document_count,
          ...AGEING_BUCKETS.map((one) => row.buckets[one.key]),
          row.buckets.total_minor,
        ]),
        totalRow:
          data === undefined
            ? undefined
            : [
                "Total",
                sum(rows, (row) => row.open_document_count),
                ...AGEING_BUCKETS.map((one) => data.total[one.key]),
                data.total.total_minor,
              ],
      }}
    />
  )
}

/// 26 and 27: the supplier ledgers over a window, added across suppliers —
/// per supplier (26) or per day (27).
function BalancesReport({
  mode,
  p,
}: {
  mode: "periode" | "tanggal"
  p: Params
}) {
  const book = useSupplierMovements(p.from, p.to, p.unit)
  const supplierName = useSupplierName()
  if (book.pending) return <LoadingState>Reading the ledgers…</LoadingState>
  const ledgers = book.rows.flatMap((one) =>
    one.movements === undefined ? [] : [{ ...one, m: one.movements }]
  )
  if (mode === "periode") {
    const rows = ledgers.filter(
      ({ m }) =>
        m.opening_minor !== 0 ||
        m.debit_minor !== 0 ||
        m.credit_minor !== 0 ||
        m.closing_minor !== 0
    )
    return (
      <ReportView
        sheet={{
          filename: `Summary-Hutang-Dagang-${p.from}`,
          sheet: "Summary Hutang Dagang",
          title: "Summary Hutang Dagang",
          subtitle: span(p),
          columns: [
            text("Supplier", 36),
            text("Kode", 14),
            moneyCol("Saldo awal"),
            moneyCol("Debet"),
            moneyCol("Kredit"),
            moneyCol("Saldo akhir"),
          ],
          rows: rows.map(({ code, m }) => [
            supplierName(code),
            code,
            m.opening_minor,
            m.debit_minor,
            m.credit_minor,
            m.closing_minor,
          ]),
          totalRow: [
            "Total",
            null,
            sum(rows, ({ m }) => m.opening_minor),
            sum(rows, ({ m }) => m.debit_minor),
            sum(rows, ({ m }) => m.credit_minor),
            sum(rows, ({ m }) => m.closing_minor),
          ],
        }}
      />
    )
  }
  // Per day: what was bought on credit, what was paid, and where it left the
  // total owed. Cash purchases do not appear — a purchase here is always a
  // payable first.
  const days = new Map<string, { credit: number; debit: number }>()
  for (const { m } of ledgers)
    for (const row of m.rows) {
      const one = days.get(row.posting_date) ?? { credit: 0, debit: 0 }
      one.credit += row.credit_minor
      one.debit += row.debit_minor
      days.set(row.posting_date, one)
    }
  const opening = sum(ledgers, ({ m }) => m.opening_minor)
  const lines: ExportCell[][] = []
  let running = opening
  for (const [at, one] of [...days.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    running += one.credit - one.debit
    lines.push([at, one.credit, one.debit, running])
  }
  return (
    <ReportView
      sheet={{
        filename: `Summary-Hutang-Dagang-Per-Tanggal-${p.from}`,
        sheet: "Hutang Per Tanggal",
        title: "Summary Hutang Dagang Per Tanggal",
        subtitle: `${span(p)} · saldo awal ${money(opening)}`,
        columns: [
          date("Tanggal"),
          moneyCol("Pembelian kredit"),
          moneyCol("Pelunasan"),
          moneyCol("Saldo akhir"),
        ],
        rows: lines,
        totalRow: [
          "Total",
          sum(ledgers, ({ m }) => m.credit_minor),
          sum(ledgers, ({ m }) => m.debit_minor),
          sum(ledgers, ({ m }) => m.closing_minor),
        ],
      }}
    />
  )
}

/// 28: one supplier's ledger over a window.
function KartuReport({ p }: { p: Params }) {
  const supplierName = useSupplierName()
  const ledger = useQuery({
    queryKey: financeKeys.partyMovements(
      "SUPPLIER",
      p.supplier,
      p.from,
      p.to,
      p.unit === "" ? null : p.unit
    ),
    queryFn: ({ signal }) =>
      partyMovements(
        "SUPPLIER",
        p.supplier,
        { from: p.from, to: p.to, unit: p.unit === "" ? undefined : p.unit },
        signal
      ),
    enabled: p.supplier !== "" && p.from <= p.to,
  })
  if (p.supplier === "")
    return <EmptyState>Choose a supplier to read its ledger.</EmptyState>
  if (ledger.isPending) return <LoadingState>Reading the ledger…</LoadingState>
  const data = ledger.data
  if (data === undefined) return null
  return (
    <ReportView
      sheet={{
        filename: `Kartu-Hutang-${p.supplier}-${p.from}`,
        sheet: "Kartu Hutang",
        title: `Kartu Hutang · ${supplierName(p.supplier)}`,
        subtitle: span(p),
        columns: [
          date("Tanggal"),
          text("No transaksi", 18),
          text("Transaksi", 24),
          moneyCol("Debet"),
          moneyCol("Kredit"),
          moneyCol("Saldo akhir"),
          text("Keterangan", 40),
        ],
        rows: [
          [data.from, null, "Saldo awal", null, null, data.opening_minor, null],
          ...data.rows.map((row): ExportCell[] => [
            row.posting_date,
            row.entry_number,
            row.source_kind
              .toLowerCase()
              .replace(/_/g, " ")
              .replace(/^./, (c) => c.toUpperCase()),
            row.debit_minor === 0 ? null : row.debit_minor,
            row.credit_minor === 0 ? null : row.credit_minor,
            row.balance_minor,
            row.memo,
          ]),
        ],
        totalRow: [
          "Total",
          null,
          null,
          data.debit_minor,
          data.credit_minor,
          data.closing_minor,
          null,
        ],
      }}
    />
  )
}

function SupplierListReport() {
  const suppliers = useSuppliers()
  if (suppliers.isPending)
    return <LoadingState>Reading the suppliers…</LoadingState>
  const rows = [...(suppliers.data ?? [])].sort((a, b) =>
    a.supplier_code.localeCompare(b.supplier_code)
  )
  return (
    <ReportView
      sheet={{
        filename: "List-Supplier",
        sheet: "List Supplier",
        title: "List Supplier",
        subtitle: `${count(rows.length)} suppliers`,
        columns: [
          text("Kode supplier", 16),
          text("Supplier", 36),
          text("Alamat", 40),
          text("Phone", 18),
          text("Kontak", 20),
          text("Jangka", 14),
          text("Aktif", 10),
        ],
        rows: rows.map((one) => [
          one.supplier_code,
          supplierDisplayName(one),
          one.address,
          one.phone,
          one.contact_name,
          one.default_payment_terms_code,
          one.status === "ACTIVE" ? "Active" : "Inactive",
        ]),
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Reports the data cannot fill yet
// ---------------------------------------------------------------------------

/// 7Soft's columns, empty: the report exists and says what it prints, and
/// every cell reads "—" until the hub carries the fact behind it.
function PendingReport({ columns }: { columns: readonly string[] }) {
  return (
    <Grid>
      <thead>
        <tr>
          {columns.map((column) => (
            <Th key={column}>{column}</Th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {columns.map((column) => (
            <Td key={column}>
              <span className="text-faint">—</span>
            </Td>
          ))}
        </tr>
      </tbody>
    </Grid>
  )
}

// ---------------------------------------------------------------------------
// Items bought: 1, 4, 6 to 9
// ---------------------------------------------------------------------------

/// The most faktur whose item lines one of these reports reads: each is its own
/// request, so a window with more says how many it drew.
const ITEM_FAKTUR_LIMIT = 100

/// The item lines of the faktur in the window, one request per faktur. 7Soft's
/// four item reports are this list grouped four ways: by faktur (1, 4), by
/// item with its suppliers (6, 8) and by supplier with its items (7, 9).
function ItemsReport({
  mode,
  title,
  p,
}: {
  mode: "detail" | "item" | "supplier"
  title: string
  p: Params
}) {
  const bills = useBillsInWindow("", p.from, p.to)
  const supplierName = useSupplierName()
  const shown = bills.rows
    .filter((bill) => p.jenis === "" || bill.kind === p.jenis)
    .slice(0, ITEM_FAKTUR_LIMIT)
  const lines = useQueries({
    queries: shown.map((bill) => ({
      queryKey: [...financeKeys.bill(bill.invoice_id), "lines"],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        billItemLines(bill.invoice_id, signal),
      staleTime: 60_000,
    })),
  })
  if (!bills.complete || lines.some((one) => one.isPending))
    return <LoadingState>Reading the item lines…</LoadingState>
  const rows = shown
    .flatMap((bill, index) =>
      (lines[index].data ?? []).map((line) => ({
        date: bill.invoice_date,
        invoice: bill.invoice_number,
        supplier: supplierName(bill.supplier_id, bill.supplier_name),
        supplierId: bill.supplier_id,
        code: line.article_code ?? "",
        name: line.description,
        quantity: line.quantity,
        price: line.unit_price_minor,
        total: line.line_amount_minor,
      }))
    )
    .sort((a, b) => a.date.localeCompare(b.date))
  const subtitle =
    bills.rows.length > shown.length
      ? `${span(p)} · ${count(shown.length)} of ${count(bills.rows.length)} faktur`
      : span(p)
  const slug = title.replace(/\s+/g, "-")

  if (mode === "detail")
    return (
      <ReportView
        sheet={{
          filename: `${slug}-${p.from}`,
          sheet: "Pembelian Item",
          title,
          subtitle,
          columns: [
            date("Tanggal"),
            text("No faktur", 18),
            text("Supplier", 36),
            text("Kode item", 16),
            text("Nama item", 40),
            num("Jml"),
            moneyCol("Harga"),
            moneyCol("Total"),
          ],
          rows: rows.map((row) => [
            row.date,
            row.invoice,
            row.supplier,
            row.code,
            row.name,
            row.quantity,
            row.price,
            row.total,
          ]),
          totalRow: [
            "Total",
            null,
            null,
            null,
            null,
            sum(rows, (row) => row.quantity),
            null,
            sum(rows, (row) => row.total),
          ],
        }}
      />
    )

  const group = new Map<
    string,
    {
      label: string
      code: string
      names: Set<string>
      suppliers: Set<string>
      items: Set<string>
      quantity: number
      total: number
    }
  >()
  for (const row of rows) {
    const key = mode === "item" ? `${row.code}|${row.name}` : row.supplierId
    const one = group.get(key) ?? {
      label: mode === "item" ? row.name : row.supplier,
      code: mode === "item" ? row.code : row.supplierId,
      names: new Set<string>(),
      suppliers: new Set<string>(),
      items: new Set<string>(),
      quantity: 0,
      total: 0,
    }
    one.suppliers.add(row.supplier)
    one.items.add(row.name)
    one.quantity += row.quantity
    one.total += row.total
    group.set(key, one)
  }
  const grouped = [...group.values()].sort((a, b) => b.total - a.total)
  return (
    <ReportView
      sheet={{
        filename: `${slug}-${p.from}`,
        sheet: mode === "item" ? "Per Item" : "Per Supplier",
        title,
        subtitle,
        columns:
          mode === "item"
            ? [
                text("Kode item", 16),
                text("Nama item", 40),
                num("Jml"),
                moneyCol("Total"),
                text("Supplier", 48),
              ]
            : [
                text("Kode supplier", 16),
                text("Supplier", 36),
                num("Item"),
                num("Jml"),
                moneyCol("Total"),
              ],
        rows: grouped.map((one) =>
          mode === "item"
            ? [
                one.code,
                one.label,
                one.quantity,
                one.total,
                [...one.suppliers].join(", "),
              ]
            : [one.code, one.label, one.items.size, one.quantity, one.total]
        ),
        totalRow:
          mode === "item"
            ? [
                "Total",
                null,
                sum(grouped, (one) => one.quantity),
                sum(grouped, (one) => one.total),
                null,
              ]
            : [
                "Total",
                null,
                null,
                sum(grouped, (one) => one.quantity),
                sum(grouped, (one) => one.total),
              ],
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Orders: 17, 20, 21
// ---------------------------------------------------------------------------

const ORDER_STATE: Readonly<Record<string, string>> = {
  ACTIVE: "NEW",
  PARTIALLY_RECEIVED: "PARTIAL",
  FULLY_RECEIVED: "COMPLETE",
  CLOSED: "CLOSED",
}

/// The order book as 7Soft's PO reports read it: every order of the window
/// (17), the ones still owing pieces (20), and ordered against received and
/// invoiced (21).
function OrdersReport({
  mode,
  p,
}: {
  mode: "summary" | "outstanding" | "realisasi"
  p: Params
}) {
  const orders = useQuery({
    queryKey: [
      "finance",
      "purchasing-reports",
      "orders",
      mode === "realisasi" ? "" : p.from,
      mode === "realisasi" ? "" : p.to,
    ],
    queryFn: ({ signal }) =>
      listPurchaseOrders(
        mode === "realisasi" ? {} : { issuedFrom: p.from, issuedTo: p.to },
        signal
      ),
  })
  const site = useSiteLabel()
  if (orders.isPending) return <LoadingState>Reading the orders…</LoadingState>
  const rows = (orders.data ?? []).filter(
    (one) =>
      mode !== "outstanding" ||
      (one.outstanding_stock_units > 0 && one.lifecycle !== "CLOSED")
  )
  const state = (lifecycle: string) => ORDER_STATE[lifecycle] ?? lifecycle
  if (mode === "summary")
    return (
      <ReportView
        sheet={{
          filename: `Summary-PO-${p.from}`,
          sheet: "Summary PO",
          title: "Laporan Summary PO",
          subtitle: span(p),
          columns: [
            date("Tanggal"),
            text("No PO", 18),
            text("Supplier", 36),
            text("Lokasi", 14),
            text("No ref", 14),
            text("Kirim ke", 28),
            date("Tanggal datang"),
            text("Keterangan", 24),
            moneyCol("Total"),
            text("Status", 12),
          ],
          rows: rows.map((one) => [
            one.issued_at,
            one.po_number,
            one.supplier_name ?? one.supplier_id,
            "—",
            "—",
            site(one.destination_site_id),
            one.expected_arrival,
            "—",
            one.net_minor,
            state(one.lifecycle),
          ]),
          totalRow: [
            "Total",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            sum(rows, (one) => one.net_minor),
            null,
          ],
        }}
      />
    )
  if (mode === "outstanding")
    return (
      <ReportView
        sheet={{
          filename: `PO-Outstanding-${p.from}`,
          sheet: "PO Outstanding",
          title: "PO Outstanding",
          subtitle: span(p),
          columns: [
            date("Tanggal"),
            text("No PO", 18),
            text("Supplier", 36),
            text("Kirim ke", 28),
            date("Tanggal datang"),
            num("Jml PO"),
            num("Diterima"),
            num("Outstanding"),
            moneyCol("Total"),
          ],
          rows: rows.map((one) => [
            one.issued_at,
            one.po_number,
            one.supplier_name ?? one.supplier_id,
            site(one.destination_site_id),
            one.expected_arrival,
            one.expected_stock_units,
            one.received_stock_units,
            one.outstanding_stock_units,
            one.net_minor,
          ]),
          totalRow: [
            "Total",
            null,
            null,
            null,
            null,
            sum(rows, (one) => one.expected_stock_units),
            sum(rows, (one) => one.received_stock_units),
            sum(rows, (one) => one.outstanding_stock_units),
            sum(rows, (one) => one.net_minor),
          ],
        }}
      />
    )
  return (
    <ReportView
      sheet={{
        filename: "Realisasi-PO",
        sheet: "Realisasi PO",
        title: "Laporan Realisasi PO",
        subtitle: `${count(rows.length)} PO`,
        columns: [
          date("Tanggal"),
          text("No PO", 18),
          text("Supplier", 36),
          num("Jml PO"),
          num("Diterima"),
          num("Diinvoice"),
          num("Sisa PO"),
          moneyCol("Nilai diterima"),
          text("Status", 12),
        ],
        rows: rows.map((one) => [
          one.issued_at,
          one.po_number,
          one.supplier_name ?? one.supplier_id,
          one.expected_stock_units,
          one.received_stock_units,
          one.invoiced_stock_units,
          one.outstanding_stock_units,
          one.received_value_minor,
          state(one.lifecycle),
        ]),
        totalRow: [
          "Total",
          null,
          null,
          sum(rows, (one) => one.expected_stock_units),
          sum(rows, (one) => one.received_stock_units),
          sum(rows, (one) => one.invoiced_stock_units),
          sum(rows, (one) => one.outstanding_stock_units),
          sum(rows, (one) => one.received_value_minor),
          null,
        ],
      }}
    />
  )
}

/// 23: what went back to each supplier, article by article — the supplier
/// returns' own lines, valued at the cost they carry.
function ReturnLinesReport({ p }: { p: Params }) {
  const returns = useQuery({
    queryKey: supplierReturnKeys.list(),
    queryFn: ({ signal }) => supplierReturns(signal),
    retry: false,
  })
  const supplierName = useSupplierName()
  if (returns.isPending)
    return <LoadingState>Reading the returns…</LoadingState>
  const rows = (returns.data ?? []).flatMap((one) =>
    one.lines.map((line) => ({
      date: one.raised_at,
      number: one.allotment_number,
      supplier: supplierName(one.supplier_id, one.supplier_name),
      status: one.status,
      code: line.article_code,
      name: line.article_name ?? line.article_code,
      quantity: line.quantity,
      price: line.unit_cost_minor,
    }))
  )
  return (
    <ReportView
      sheet={{
        filename: "Detail-Retur-Pembelian",
        sheet: "Detail Retur",
        title: "Laporan Detail Retur Pembelian",
        subtitle: `${count(rows.length)} item`,
        columns: [
          date("Tanggal"),
          text("No retur", 18),
          text("Supplier", 36),
          text("Status", 16),
          text("Kode item", 16),
          text("Nama item", 40),
          num("Jml"),
          moneyCol("Harga"),
          moneyCol("Subtotal"),
        ],
        rows: rows.map((row) => [
          row.date,
          row.number,
          row.supplier,
          row.status,
          row.code,
          row.name,
          row.quantity,
          row.price,
          row.quantity * row.price,
        ]),
        totalRow: [
          "Total",
          null,
          null,
          null,
          null,
          null,
          sum(rows, (row) => row.quantity),
          null,
          sum(rows, (row) => row.quantity * row.price),
        ],
      }}
    />
  )
}
