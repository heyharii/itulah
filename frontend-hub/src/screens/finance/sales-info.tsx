import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Printer, ReceiptText, Undo2 } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { DayRange } from "@/components/ui/day-range"
import { ExportButton } from "@/components/ui/export-button"
import { FilterChips } from "@/components/ui/filter-chips"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  TotalsLadder,
} from "@/components/ui/rows"
import { CellMoney } from "@/components/ui/rows-switch"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count, day, dayTime, money, sku } from "@/lib/format"
import { fileSafe, type ExportSheet } from "@/lib/export-xlsx"
import type { WindowTransaction } from "@/lib/queries/analytics"
import {
  saleReceipt,
  shopSaleDetail,
  type ReturnRow,
} from "@/lib/queries/storeops"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useWindow } from "@/screens/finance/hooks"
import { SiteName, SiteSelect } from "@/screens/finance/parts"
import { useSiteLabel } from "@/lib/queries/organisation"
import {
  customerCode,
  useReceipts,
  useReturns,
} from "@/screens/finance/sales-data"
import { ReturnSheet } from "@/screens/finance/sales-returns"

/// Info Penjualan, tab PENJUALAN & RETUR (7Soft 5.1, manual hal. 138-143), and
/// the nota that a row of it, of Penjualan Cash · POS and of the sales reports
/// opens.
///
/// 7Soft lists sales and returns together, newest first: Tanggal, No Faktur,
/// Status, Shift, Customer (Kode, Nama, Lokasi), Gudang, No Ref, PPN, Total,
/// Diskon, Total Bersih, with the Penjualan and Retur ticks, the date range and
/// XLS. The tills sell for cash and carry no receivable, so the Customer,
/// Pelunasan, Summary and Kartu Piutang tabs and the J.Tempo column are not
/// here. The Customer columns carry the member's code (CASH for a walk-in);
/// Nama and Lokasi, Shift, Diskon and Total are not on the sales wire and read
/// "—" rather than a made-up figure.

// ---------------------------------------------------------------------------
// The nota
// ---------------------------------------------------------------------------

interface NotaLine {
  readonly key: string
  readonly barcode: string
  readonly name: string
  readonly code: string
  readonly qty: number
  readonly price: number
  readonly subtotal: number
}

interface NotaBody {
  readonly lines: readonly NotaLine[]
  /// Said by the shop's pricing record; the centre's receipt does not carry it.
  readonly discount: number | null
}

/// The lines of one receipt, from whichever record holds them: a store's
/// receipt is the shop's pricing record, a centre sale is its receipt.
function useNotaBody(sale: WindowTransaction | null) {
  return useQuery({
    queryKey: ["finance", "nota", sale?.source ?? "", sale?.id ?? ""],
    enabled: sale !== null,
    queryFn: async ({ signal }): Promise<NotaBody> => {
      if (sale === null) return { lines: [], discount: null }
      if (sale.source === "EDGE") {
        const shop = await shopSaleDetail(sale.id, signal)
        return {
          discount: shop.discount_total_minor,
          lines: shop.lines.map((line, index) => ({
            key: `${line.sku_code}:${index}`,
            barcode: sku(line.sku_code),
            name: line.article_name ?? "—",
            code: line.article_code ?? "—",
            qty: line.quantity,
            price: line.unit_price_minor,
            subtotal:
              line.line_total_minor ?? line.quantity * line.unit_price_minor,
          })),
        }
      }
      const receipt = await saleReceipt(sale.id, signal)
      return {
        discount: null,
        lines: receipt.lines.map((line) => ({
          key: line.sale_line_id,
          barcode: sku(line.sku_code),
          name: line.article_name,
          code: "—",
          qty: line.quantity,
          price: line.unit_price_minor,
          subtotal: line.total_minor,
        })),
      }
    },
  })
}

