import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Printer } from "lucide-react"
import { useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { DayRange } from "@/components/ui/day-range"
import { ExportButton } from "@/components/ui/export-button"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  TotalsLadder,
} from "@/components/ui/rows"
import { CellMoney } from "@/components/ui/rows-switch"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SubHead } from "@/components/ui/rows"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count, day, dayTime, label, money, sku } from "@/lib/format"
import { fileSafe, type ExportSheet } from "@/lib/export-xlsx"
import { useSiteLabel } from "@/lib/queries/organisation"
import {
  returnDetail,
  returnsPageQuery,
  storeopsKeys,
  type ReturnRow,
} from "@/lib/queries/storeops"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useWindow } from "@/screens/finance/hooks"
import { SiteName, SiteSelect } from "@/screens/finance/parts"

/// Retur Penjualan (7Soft 5.7, manual hal. 161-164): the list of returns, and
/// a return opened with its item lines, Gudang, No Ref, Keterangan, Total
/// Diskon, PPN and Grand Total.
///
/// A return here is the refund desk's: a sale's pieces brought back, with the
/// reason and what was paid back. The Customer, Jangka Waktu, J.Tempo and
/// Pelunasan-of-a-receivable parts of 7Soft's form belong to a sale on credit
/// and are not here; the refund methods stand where its Pelunasan tab does.
/// What the return record does not carry (No Ref, Total Diskon, PPN, a price
/// and discount per line, the unit) reads "—".

const PAGE = 100

const column = (
  id: string,
  header: string,
  size: number,
  cell: ColumnDef<TableSetup, ReturnRow>["cell"],
  accessorFn: (row: ReturnRow) => unknown,
  meta: ColumnDef<TableSetup, ReturnRow>["meta"] = {}
): ColumnDef<TableSetup, ReturnRow> => ({
  id,
  header,
  size,
  accessorFn,
  enableSorting: false,
  cell,
  meta,
})

const COLUMNS: ColumnDef<TableSetup, ReturnRow>[] = [
  column(
    "date",
    "Tanggal",
    130,
    ({ row }) => day(row.original.created_at),
    (row) => row.created_at,
    { card: "meta" }
  ),
  column(
    "number",
    "No Retur",
    170,
    ({ row }) => <span className="text-ink">{row.original.return_number}</span>,
    (row) => row.return_number,
    { card: "title", grow: 150 }
  ),
  column(
    "sale",
    "No Faktur",
    170,
    ({ row }) => row.original.sale_number,
    (row) => row.sale_number,
    { priority: 1 }
  ),
  column(
    "warehouse",
    "Gudang",
    180,
    ({ row }) => <SiteName id={row.original.site_id} />,
    (row) => row.site_id,
    { priority: 1 }
  ),
  column(
    "ref",
    "No Ref",
    130,
    () => <span className="text-faint">—</span>,
    () => "",
    { priority: 3 }
  ),
  column(
    "note",
    "Keterangan",
    240,
    ({ row }) => (
      <span className="block truncate">{label(row.original.reason)}</span>
    ),
    (row) => row.reason,
    { grow: 200, priority: 2 }
  ),
  column(
    "grand",
    "Grand Total",
    160,
    ({ row }) => (
      <span className="font-medium text-ink">
        <CellMoney minor={row.original.refund_total_minor} />
      </span>
    ),
    (row) => row.refund_total_minor,
    { align: "right", card: "lead" }
  ),
]

