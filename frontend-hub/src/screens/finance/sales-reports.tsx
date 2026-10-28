import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useNavigate } from "@tanstack/react-router"
import { Printer } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { BarSeries } from "@/components/ui/chart"
import { DataTable } from "@/components/ui/data-table"
import { DayRange, type DayWindow } from "@/components/ui/day-range"
import { ExportButton } from "@/components/ui/export-button"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count, day, dateText, money, monthYear } from "@/lib/format"
import { fileSafe, type ExportKind, type ExportSheet } from "@/lib/export-xlsx"
import {
  analyticsKeys,
  salesSeries,
  type WindowTransaction,
} from "@/lib/queries/analytics"
import { useSiteLabel } from "@/lib/queries/organisation"
import type { ReturnRow } from "@/lib/queries/storeops"
import { tableSetup, type TableSetup } from "@/lib/table"
import { explorerRowsQuery } from "@/screens/sales/explorer-data"
import { Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { isoDay, todayIso } from "@/screens/finance/chart"
import { useWindow } from "@/screens/finance/hooks"
import { SiteSelect } from "@/screens/finance/parts"
import {
  customerCode,
  useReadOn,
  useReceipts,
  useReturns,
} from "@/screens/finance/sales-data"
import { NotaSheet } from "@/screens/finance/sales-info"
import { ReturnSheet } from "@/screens/finance/sales-returns"

/// Laporan Penjualan (7Soft 5.8, manual hal. 164-173).
///
/// 7Soft shows a numbered list of reports; pressing one asks for its
/// selection (Tanggal, Periode, No Faktur, Customer, Sales, Gudang) and OK
/// draws the report under the list. The numbers below are 7Soft's own, so a
/// clerk who says "laporan 7" finds the same report. The reports kept are the
/// ones a till that sells for cash has: the receipt reports, the returns, the
/// month and the PPN. The ones about Surat Jalan, SO, Uang Muka, Piutang,
/// commission and customer-by-customer sales belong to selling on credit and
/// are not here. Jenis Item is not on the sales wire, so it is not asked.
///
/// Sales by Division (the hub's own) stays one press away at the foot of the
/// list.

type ReportId =
  | "detail-item"
  | "summary"
  | "reprint"
  | "nota"
  | "rekap"
  | "user"
  | "monthly"
  | "ppn"
  | "city"
  | "retur-summary"
  | "retur-detail"

type Param = "date" | "period" | "faktur" | "customer" | "sales" | "gudang"

interface Report {
  readonly no: number
  readonly id: ReportId
  readonly name: string
  readonly note: string
  readonly params: readonly Param[]
}

const REPORTS: readonly Report[] = [
  {
    no: 1,
    id: "detail-item",
    name: "Laporan Harian Detail Penjualan Item",
    note: "Barang (Plus Retur)",
    params: ["date", "gudang"],
  },
  {
    no: 2,
    id: "summary",
    name: "Summary Penjualan",
    note: "",
    params: ["date", "faktur", "customer", "gudang"],
  },
  {
    no: 3,
    id: "reprint",
    name: "Cetak Invoice Penjualan",
    note: "Cetak Ulang Nota Penjualan",
    params: ["date", "faktur", "gudang"],
  },
  {
    no: 4,
    id: "nota",
    name: "Laporan Nota Penjualan",
    note: "",
    params: ["date", "gudang"],
  },
  {
    no: 5,
    id: "rekap",
    name: "Rekap Detail Faktur Penjualan",
    note: "",
    params: ["date", "gudang"],
  },
  {
    no: 7,
    id: "user",
    name: "Laporan Penjualan Tiap User",
    note: "Untuk POS, Omzet Tiap Operator",
    params: ["date", "gudang"],
  },
  {
    no: 8,
    id: "monthly",
    name: "Laporan Penjualan Bulanan",
    note: "Penjualan Selama 1 Tahun + Grafik",
    params: ["period", "gudang"],
  },
  {
    no: 9,
    id: "ppn",
    name: "Summary Penjualan PPN",
    note: "",
    params: ["date", "gudang"],
  },
  {
    no: 28,
    id: "city",
    name: "Laporan Omset Penjualan Per Kota",
    note: "",
    params: ["date"],
  },
  {
    no: 33,
    id: "retur-summary",
    name: "Laporan Summary Retur Penjualan",
    note: "",
    params: ["date", "faktur", "gudang"],
  },
  {
    no: 34,
    id: "retur-detail",
    name: "Laporan Detail Retur Penjualan",
    note: "",
    params: ["date", "gudang"],
  },
]

interface Params {
  readonly from: string
  readonly to: string
  /// `YYYY-MM`: the last month of the year Laporan Penjualan Bulanan shows.
  readonly period: string
  readonly faktur: string
  readonly customer: string
  readonly sales: string
  readonly gudang: string
}

const PARAM_WORD: Record<Param, string> = {
  date: "Tanggal",
  period: "Periode",
  faktur: "No Faktur",
  customer: "Customer",
  sales: "Sales",
  gudang: "Gudang",
}

const listColumns: ColumnDef<TableSetup, Report>[] = [
  {
    id: "no",
    accessorFn: (row) => row.no,
    header: "No",
    size: 80,
    enableSorting: false,
    meta: { align: "right", card: "id" },
    cell: ({ row }) => <span className="text-mute">{row.original.no}</span>,
  },
  {
    id: "name",
    accessorFn: (row) => row.name,
    header: "Laporan",
    size: 420,
    enableSorting: false,
    meta: { card: "title", grow: 320 },
    cell: ({ row }) => <span className="text-ink">{row.original.name}</span>,
  },
  {
    id: "note",
    accessorFn: (row) => row.note,
    header: "Keterangan",
    size: 360,
    enableSorting: false,
    meta: { card: "meta", grow: 260 },
    cell: ({ row }) =>
      row.original.note === "" ? (
        <span className="text-faint">—</span>
      ) : (
        row.original.note
      ),
  },
]

const monthStart = (period: string) => `${period}-01`
const monthEnd = (period: string) => {
  const end = new Date(`${period}-01T00:00:00`)
  end.setMonth(end.getMonth() + 1)
  end.setDate(0)
  return isoDay(end)
}

export function LaporanPenjualan() {
  const range = useWindow()
  const navigate = useNavigate()
  const [asking, setAsking] = useState<Report | null>(null)
  const [draft, setDraft] = useState<Params | null>(null)
  const [shown, setShown] = useState<{
    report: Report
    params: Params
  } | null>(null)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: REPORTS as Report[],
        columns: listColumns,
        getRowId: (row: Report) => String(row.no),
      }),
      []
    )
  )

  const ask = (report: Report) => {
    setAsking(report)
    setDraft(
      shown !== null
        ? { ...shown.params }
        : {
            from: range.from,
            to: range.to,
            period: todayIso().slice(0, 7),
            faktur: "",
            customer: "",
            sales: "",
            gudang: "",
          }
    )
  }

  return (
    <PageContent>
      <PageHeader crumb="Finance · Laporan" title="Laporan Penjualan" />
      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <DataTable<Report>
          table={table}
          onRowClick={ask}
          pageScroll
          cardSort={false}
          cardsApart
          cardLead
        />
      </Card>
      <div className="mt-3">
        <Button
          variant="primary"
          onClick={() =>
            void navigate({ to: "/finance/reports/sales-by-division" } as never)
          }
        >
          Summary Penjualan per Divisi
        </Button>
      </div>

      <Sheet
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        id={asking === null ? undefined : String(asking.no)}
        title={asking?.name ?? "Laporan"}
        size="rail"
        footer={
          <Button
            variant="primary"
            onClick={() => {
              if (asking !== null && draft !== null) {
                // Only what this report asks is kept: a No Faktur typed for
                // another report must not narrow this one unseen.
                const has = (param: Param) => asking.params.includes(param)
                setShown({
                  report: asking,
                  params: {
                    ...draft,
                    faktur: has("faktur") ? draft.faktur : "",
                    customer: has("customer") ? draft.customer : "",
                    sales: has("sales") ? draft.sales : "",
                    gudang: has("gudang") ? draft.gudang : "",
                  },
                })
                setAsking(null)
              }
            }}
          >
            OK
          </Button>
        }
      >
        {asking !== null && draft !== null && (
          <ParamForm
            report={asking}
            value={draft}
            onChange={setDraft}
            months={months()}
          />
        )}
      </Sheet>

      {shown !== null && (
        <div className="mt-8">
          <ReportBody
            key={`${shown.report.id}:${JSON.stringify(shown.params)}`}
            report={shown.report}
            params={shown.params}
          />
        </div>
      )}
    </PageContent>
  )
}