/// The print stylesheet: the nota alone, on its own page.
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .nota-print, .nota-print * { visibility: visible !important; }
  .nota-print { position: absolute !important; left: 0; top: 0; right: 0; }
  @page { margin: 14mm; }
}
`

/// One receipt as 7Soft's Penjualan form reads it: No Faktur and Tanggal,
/// Customer, Lokasi, Gudang, No Ref, Keterangan, Total Diskon and PPN over the
/// grid of Barcode, Nama, Kode, Jml, Satuan, Harga, Diskon and Subtotal, with
/// PPN and Total under it.
export function NotaSheet({
  sale,
  onClose,
}: {
  sale: WindowTransaction | null
  onClose: () => void
}) {
  const body = useNotaBody(sale)
  const site = useSiteLabel()
  const nota = body.data
  return (
    <Sheet
      open={sale !== null}
      onOpenChange={(open) => !open && onClose()}
      id={sale?.sale_number}
      title={sale === null ? "Nota" : site(sale.site_id)}
      size="table"
      print={
        <Button variant="primary" onClick={() => window.print()}>
          <Printer />
          Print
        </Button>
      }
    >
      {sale !== null && (
        <div className="nota-print flex flex-col gap-6">
          <style>{PRINT_CSS}</style>
          <Facts>
            <Fact term="No Faktur">{sale.sale_number}</Fact>
            <Fact term="Tanggal">{dayTime(sale.completed_at)}</Fact>
            <Fact term="Customer">{customerCode(sale)}</Fact>
            <Fact term="Lokasi">—</Fact>
            <Fact term="Gudang">{site(sale.site_id)}</Fact>
            <Fact term="No Ref">—</Fact>
            <Fact term="Keterangan">—</Fact>
            <Fact term="Dibayar dengan">
              {sale.methods.length === 0 ? "—" : sale.methods.join(" + ")}
            </Fact>
          </Facts>
          {body.isPending ? (
            <LoadingState>Reading the nota…</LoadingState>
          ) : nota === undefined ? (
            <EmptyState>The nota could not be read.</EmptyState>
          ) : (
            <>
              <MiniTable
                head={[
                  { label: "Barcode", align: "left" },
                  { label: "Nama Item", align: "left" },
                  { label: "Kode Item", align: "left" },
                  "Jml",
                  { label: "Satuan", align: "left" },
                  "Harga",
                  "Diskon Rp",
                  "Diskon %",
                  "Subtotal",
                  { label: "Keterangan", align: "left" },
                ]}
              >
                {nota.lines.map((line) => (
                  <MiniRow key={line.key}>
                    <MiniCell>{line.barcode}</MiniCell>
                    <MiniCell>{line.name}</MiniCell>
                    <MiniCell>{line.code}</MiniCell>
                    <MiniCell align="right">{count(line.qty)}</MiniCell>
                    <MiniCell>—</MiniCell>
                    <MiniCell align="right">{money(line.price)}</MiniCell>
                    <MiniCell align="right">—</MiniCell>
                    <MiniCell align="right">—</MiniCell>
                    <MiniCell align="right">{money(line.subtotal)}</MiniCell>
                    <MiniCell>—</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
              <TotalsLadder
                rows={[
                  {
                    label: "Total Diskon",
                    value: nota.discount === null ? "—" : money(nota.discount),
                  },
                  { label: "PPN", value: money(sale.tax_minor) },
                ]}
                total={{ label: "Total", value: money(sale.total_minor) }}
              />
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Info Penjualan
// ---------------------------------------------------------------------------

type Kind = "Penjualan" | "Retur"

interface InfoRow {
  readonly key: string
  readonly kind: Kind
  readonly date: string | null
  readonly number: string
  readonly status: string
  readonly customer: string
  readonly siteId: string
  readonly ref: string
  readonly ppn: number | null
  readonly total: number
  readonly sale: WindowTransaction | null
  readonly ret: ReturnRow | null
}

const column = (
  id: string,
  header: string,
  size: number,
  cell: ColumnDef<TableSetup, InfoRow>["cell"],
  accessorFn: (row: InfoRow) => unknown,
  meta: ColumnDef<TableSetup, InfoRow>["meta"] = {}
): ColumnDef<TableSetup, InfoRow> => ({
  id,
  header,
  size,
  accessorFn,
  enableSorting: false,
  cell,
  meta,
})

const COLUMNS: ColumnDef<TableSetup, InfoRow>[] = [
  column(
    "date",
    "Tanggal",
    120,
    ({ row }) => day(row.original.date),
    (row) => row.date,
    { card: "meta" }
  ),
  column(
    "number",
    "No Faktur",
    170,
    ({ row }) => <span className="text-ink">{row.original.number}</span>,
    (row) => row.number,
    { card: "title", grow: 150 }
  ),
  column(
    "status",
    "Status",
    110,
    ({ row }) => (
      <Status tone={row.original.kind === "Retur" ? "warn" : "done"}>
        {row.original.status}
      </Status>
    ),
    (row) => row.status,
    { card: "meta" }
  ),
  column(
    "shift",
    "Shift",
    80,
    () => <span className="text-faint">—</span>,
    () => "",
    { priority: 3 }
  ),
  column(
    "customer_code",
    "Customer Kode",
    150,
    ({ row }) => row.original.customer,
    (row) => row.customer,
    { priority: 2 }
  ),
  column(
    "customer_name",
    "Customer Nama",
    150,
    () => <span className="text-faint">—</span>,
    () => "",
    { priority: 3 }
  ),
  column(
    "customer_place",
    "Customer Lokasi",
    150,
    () => <span className="text-faint">—</span>,
    () => "",
    { priority: 3 }
  ),
  column(
    "warehouse",
    "Gudang",
    180,
    ({ row }) => <SiteName id={row.original.siteId} />,
    (row) => row.siteId,
    { priority: 1 }
  ),
  column(
    "ref",
    "No Ref",
    160,
    ({ row }) =>
      row.original.ref === "" ? (
        <span className="text-faint">—</span>
      ) : (
        row.original.ref
      ),
    (row) => row.ref,
    { priority: 2 }
  ),
  column(
    "ppn",
    "PPN",
    130,
    ({ row }) => <CellMoney minor={row.original.ppn} />,
    (row) => row.ppn,
    { align: "right", priority: 2 }
  ),
  column(
    "total",
    "Total",
    130,
    () => <span className="text-faint">—</span>,
    () => "",
    { align: "right", priority: 3 }
  ),
  column(
    "discount",
    "Diskon",
    110,
    () => <span className="text-faint">—</span>,
    () => "",
    { align: "right", priority: 3 }
  ),
  column(
    "net",
    "Total Bersih",
    150,
    ({ row }) => (
      <span className="font-medium text-ink">
        <CellMoney minor={row.original.total} />
      </span>
    ),
    (row) => row.total,
    { align: "right", card: "lead" }
  ),
]

export function InfoPenjualan() {
  const range = useWindow()
  const [site, setSite] = useState("")
  const [kind, setKind] = useState<Kind | null>(null)
  const [query, setQuery] = useState("")
  const [opened, setOpened] = useState<WindowTransaction | null>(null)
  const [returnId, setReturn] = useState<string | null>(null)

  const sales = useReceipts(site, range.from, range.to)
  const returns = useReturns(site, range.from, range.to)
  const siteName = useSiteLabel()

  const all = useMemo<InfoRow[]>(() => {
    const sold = (sales.data?.pages ?? []).flatMap((page) =>
      page.transactions.map((sale): InfoRow => ({
        key: `S:${sale.id}`,
        kind: "Penjualan",
        date: sale.completed_at,
        number: sale.sale_number,
        status: "Lunas",
        customer: customerCode(sale),
        siteId: sale.site_id,
        ref: "",
        ppn: sale.tax_minor,
        total: sale.total_minor,
        sale,
        ret: null,
      }))
    )
    const back = (returns.data?.pages ?? []).flatMap((page) =>
      page.rows.map((ret): InfoRow => ({
        key: `R:${ret.id}`,
        kind: "Retur",
        date: ret.created_at,
        number: ret.return_number,
        status: "Retur",
        customer: "—",
        siteId: ret.site_id,
        ref: ret.sale_number,
        ppn: null,
        // A return lowers what was sold, so it reads as a minus.
        total: -ret.refund_total_minor,
        sale: null,
        ret,
      }))
    )
    return [...sold, ...back].sort((a, b) =>
      (b.date ?? "").localeCompare(a.date ?? "")
    )
  }, [sales.data, returns.data])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return all.filter(
      (row) =>
        (kind === null || row.kind === kind) &&
        (needle === "" ||
          `${row.number} ${row.ref} ${row.customer} ${siteName(row.siteId)}`
            .toLowerCase()
            .includes(needle))
    )
  }, [all, kind, query, siteName])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: COLUMNS,
        getRowId: (row: InfoRow) => row.key,
      }),
      [rows]
    )
  )

  const sold = all.filter((row) => row.kind === "Penjualan").length
  const back = all.length - sold

  const build = (): ExportSheet => ({
    filename: `Info-Penjualan-${fileSafe(range.from)}-${fileSafe(range.to)}`,
    sheet: "Penjualan & Retur",
    title: "Penjualan & Retur",
    subtitle: `${day(range.from)} – ${day(range.to)}`,
    columns: [
      { header: "Tanggal", kind: "date" },
      { header: "No Faktur", kind: "text" },
      { header: "Status", kind: "text" },
      { header: "Customer Kode", kind: "text" },
      { header: "Gudang", kind: "text" },
      { header: "No Ref", kind: "text" },
      { header: "PPN", kind: "money" },
      { header: "Total Bersih", kind: "money" },
    ],
    rows: rows.map((row) => [
      row.date?.slice(0, 10) ?? "",
      row.number,
      row.status,
      row.customer,
      siteName(row.siteId),
      row.ref,
      row.ppn,
      row.total,
    ]),
  })

  return (
    <PageContent>
      <PageHeader crumb="Finance · Info Penjualan" title="Penjualan & Retur" />
      <Toolbar className="group/bar">
        <DayRange
          label="Tanggal"
          placeholder="Tanggal"
          value={{ from: range.from, to: range.to }}
          onChange={(next) => {
            range.setFrom(next.from)
            range.setTo(next.to)
          }}
          className="h-control min-h-0 w-52 shrink-0 py-0"
        />
        <SiteSelect
          value={site}
          onChange={setSite}
          emptyLabel="All gudang"
          className="h-control w-48"
          aria-label="Gudang"
        />
        <FilterChips
          label="Jenis"
          value={kind}
          onChange={(next) => setKind(next as Kind | null)}
          options={[
            { value: null, label: "Semua", count: all.length },
            {
              value: "Penjualan",
              label: "Penjualan",
              icon: ReceiptText,
              count: sold,
            },
            { value: "Retur", label: "Retur", icon: Undo2, count: back },
          ]}
        />
        <ExpandingSearch value={query} onChange={setQuery} label="Search" />
        <Toolbar.Spacer />
        <ExportButton build={build} disabled={rows.length === 0} />
      </Toolbar>

      {sales.isPending ? (
        <LoadingState>Reading the nota…</LoadingState>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState>No penjualan or retur in this window.</EmptyState>
        </Card>
      ) : (
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <DataTable<InfoRow>
            table={table}
            onRowClick={(row) => {
              if (row.sale !== null) setOpened(row.sale)
              else if (row.ret !== null) setReturn(row.ret.id)
            }}
            pageScroll
            cardSort={false}
            cardsApart
            cardLead
            more={sales}
          />
        </Card>
      )}

      <NotaSheet sale={opened} onClose={() => setOpened(null)} />
      <ReturnSheet id={returnId} onClose={() => setReturn(null)} />
    </PageContent>
  )
}