export function ReturPenjualan() {
  const range = useWindow()
  const [site, setSite] = useState("")
  const [query, setQuery] = useState("")
  const [opened, setOpened] = useState<string | null>(null)
  const siteName = useSiteLabel()
  const asked = useDeferredValue(query.trim())

  const returns = useInfiniteQuery(
    returnsPageQuery({
      siteId: site === "" ? undefined : site,
      q: asked === "" ? undefined : asked,
      from: range.from,
      to: range.to,
      sort: "at",
      dir: "desc",
      limit: PAGE,
    })
  )
  const rows = useMemo(
    () => (returns.data?.pages ?? []).flatMap((page) => page.rows),
    [returns.data]
  )
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: COLUMNS,
        getRowId: (row: ReturnRow) => row.id,
      }),
      [rows]
    )
  )

  const build = (): ExportSheet => ({
    filename: `Retur-Penjualan-${fileSafe(range.from)}-${fileSafe(range.to)}`,
    sheet: "Retur Penjualan",
    title: "Retur Penjualan",
    subtitle: `${day(range.from)} – ${day(range.to)}`,
    columns: [
      { header: "Tanggal", kind: "date" },
      { header: "No Retur", kind: "text" },
      { header: "No Faktur", kind: "text" },
      { header: "Gudang", kind: "text" },
      { header: "Keterangan", kind: "text" },
      { header: "Grand Total", kind: "money" },
    ],
    rows: rows.map((row) => [
      row.created_at.slice(0, 10),
      row.return_number,
      row.sale_number,
      siteName(row.site_id),
      row.reason,
      row.refund_total_minor,
    ]),
    totalRow: [
      "",
      "Total",
      "",
      "",
      "",
      returns.data?.pages[0]?.refund_total_minor ?? null,
    ],
  })

  return (
    <PageContent>
      <PageHeader crumb="Finance · Penjualan" title="Retur Penjualan" />
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
        <ExpandingSearch value={query} onChange={setQuery} label="Search" />
        <Toolbar.Spacer />
        <ExportButton build={build} disabled={rows.length === 0} />
      </Toolbar>

      {returns.isPending ? (
        <LoadingState>Reading the returns…</LoadingState>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState>No retur in this window.</EmptyState>
        </Card>
      ) : (
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <DataTable<ReturnRow>
            table={table}
            onRowClick={(row) => setOpened(row.id)}
            pageScroll
            cardSort={false}
            cardsApart
            cardLead
            more={returns}
            summary={{
              note: "Total",
              grand: money(returns.data?.pages[0]?.refund_total_minor),
            }}
          />
        </Card>
      )}

      <ReturnSheet id={opened} onClose={() => setOpened(null)} />
    </PageContent>
  )
}

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .retur-print, .retur-print * { visibility: visible !important; }
  .retur-print { position: absolute !important; left: 0; top: 0; right: 0; }
  @page { margin: 14mm; }
}
`

/// One return: the form 7Soft draws for a Faktur Retur Jual.
export function ReturnSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const site = useSiteLabel()
  const detail = useQuery({
    queryKey: storeopsKeys.saleReturn(id ?? ""),
    enabled: id !== null,
    queryFn: ({ signal }) => returnDetail(id!, signal),
  })
  const retur = detail.data
  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={retur?.return_number}
      title={retur === undefined ? "Retur" : site(retur.site_id)}
      size="table"
      print={
        <Button variant="primary" onClick={() => window.print()}>
          <Printer />
          Print
        </Button>
      }
    >
      {retur === undefined ? (
        <LoadingState>Reading the retur…</LoadingState>
      ) : (
        <div className="retur-print flex flex-col gap-6">
          <style>{PRINT_CSS}</style>
          <Facts>
            <Fact term="No Retur">{retur.return_number}</Fact>
            <Fact term="Tanggal">{dayTime(retur.created_at)}</Fact>
            <Fact term="No Faktur">{retur.sale_number}</Fact>
            <Fact term="Gudang">{site(retur.site_id)}</Fact>
            <Fact term="No Ref">—</Fact>
            <Fact term="Keterangan">{label(retur.reason)}</Fact>
          </Facts>
          <MiniTable
            head={[
              { label: "Nama Item", align: "left" },
              { label: "Kode Item", align: "left" },
              "Jumlah",
              { label: "Satuan", align: "left" },
              "Harga",
              "Diskon",
              "Subtotal",
              { label: "Keterangan", align: "left" },
            ]}
          >
            {retur.lines.map((line) => (
              <MiniRow key={line.id}>
                <MiniCell>{line.article_name}</MiniCell>
                <MiniCell>{sku(line.sku_code)}</MiniCell>
                <MiniCell align="right">{count(line.quantity)}</MiniCell>
                <MiniCell>—</MiniCell>
                <MiniCell align="right">—</MiniCell>
                <MiniCell align="right">—</MiniCell>
                <MiniCell align="right">{money(line.refund_minor)}</MiniCell>
                <MiniCell>
                  {line.restock ? "Kembali ke stok" : "Ke reject"}
                </MiniCell>
              </MiniRow>
            ))}
          </MiniTable>
          <TotalsLadder
            rows={[
              { label: "Total Diskon", value: "—" },
              { label: "PPN", value: "—" },
            ]}
            total={{
              label: "Grand Total",
              value: money(retur.refund_total_minor),
            }}
          />
          {retur.refunds.length > 0 && (
            <div>
              <SubHead>Pelunasan</SubHead>
              <MiniTable
                head={[
                  { label: "Kas/Bank", align: "left" },
                  { label: "No Reff", align: "left" },
                  "Bayar",
                ]}
              >
                {retur.refunds.map((refund, index) => (
                  <MiniRow key={`${refund.method}:${index}`}>
                    <MiniCell>{label(refund.method)}</MiniCell>
                    <MiniCell>{refund.reference ?? "—"}</MiniCell>
                    <MiniCell align="right">
                      {money(refund.amount_minor)}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