/// The last 24 months, newest first, as `YYYY-MM`.
function months(): string[] {
  const out: string[] = []
  const at = new Date()
  at.setDate(1)
  for (let back = 0; back < 24; back += 1) {
    out.push(isoDay(at).slice(0, 7))
    at.setMonth(at.getMonth() - 1)
  }
  return out
}

function ParamForm({
  report,
  value,
  onChange,
  months: choices,
}: {
  report: Report
  value: Params
  onChange: (value: Params) => void
  months: readonly string[]
}) {
  const set = (patch: Partial<Params>) => onChange({ ...value, ...patch })
  const span: DayWindow = { from: value.from, to: value.to }
  return (
    <div className="flex flex-col gap-6">
      {report.params.map((param) => {
        switch (param) {
          case "date":
            return (
              <Field key={param} label={PARAM_WORD[param]}>
                <DayRange
                  label={PARAM_WORD[param]}
                  value={span}
                  onChange={(next) => set({ from: next.from, to: next.to })}
                  className="h-control min-h-0 w-full py-0"
                />
              </Field>
            )
          case "period":
            return (
              <Field key={param} label={PARAM_WORD[param]}>
                <Select
                  value={value.period}
                  onChange={(period) => set({ period })}
                  aria-label={PARAM_WORD[param]}
                >
                  {choices.map((month) => (
                    <option key={month} value={month}>
                      {monthYear(monthStart(month))}
                    </option>
                  ))}
                </Select>
              </Field>
            )
          case "gudang":
            return (
              <Field key={param} label={PARAM_WORD[param]}>
                <SiteSelect
                  value={value.gudang}
                  onChange={(gudang) => set({ gudang })}
                  emptyLabel="All"
                  aria-label={PARAM_WORD[param]}
                />
              </Field>
            )
          case "faktur":
            return (
              <Field key={param} label={PARAM_WORD[param]}>
                <Input
                  value={value.faktur}
                  onChange={(event) => set({ faktur: event.target.value })}
                />
              </Field>
            )
          case "customer":
            return (
              <Field key={param} label={PARAM_WORD[param]}>
                <Input
                  value={value.customer}
                  onChange={(event) => set({ customer: event.target.value })}
                />
              </Field>
            )
          case "sales":
            return (
              <Field key={param} label={PARAM_WORD[param]}>
                <Input
                  value={value.sales}
                  onChange={(event) => set({ sales: event.target.value })}
                />
              </Field>
            )
        }
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The report drawn under the list
// ---------------------------------------------------------------------------

/// A column of a report: its heading, how it is exported, and what is drawn.
interface Col<T> {
  readonly head: string
  readonly kind: ExportKind
  readonly value: (row: T) => string | number | null
  /// Drawn in place of the plain value, for a name that needs a lookup.
  readonly show?: (row: T) => React.ReactNode
}

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .report-print, .report-print * { visibility: visible !important; }
  .report-print { position: absolute !important; left: 0; top: 0; right: 0; }
  .report-print .report-noprint { display: none !important; }
  @page { margin: 14mm; }
}
`

function shownValue<T>(col: Col<T>, row: T): React.ReactNode {
  if (col.show !== undefined) return col.show(row)
  const value = col.value(row)
  if (value === null || value === "")
    return <span className="text-faint">—</span>
  if (col.kind === "money") return money(value as number)
  if (col.kind === "number") return count(value as number)
  if (col.kind === "date") return day(value as string)
  return value
}

/// 7Soft's report page: the name and the period over the table, the total
/// under it, and Print and XLS.
function ReportTable<T>({
  report,
  period,
  cols,
  rows,
  foot,
  onOpen,
  siteName,
  chart,
}: {
  report: Report
  period: string
  cols: readonly Col<T>[]
  rows: readonly T[]
  /// The closing line, one cell per column; `undefined` leaves a cell blank.
  foot?: readonly (string | number | null | undefined)[]
  onOpen?: (row: T) => void
  siteName: string
  chart?: React.ReactNode
}) {
  const build = (): ExportSheet => ({
    filename: `${fileSafe(report.name)}-${fileSafe(period)}`,
    sheet: report.name.slice(0, 31).replace(/[\\/?*[\]:]/g, " "),
    title: report.name,
    subtitle: `${period} · ${siteName}`,
    columns: cols.map((col) => ({ header: col.head, kind: col.kind })),
    rows: rows.map((row) => cols.map((col) => col.value(row))),
    totalRow: foot === undefined ? undefined : foot.map((cell) => cell ?? null),
  })
  const numeric = (col: Col<T>) => col.kind === "money" || col.kind === "number"
  return (
    <div className="report-print flex flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[1.0625rem] font-semibold text-ink">
            {report.name}
          </h2>
          <p className="text-[0.9375rem] text-mute">
            {period} · {siteName}
          </p>
        </div>
        <div className="report-noprint flex gap-2">
          <Button variant="primary" onClick={() => window.print()}>
            <Printer />
            Print
          </Button>
          <ExportButton build={build} disabled={rows.length === 0} />
        </div>
      </div>
      {chart}
      {rows.length === 0 ? (
        <Card>
          <EmptyState>Nothing in this report.</EmptyState>
        </Card>
      ) : (
        <Grid>
          <thead>
            <tr>
              {cols.map((col) => (
                <Th key={col.head} align={numeric(col) ? "right" : undefined}>
                  {col.head}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={index}
                onClick={onOpen === undefined ? undefined : () => onOpen(row)}
                className={onOpen === undefined ? undefined : "cursor-pointer"}
              >
                {cols.map((col) => (
                  <Td key={col.head} align={numeric(col) ? "right" : undefined}>
                    {shownValue(col, row)}
                  </Td>
                ))}
              </tr>
            ))}
            {foot !== undefined && (
              <TotalRow>
                {cols.map((col, index) => {
                  const cell = foot[index]
                  return (
                    <Td
                      key={col.head}
                      align={numeric(col) ? "right" : undefined}
                    >
                      {cell === undefined || cell === null
                        ? ""
                        : typeof cell === "number"
                          ? col.kind === "money"
                            ? money(cell)
                            : count(cell)
                          : cell}
                    </Td>
                  )
                })}
              </TotalRow>
            )}
          </tbody>
        </Grid>
      )}
    </div>
  )
}

function periodOf(params: Params, report: Report): string {
  return report.id === "monthly"
    ? `12 bulan s/d ${monthYear(monthStart(params.period))}`
    : `${day(params.from)} – ${day(params.to)}`
}

function ReportBody({ report, params }: { report: Report; params: Params }) {
  switch (report.id) {
    case "detail-item":
      return <ItemReport report={report} params={params} />
    case "monthly":
      return <MonthlyReport report={report} params={params} />
    case "retur-summary":
    case "retur-detail":
      return <ReturnReport report={report} params={params} />
    default:
      return <SalesReport report={report} params={params} />
  }
}

const sum = <T,>(rows: readonly T[], of: (row: T) => number) =>
  rows.reduce((total, row) => total + of(row), 0)

/// The rows grouped by their local day, oldest first.
function perDay<T>(rows: readonly T[], dayOf: (row: T) => string) {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = dayOf(row)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

const dayOfSale = (sale: WindowTransaction) =>
  (sale.completed_at ?? "").slice(0, 10)

// ---- The receipt reports ---------------------------------------------------

function SalesReport({ report, params }: { report: Report; params: Params }) {
  const receipts = useReceipts(params.gudang, params.from, params.to)
  useReadOn(receipts)
  const siteName = useSiteLabel()
  const [nota, setNota] = useState<WindowTransaction | null>(null)
  const place = params.gudang === "" ? "All gudang" : siteName(params.gudang)
  const period = periodOf(params, report)

  const all = useMemo(
    () => (receipts.data?.pages ?? []).flatMap((page) => page.transactions),
    [receipts.data]
  )
  const sold = useMemo(() => {
    const faktur = params.faktur.trim().toLowerCase()
    const customer = params.customer.trim().toLowerCase()
    const sales = params.sales.trim().toLowerCase()
    return all.filter(
      (sale) =>
        sale.sale_number.toLowerCase().includes(faktur) &&
        customerCode(sale).toLowerCase().includes(customer) &&
        sale.actor_id.toLowerCase().includes(sales)
    )
  }, [all, params])

  if (receipts.isPending || receipts.hasNextPage)
    return <LoadingState>Reading the receipts…</LoadingState>

  const shared = { report, period, siteName: place }
  const money$ = (of: (sale: WindowTransaction) => number) => sum(sold, of)

  const noteCols: Col<WindowTransaction>[] = [
    { head: "Tanggal", kind: "date", value: (s) => dayOfSale(s) },
    { head: "No Faktur", kind: "text", value: (s) => s.sale_number },
    { head: "Customer Kode", kind: "text", value: (s) => customerCode(s) },
    { head: "Lokasi", kind: "text", value: () => null },
    {
      head: "Gudang",
      kind: "text",
      value: (s) => siteName(s.site_id),
    },
    { head: "Keterangan", kind: "text", value: () => null },
    { head: "Diskon", kind: "money", value: () => null },
    { head: "Total", kind: "money", value: (s) => s.total_minor },
    { head: "Total Bersih", kind: "money", value: (s) => s.total_minor },
    { head: "Status", kind: "text", value: () => "Lunas" },
  ]

  let body: React.ReactNode
  switch (report.id) {
    case "summary": {
      const days = perDay(sold, dayOfSale)
      const cols: Col<[string, WindowTransaction[]]>[] = [
        { head: "Tanggal", kind: "date", value: ([key]) => key },
        { head: "Nota", kind: "number", value: ([, list]) => list.length },
        {
          head: "Diskon",
          kind: "money",
          value: () => null,
        },
        {
          head: "PPN",
          kind: "money",
          value: ([, list]) => sum(list, (s) => s.tax_minor),
        },
        {
          head: "Total",
          kind: "money",
          value: ([, list]) => sum(list, (s) => s.total_minor),
        },
      ]
      body = (
        <ReportTable
          {...shared}
          cols={cols}
          rows={days}
          foot={[
            "Total",
            sold.length,
            undefined,
            money$((s) => s.tax_minor),
            money$((s) => s.total_minor),
          ]}
        />
      )
      break
    }
    case "reprint": {
      const cols: Col<WindowTransaction>[] = [
        { head: "Tanggal", kind: "date", value: (s) => dayOfSale(s) },
        { head: "No Faktur", kind: "text", value: (s) => s.sale_number },
        { head: "Customer", kind: "text", value: (s) => customerCode(s) },
        {
          head: "Gudang",
          kind: "text",
          value: (s) => siteName(s.site_id),
        },
        { head: "Total", kind: "money", value: (s) => s.total_minor },
      ]
      body = (
        <ReportTable
          {...shared}
          cols={cols}
          rows={sold}
          onOpen={setNota}
          foot={[
            "Total",
            undefined,
            undefined,
            undefined,
            money$((s) => s.total_minor),
          ]}
        />
      )
      break
    }
    case "nota":
      body = (
        <ReportTable
          {...shared}
          cols={noteCols}
          rows={sold}
          onOpen={setNota}
          foot={[
            "Total",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            money$((s) => s.total_minor),
            money$((s) => s.total_minor),
          ]}
        />
      )
      break
    case "rekap": {
      const cols: Col<WindowTransaction>[] = [
        ...noteCols.slice(0, 6),
        { head: "Item", kind: "number", value: (s) => s.line_count },
        { head: "Jml", kind: "number", value: (s) => s.units },
        ...noteCols.slice(6),
      ]
      body = (
        <ReportTable
          {...shared}
          cols={cols}
          rows={sold}
          onOpen={setNota}
          foot={[
            "Total",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            money$((s) => s.line_count),
            money$((s) => s.units),
            undefined,
            money$((s) => s.total_minor),
            money$((s) => s.total_minor),
          ]}
        />
      )
      break
    }
    case "user": {
      const users = [...new Set(sold.map((s) => s.actor_id))].map(
        (id) => [id, sold.filter((s) => s.actor_id === id)] as const
      )
      const ranked = [...users].sort(
        (a, b) =>
          sum(b[1], (s) => s.total_minor) - sum(a[1], (s) => s.total_minor)
      )
      const cols: Col<(typeof ranked)[number]>[] = [
        { head: "Operator", kind: "text", value: ([id]) => id },
        { head: "Nota", kind: "number", value: ([, list]) => list.length },
        {
          head: "Jml",
          kind: "number",
          value: ([, list]) => sum(list, (s) => s.units),
        },
        {
          head: "PPN",
          kind: "money",
          value: ([, list]) => sum(list, (s) => s.tax_minor),
        },
        {
          head: "Omzet",
          kind: "money",
          value: ([, list]) => sum(list, (s) => s.total_minor),
        },
      ]
      body = (
        <ReportTable
          {...shared}
          cols={cols}
          rows={ranked}
          foot={[
            "Total",
            sold.length,
            money$((s) => s.units),
            money$((s) => s.tax_minor),
            money$((s) => s.total_minor),
          ]}
        />
      )
      break
    }
    case "ppn": {
      const days = perDay(sold, dayOfSale)
      const cols: Col<[string, WindowTransaction[]]>[] = [
        { head: "Tanggal", kind: "date", value: ([key]) => key },
        { head: "Nota", kind: "number", value: ([, list]) => list.length },
        {
          head: "DPP",
          kind: "money",
          value: ([, list]) => sum(list, (s) => s.net_minor),
        },
        {
          head: "PPN",
          kind: "money",
          value: ([, list]) => sum(list, (s) => s.tax_minor),
        },
        {
          head: "Total",
          kind: "money",
          value: ([, list]) => sum(list, (s) => s.total_minor),
        },
      ]
      body = (
        <ReportTable
          {...shared}
          cols={cols}
          rows={days}
          foot={[
            "Total",
            sold.length,
            money$((s) => s.net_minor),
            money$((s) => s.tax_minor),
            money$((s) => s.total_minor),
          ]}
        />
      )
      break
    }
    default: {
      // city: a shop is the place a sale is made; the shop's town is not on
      // the shop record, so Kota stands empty.
      const places = [...new Set(sold.map((s) => s.site_id))].map(
        (id) => [id, sold.filter((s) => s.site_id === id)] as const
      )
      const cols: Col<(typeof places)[number]>[] = [
        { head: "Kota", kind: "text", value: () => null },
        { head: "Gudang", kind: "text", value: ([id]) => siteName(id) },
        { head: "Nota", kind: "number", value: ([, list]) => list.length },
        {
          head: "Omset",
          kind: "money",
          value: ([, list]) => sum(list, (s) => s.total_minor),
        },
      ]
      body = (
        <ReportTable
          {...shared}
          cols={cols}
          rows={places}
          foot={["Total", undefined, sold.length, money$((s) => s.total_minor)]}
        />
      )
    }
  }
  return (
    <>
      {body}
      <NotaSheet sale={nota} onClose={() => setNota(null)} />
    </>
  )
}

// ---- Item report ----------------------------------------------------------

function ItemReport({ report, params }: { report: Report; params: Params }) {
  const siteName = useSiteLabel()
  const rows = useInfiniteQuery(
    explorerRowsQuery({
      from: params.from,
      to: params.to,
      group: "sku",
      stores: params.gudang === "" ? [] : [params.gudang],
      divisions: [],
      suppliers: [],
      tags: [],
      colours: [],
      sizes: [],
      q: "",
      matrix: false,
      months: false,
      articles: false,
    })
  )
  useReadOn(rows)
  const list = useMemo(
    () => (rows.data?.pages ?? []).flatMap((page) => page.rows),
    [rows.data]
  )
  if (rows.isPending || rows.hasNextPage)
    return <LoadingState>Reading the items…</LoadingState>
  const total = rows.data?.pages[0]?.total
  type Item = (typeof list)[number]
  const cols: Col<Item>[] = [
    { head: "Barcode", kind: "text", value: (r) => r.key },
    { head: "Nama Item", kind: "text", value: (r) => r.label },
    { head: "Kode Item", kind: "text", value: (r) => r.detail },
    { head: "Jml", kind: "number", value: (r) => r.figures.sold_qty },
    { head: "Retur", kind: "number", value: (r) => r.figures.returned_qty },
    { head: "Harga", kind: "money", value: () => null },
    {
      head: "Diskon Rp",
      kind: "money",
      value: (r) => r.figures.discount_minor,
    },
    { head: "Subtotal", kind: "money", value: (r) => r.figures.sales_minor },
  ]
  return (
    <ReportTable
      report={report}
      period={periodOf(params, report)}
      siteName={params.gudang === "" ? "All gudang" : siteName(params.gudang)}
      cols={cols}
      rows={list}
      foot={
        total === undefined
          ? undefined
          : [
              "Total",
              undefined,
              undefined,
              total.sold_qty,
              total.returned_qty,
              undefined,
              total.discount_minor,
              total.sales_minor,
            ]
      }
    />
  )
}

// ---- Monthly --------------------------------------------------------------

function MonthlyReport({ report, params }: { report: Report; params: Params }) {
  const siteName = useSiteLabel()
  const first = (() => {
    const at = new Date(`${monthStart(params.period)}T00:00:00`)
    at.setMonth(at.getMonth() - 11)
    return isoDay(at)
  })()
  const range = {
    from: first,
    to: monthEnd(params.period),
    bucket: "month" as const,
  }
  const series = useQuery({
    queryKey: analyticsKeys.series(range),
    queryFn: ({ signal }) => salesSeries(range, signal),
  })
  if (series.isPending) return <LoadingState>Reading the year…</LoadingState>
  if (series.data === undefined)
    return <EmptyState>The year could not be read.</EmptyState>
  const cells = series.data.cells.filter(
    (cell) => params.gudang === "" || cell.site_id === params.gudang
  )
  const rows = series.data.buckets.map((bucket) => {
    const here = cells.filter((cell) => cell.bucket_start === bucket)
    return {
      bucket,
      sales: sum(here, (cell) => cell.sales_count),
      units: sum(here, (cell) => cell.units_sold),
      net: sum(here, (cell) => cell.net_minor),
      tax: sum(here, (cell) => cell.tax_minor),
      gross: sum(here, (cell) => cell.gross_minor),
    }
  })
  type Month = (typeof rows)[number]
  const cols: Col<Month>[] = [
    {
      head: "Bulan",
      kind: "text",
      value: (r) => monthYear(r.bucket),
    },
    { head: "Nota", kind: "number", value: (r) => r.sales },
    { head: "Jml", kind: "number", value: (r) => r.units },
    { head: "DPP", kind: "money", value: (r) => r.net },
    { head: "PPN", kind: "money", value: (r) => r.tax },
    { head: "Total", kind: "money", value: (r) => r.gross },
  ]
  return (
    <ReportTable
      report={report}
      period={periodOf(params, report)}
      siteName={params.gudang === "" ? "All gudang" : siteName(params.gudang)}
      cols={cols}
      rows={rows}
      foot={[
        "Total",
        sum(rows, (r) => r.sales),
        sum(rows, (r) => r.units),
        sum(rows, (r) => r.net),
        sum(rows, (r) => r.tax),
        sum(rows, (r) => r.gross),
      ]}
      chart={
        <Card className="p-4">
          <BarSeries
            rows={rows.map((r) => ({ bucket: r.bucket, total: r.gross }))}
            series={[{ key: "total", label: "Total", tone: "accent" }]}
            format={money}
            titleOf={(bucket) => monthYear(bucket, true)}
            labelOf={(bucket) =>
              dateText(new Date(`${bucket}T00:00:00`), { month: "short" })
            }
          />
        </Card>
      }
    />
  )
}

// ---- Returns --------------------------------------------------------------

function ReturnReport({ report, params }: { report: Report; params: Params }) {
  const returns = useReturns(params.gudang, params.from, params.to)
  const siteName = useSiteLabel()
  const [opened, setOpened] = useState<string | null>(null)
  const all = useMemo(
    () => (returns.data?.pages ?? []).flatMap((page) => page.rows),
    [returns.data]
  )
  const list = useMemo(() => {
    const faktur = params.faktur.trim().toLowerCase()
    return all.filter(
      (r) =>
        r.return_number.toLowerCase().includes(faktur) ||
        r.sale_number.toLowerCase().includes(faktur)
    )
  }, [all, params.faktur])
  if (returns.isPending || returns.hasNextPage)
    return <LoadingState>Reading the returns…</LoadingState>
  const shared = {
    report,
    period: periodOf(params, report),
    siteName: params.gudang === "" ? "All gudang" : siteName(params.gudang),
  }
  const grand = sum(list, (r) => r.refund_total_minor)
  if (report.id === "retur-summary") {
    const days = perDay(list, (r) => r.created_at.slice(0, 10))
    const cols: Col<[string, ReturnRow[]]>[] = [
      { head: "Tanggal", kind: "date", value: ([key]) => key },
      { head: "Retur", kind: "number", value: ([, rows]) => rows.length },
      { head: "Total Diskon", kind: "money", value: () => null },
      { head: "PPN", kind: "money", value: () => null },
      {
        head: "Grand Total",
        kind: "money",
        value: ([, rows]) => sum(rows, (r) => r.refund_total_minor),
      },
    ]
    return (
      <ReportTable
        {...shared}
        cols={cols}
        rows={days}
        foot={["Total", list.length, undefined, undefined, grand]}
      />
    )
  }
  const cols: Col<ReturnRow>[] = [
    { head: "Tanggal", kind: "date", value: (r) => r.created_at.slice(0, 10) },
    { head: "No Retur", kind: "text", value: (r) => r.return_number },
    { head: "No Faktur", kind: "text", value: (r) => r.sale_number },
    { head: "Gudang", kind: "text", value: (r) => siteName(r.site_id) },
    { head: "Keterangan", kind: "text", value: (r) => r.reason },
    { head: "Grand Total", kind: "money", value: (r) => r.refund_total_minor },
  ]
  return (
    <>
      <ReportTable
        {...shared}
        cols={cols}
        rows={list}
        onOpen={(r) => setOpened(r.id)}
        foot={["Total", undefined, undefined, undefined, undefined, grand]}
      />
      <ReturnSheet id={opened} onClose={() => setOpened(null)} />
    </>
  )
}
