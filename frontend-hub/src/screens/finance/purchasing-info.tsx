import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, RowData } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { Card } from "@/components/ui/card"
import { ExportButton } from "@/components/ui/export-button"
import { DataTable, type DataTableProps } from "@/components/ui/data-table"
import { FilterChips } from "@/components/ui/filter-chips"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Status } from "@/components/ui/pill"
import { CellMoney } from "@/components/ui/rows-switch"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import type { ExportSheet } from "@/lib/export-xlsx"
import { useFilters } from "@/lib/filters"
import { count, day, money } from "@/lib/format"
import {
  billItemLines,
  financeKeys,
  listCreditNotes,
  payablesAgingQuery,
  projectionGirosQuery,
} from "@/lib/queries/finance"
import { tableSetup, type TableSetup } from "@/lib/table"
import { SiteName, SupplierName } from "@/screens/finance/parts"
import {
  billStatus,
  noteStatus,
  ppnCode,
  termOf,
  useBillsInWindow,
  useGiroOfPayment,
  useSettlementLines,
  useSupplierMovements,
  type SettlementLine,
} from "@/screens/finance/purchasing"
import { useSuppliers } from "@/screens/finance/hooks"
import { todayIso } from "@/screens/finance/chart"
import { supplierDisplayName } from "@/screens/procurement/supplier-format"
import type { CreditNote, SupplierBill } from "@itulah/contract"

/// The tabs of 7Soft's Info Pembelian (4.1, manual hal. 110-114) that are not
/// the supplier's ledger: SUPPLIER, PEMBELIAN & RETUR, PELUNASAN HUTANG and
/// SUMMARY HUTANG. KARTU HUTANG is `supplier-ledger.tsx`; PO is Procurement's
/// (`/procurement/orders`) and is not drawn here.
///
/// Each tab is one table in the shell's toolbar: `lead` is the screen's tab
/// choice and `controls` the supplier, the window and the unit the shell holds,
/// so the toolbar is one row whichever tab is open.

interface TableProps<T extends RowData> {
  /// The screen's tabs, first in the toolbar.
  readonly lead: React.ReactNode
  /// The supplier, window and unit boxes the shell holds.
  readonly controls: React.ReactNode
  readonly columns: ColumnDef<TableSetup, T>[]
  readonly rows: readonly T[]
  readonly getId: (row: T) => string
  readonly searchLabel: string
  readonly onRowClick?: (row: T) => void
  readonly summary?: Record<string, React.ReactNode>
  /// Said when there is nothing to list.
  readonly empty: React.ReactNode
  readonly loading?: boolean
  readonly more?: DataTableProps<T>["more"]
  /// 7Soft's XLS: the tab as a sheet, every row. Present on every tab.
  readonly sheet: () => ExportSheet
  /// Figures and chips that belong under the bar and above the table: the
  /// screen's own KPIs, the way `<Toolbar>` keeps the tabs above them.
  readonly before?: React.ReactNode
}

/// One list of 7Soft's Info Pembelian: the toolbar (tabs, the shell's boxes,
/// search and the kind chips), then the table.
function InfoTable<T extends RowData>({
  lead,
  controls,
  columns,
  rows,
  getId,
  searchLabel,
  onRowClick,
  summary,
  empty,
  loading = false,
  more,
  sheet,
  before,
}: TableProps<T>) {
  const [query, setQuery] = useState("")
  const filters = useFilters(columns)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as T[],
        columns: filters.columns,
        getRowId: getId,
        state: { columnFilters: filters.columnFilters, globalFilter: query },
        onGlobalFilterChange: setQuery,
      }),
      [rows, filters.columns, filters.columnFilters, getId, query, setQuery]
    )
  )
  return (
    <>
      <Toolbar className="group/bar" lead={lead}>
        {controls}
        <FilterPanel
          model={filters}
          table={table}
          search={{ value: query, onChange: setQuery, label: searchLabel }}
        />
        <ExportButton
          variant="ghost"
          build={sheet}
          disabled={loading || rows.length === 0}
        />
      </Toolbar>
      {before}
      {loading ? (
        <LoadingState>Reading…</LoadingState>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState>{empty}</EmptyState>
        </Card>
      ) : (
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <DataTable<T>
            table={table}
            onRowClick={onRowClick}
            pageScroll
            cardSort={false}
            cardsApart
            cardLead
            more={more}
            summary={summary}
            empty={<EmptyState>Nothing matches the search.</EmptyState>}
          />
        </Card>
      )}
    </>
  )
}

const xText = (header: string, width?: number) =>
  ({ header, kind: "text", width }) as const
const xMoney = (header: string) => ({ header, kind: "money" }) as const
const xDate = (header: string) => ({ header, kind: "date" }) as const

const dash = <span className="text-faint">—</span>

/// A 7Soft column the hub's data does not carry: it keeps its place and its
/// name and reads "—" in every row, so the table is 7Soft's and the gap is
/// visible rather than hidden.
function absent<T extends RowData>(
  header: string,
  size: number,
  align?: "right"
): ColumnDef<TableSetup, T> {
  return {
    id: `absent-${header}`,
    accessorFn: () => "",
    header,
    size,
    enableSorting: false,
    meta: { card: "hide", priority: 3, ...(align ? { align } : {}) },
    cell: () => dash,
  }
}

/// The purchase order a bill answers, read from the bill's own item lines (the
/// register carries no PO number). One cached read per row, the way the bill
/// register counts lines.
function BillPo({ id }: { id: string }) {
  const lines = useQuery({
    queryKey: [...financeKeys.bill(id), "lines"],
    queryFn: ({ signal }) => billItemLines(id, signal),
    staleTime: 60_000,
  })
  const numbers = [
    ...new Set(
      (lines.data ?? []).flatMap((line) =>
        line.po_number === null ? [] : [line.po_number]
      )
    ),
  ]
  return numbers.length === 0 ? (
    dash
  ) : (
    <span className="block truncate font-mono text-id text-body">
      {numbers.join(", ")}
    </span>
  )
}

const figure = (minor: number) => (
  <span className="text-body tabular-nums">
    <CellMoney minor={minor} />
  </span>
)

// ---------------------------------------------------------------------------
// SUPPLIER
// ---------------------------------------------------------------------------

interface SupplierRow {
  readonly code: string
  readonly name: string
  readonly address: string
  readonly phone: string
  readonly contact: string
  readonly term: string
  readonly active: string
  /// What is owed to them today — the hub's own column; 7Soft's list does not
  /// carry it.
  readonly owed: number
  /// The part of it that is past its date: the ageing's four late buckets.
  readonly late: number
}

const supplierColumns: ColumnDef<TableSetup, SupplierRow>[] = [
  {
    accessorKey: "code",
    header: "Kode supplier",
    size: 130,
    enableSorting: false,
    meta: { card: "id" },
    cell: ({ row }) => <span className="text-mute">{row.original.code}</span>,
  },
  {
    accessorKey: "name",
    header: "Supplier",
    size: 260,
    enableSorting: false,
    meta: { card: "title", grow: 220 },
    cell: ({ row }) => (
      <span className="block truncate font-medium text-ink">
        {row.original.name}
      </span>
    ),
  },
  absent<SupplierRow>("Lokasi", 130),
  {
    accessorKey: "address",
    header: "Alamat",
    size: 260,
    enableSorting: false,
    meta: { card: "meta", priority: 3 },
    cell: ({ row }) => (
      <span className="block truncate text-body" title={row.original.address}>
        {row.original.address || "—"}
      </span>
    ),
  },
  {
    accessorKey: "phone",
    header: "Phone",
    size: 140,
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => (
      <span className="text-body tabular-nums">
        {row.original.phone || "—"}
      </span>
    ),
  },
  absent<SupplierRow>("Fax", 130),
  {
    accessorKey: "contact",
    header: "Kontak",
    size: 140,
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => (
      <span className="block truncate text-body">
        {row.original.contact || "—"}
      </span>
    ),
  },
  {
    accessorKey: "term",
    header: "Jangka",
    size: 110,
    enableSorting: false,
    meta: { card: "hide", priority: 2 },
    cell: ({ row }) => (
      <span className="text-body">{row.original.term || "—"}</span>
    ),
  },
  absent<SupplierRow>("Limit hutang", 150, "right"),
  {
    accessorKey: "owed",
    header: "Sisa hutang",
    size: 160,
    enableSorting: false,
    meta: { align: "right", card: "lead" },
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        <CellMoney minor={row.original.owed} />
      </span>
    ),
  },
  {
    // 7Soft's Overdue column, and the one figure the ageing already answers
    // per supplier: the part of the balance that is past its date.
    accessorKey: "late",
    header: "Overdue",
    size: 160,
    enableSorting: false,
    meta: { align: "right", card: "metric", priority: 2 },
    cell: ({ row }) =>
      row.original.late === 0 ? (
        dash
      ) : (
        <span className="font-medium text-bad-fg tabular-nums">
          <CellMoney minor={row.original.late} />
        </span>
      ),
  },
  {
    accessorKey: "active",
    header: "Aktif",
    size: 110,
    enableSorting: false,
    meta: { card: "status", filter: { kind: "option" } },
    cell: ({ row }) => (
      <Status tone={row.original.active === "Active" ? "ok" : "neutral"}>
        {row.original.active}
      </Status>
    ),
  },
]

/// 7Soft's SUPPLIER tab: every supplier with its terms, and what is owed to
/// each. A row opens that supplier's Kartu Hutang. Code, name, address, phone,
/// contact, term and active come from the supplier master; 7Soft's Lokasi, Fax
/// and Limit hutang are not fields of it and read "—". Sisa hutang and Overdue
/// are the server's own ageing, per supplier — the same read that feeds the
/// four figures and the chips above the list.
export function SuppliersTab({
  lead,
  controls,
  onOpen,
}: {
  lead: React.ReactNode
  controls: React.ReactNode
  onOpen: (code: string) => void
}) {
  const suppliers = useSuppliers()
  const aging = useQuery(payablesAgingQuery(todayIso(), null))
  const giros = useQuery(projectionGirosQuery())
  /// The chips 7Soft's supplier list offers, less "Giro out": nothing on the
  /// wire ties a giro to a supplier (only the party's printed name), so a chip
  /// that could not answer is not drawn — see the backend list in the report.
  const [chip, setChip] = useState<"all" | "owing" | "overdue">("all")
  const owed = useMemo(
    () =>
      new Map(
        (aging.data?.suppliers ?? []).map((row) => [
          row.supplier_id,
          row.buckets.total_minor,
        ])
      ),
    [aging.data]
  )
  /// What is late: the ageing's four past-due buckets, added.
  const late = useMemo(
    () =>
      new Map(
        (aging.data?.suppliers ?? []).map((row) => [
          row.supplier_id,
          row.buckets.days_1_30_minor +
            row.buckets.days_31_60_minor +
            row.buckets.days_61_90_minor +
            row.buckets.days_over_90_minor,
        ])
      ),
    [aging.data]
  )
  const rows = useMemo<SupplierRow[]>(
    () =>
      (suppliers.data ?? []).map((one) => ({
        code: one.supplier_code,
        name: supplierDisplayName(one),
        address: one.address ?? "",
        phone: one.phone ?? "",
        contact: one.contact_name ?? "",
        term: one.default_payment_terms_code ?? "",
        active: one.status === "ACTIVE" ? "Active" : "Inactive",
        owed: owed.get(one.supplier_code) ?? 0,
        late: late.get(one.supplier_code) ?? 0,
      })),
    [suppliers.data, owed, late]
  )
  const shown = useMemo(
    () =>
      chip === "all"
        ? rows
        : rows.filter((one) =>
            chip === "owing" ? one.owed > 0 : one.late > 0
          ),
    [rows, chip]
  )
  /// 7Soft's four supplier figures. "Due this week" reads "—": the ageing
  /// buckets by age, not by the next seven days, and no per-supplier due date
  /// is on the wire (the backend list in the report names the read it needs).
  const totals = aging.data?.total
  const owedAll = totals?.total_minor ?? 0
  const lateAll =
    (totals?.days_1_30_minor ?? 0) +
    (totals?.days_31_60_minor ?? 0) +
    (totals?.days_61_90_minor ?? 0) +
    (totals?.days_over_90_minor ?? 0)
  const outGiros = (giros.data ?? []).filter((one) =>
    ["ISSUED", "DELIVERED", "DUE"].includes(one.status)
  )
  const before = (
    <>
      <KpiStrip className="xl:grid-cols-4">
        <Kpi
          label="Owed"
          value={money(owedAll)}
          onClick={() => setChip("all")}
        />
        <Kpi
          label="Overdue"
          value={
            <span className={lateAll > 0 ? "text-bad-fg" : undefined}>
              {money(lateAll)}
            </span>
          }
          onClick={() => setChip("overdue")}
        />
        <Kpi label="Due this week" value="—" />
        <Kpi
          label="Giro still out"
          value={`${count(outGiros.length)} · ${money(
            outGiros.reduce((sum, one) => sum + one.amount_minor, 0)
          )}`}
        />
      </KpiStrip>
      <div className="mb-3.5 flex flex-wrap items-center gap-1.5">
        <FilterChips
          label="Supplier"
          value={chip === "all" ? null : chip}
          options={[
            { value: null, label: "All" },
            { value: "owing", label: "Owing" },
            { value: "overdue", label: "Overdue" },
          ]}
          onChange={(next) =>
            setChip((next ?? "all") as "all" | "owing" | "overdue")
          }
        />
        <span className="text-[0.9375rem] text-body">
          {count(shown.length)} {shown.length === 1 ? "supplier" : "suppliers"}
        </span>
      </div>
    </>
  )
  return (
    <InfoTable<SupplierRow>
      lead={lead}
      controls={controls}
      before={before}
      columns={supplierColumns}
      rows={shown}
      getId={(row) => row.code}
      searchLabel="Search suppliers"
      onRowClick={(row) => onOpen(row.code)}
      empty="No supplier yet."
      loading={suppliers.isPending}
      sheet={() => ({
        filename: "Info-Pembelian-Supplier",
        sheet: "Supplier",
        title: "Info Pembelian · Supplier",
        columns: [
          xText("Kode supplier", 16),
          xText("Supplier", 36),
          xText("Lokasi", 16),
          xText("Alamat", 40),
          xText("Phone", 18),
          xText("Fax", 14),
          xText("Kontak", 20),
          xText("Jangka", 12),
          xMoney("Limit hutang"),
          xMoney("Sisa hutang"),
          xMoney("Overdue"),
          xText("Aktif", 10),
        ],
        rows: rows.map((one) => [
          one.code,
          one.name,
          null,
          one.address,
          one.phone,
          null,
          one.contact,
          one.term,
          null,
          one.owed,
          one.late,
          one.active,
        ]),
      })}
    />
  )
}

// ---------------------------------------------------------------------------
// PEMBELIAN & RETUR
// ---------------------------------------------------------------------------

/// A purchase invoice or a return, as one row of 7Soft's PEMBELIAN & RETUR.
interface DocumentRow {
  readonly id: string
  readonly kind: "Pembelian" | "Retur"
  readonly date: string
  readonly number: string
  readonly status: string
  readonly tone: ReturnType<typeof billStatus>["tone"]
  readonly supplierId: string
  readonly supplierName: string | null
  readonly siteId: string
  readonly total: number
  readonly ppn: string
  readonly ref: string | null
  readonly term: string | null
  readonly due: string | null
  readonly bill: SupplierBill | null
  readonly note: CreditNote | null
}

const documentColumns: ColumnDef<TableSetup, DocumentRow>[] = [
  {
    accessorKey: "date",
    header: "Tanggal",
    size: 120,
    enableSorting: false,
    meta: { card: "foot", priority: 2 },
    cell: ({ row }) => day(row.original.date),
  },
  {
    accessorKey: "number",
    header: "No faktur",
    size: 160,
    enableSorting: false,
    meta: { card: "id" },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">{row.original.number}</span>
    ),
  },
  {
    accessorKey: "kind",
    header: "Jenis",
    size: 110,
    enableSorting: false,
    meta: { card: "meta", filter: { kind: "option" } },
    cell: ({ row }) => <span className="text-body">{row.original.kind}</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 120,
    enableSorting: false,
    meta: { card: "status", filter: { kind: "option" } },
    cell: ({ row }) => (
      <Status tone={row.original.tone}>{row.original.status}</Status>
    ),
  },
  {
    accessorKey: "supplierId",
    header: "Kode",
    size: 100,
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => (
      <span className="text-mute">{row.original.supplierId}</span>
    ),
  },
  {
    id: "supplier",
    accessorFn: (row) => row.supplierName ?? row.supplierId,
    header: "Supplier",
    size: 240,
    enableSorting: false,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <SupplierName
        id={row.original.supplierId}
        name={row.original.supplierName}
        className="block truncate font-medium text-ink"
      />
    ),
  },
  absent<DocumentRow>("Lokasi", 130),
  {
    accessorKey: "siteId",
    header: "Gudang",
    size: 130,
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => <SiteName id={row.original.siteId} />,
  },
  {
    accessorKey: "total",
    header: "Total",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "lead" },
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        <CellMoney minor={row.original.total} />
      </span>
    ),
  },
  {
    id: "po",
    accessorFn: () => "",
    header: "No PO",
    size: 150,
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) =>
      row.original.bill === null ? (
        dash
      ) : (
        <BillPo id={row.original.bill.invoice_id} />
      ),
  },
  {
    accessorKey: "ppn",
    header: "PPN",
    size: 90,
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => <span className="text-body">{row.original.ppn}</span>,
  },
  {
    accessorKey: "ref",
    header: "No ref",
    size: 130,
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => (
      <span className="block truncate text-body">
        {row.original.ref ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "term",
    header: "Jangka",
    size: 90,
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => (
      <span className="text-body">{row.original.term ?? "—"}</span>
    ),
  },
  {
    accessorKey: "due",
    header: "JTempo",
    size: 120,
    enableSorting: false,
    meta: { card: "hide", priority: 2 },
    cell: ({ row }) => day(row.original.due),
  },
]

/// 7Soft's PEMBELIAN & RETUR: every purchase invoice and every return in the
/// window, newest first, of one supplier or of all. The Pembelian / Retur
/// ticks are the Jenis chips. A purchase opens its bill; a return opens its
/// credit note.
export function PurchasesTab({
  lead,
  controls,
  supplier,
  from,
  to,
  onOpenBill,
  onOpenNote,
}: {
  lead: React.ReactNode
  controls: React.ReactNode
  /// A supplier code, or "" for every supplier.
  supplier: string
  from: string
  to: string
  onOpenBill: (invoiceId: string) => void
  onOpenNote: (note: CreditNote) => void
}) {
  const bills = useBillsInWindow(supplier, from, to)
  const notes = useQuery({
    queryKey: financeKeys.creditNotes(null, supplier === "" ? null : supplier),
    queryFn: ({ signal }) =>
      listCreditNotes(
        { supplier: supplier === "" ? undefined : supplier },
        signal
      ),
  })
  const rows = useMemo<DocumentRow[]>(() => {
    const purchases = bills.rows.map((bill): DocumentRow => {
      const state = billStatus(bill)
      return {
        id: bill.invoice_id,
        kind: "Pembelian",
        date: bill.invoice_date,
        number: bill.invoice_number,
        status: state.word,
        tone: state.tone,
        supplierId: bill.supplier_id,
        supplierName: bill.supplier_name,
        siteId: bill.site_id,
        total: bill.total_minor,
        ppn: ppnCode(bill),
        ref: null,
        term: termOf(bill),
        due: bill.due_date,
        bill,
        note: null,
      }
    })
    const returns = (notes.data ?? [])
      .filter((note) => {
        const date = note.credit_date.slice(0, 10)
        return date >= from && date <= to
      })
      .map((note): DocumentRow => {
        const state = noteStatus(note.status)
        return {
          id: note.credit_note_id,
          kind: "Retur",
          date: note.credit_date,
          number: note.credit_number,
          status: state.word,
          tone: state.tone,
          supplierId: note.supplier_id,
          supplierName: null,
          siteId: note.site_id,
          // A return lowers what is owed, so it reads as a minus.
          total: -note.total_minor,
          ppn: note.tax_minor === 0 ? "PPN0" : "PPN",
          ref: note.their_number,
          term: null,
          due: null,
          bill: null,
          note,
        }
      })
    return [...purchases, ...returns].sort((a, b) =>
      b.date.localeCompare(a.date)
    )
  }, [bills.rows, notes.data, from, to])
  return (
    <InfoTable<DocumentRow>
      lead={lead}
      controls={controls}
      columns={documentColumns}
      rows={rows}
      getId={(row) => `${row.kind}:${row.id}`}
      searchLabel="Search invoices"
      onRowClick={(row) =>
        row.bill !== null
          ? onOpenBill(row.bill.invoice_id)
          : row.note !== null && onOpenNote(row.note)
      }
      empty="No purchase or return in this window."
      loading={bills.query.isPending}
      sheet={() => ({
        filename: `Info-Pembelian-Pembelian-Retur-${from}`,
        sheet: "Pembelian & Retur",
        title: "Info Pembelian · Pembelian & Retur",
        subtitle: `${day(from)} – ${day(to)}`,
        columns: [
          xDate("Tanggal"),
          xText("No faktur", 18),
          xText("Jenis", 12),
          xText("Status", 12),
          xText("Kode", 12),
          xText("Supplier", 36),
          xText("Lokasi", 14),
          xText("Gudang", 24),
          xMoney("Total"),
          xText("No PO", 18),
          xText("PPN", 8),
          xText("No ref", 16),
          xText("Jangka", 8),
          xDate("JTempo"),
        ],
        rows: rows.map((one) => [
          one.date.slice(0, 10),
          one.number,
          one.kind,
          one.status,
          one.supplierId,
          one.supplierName,
          null,
          one.siteId,
          one.total,
          null,
          one.ppn,
          one.ref,
          one.term,
          one.due === null ? null : one.due.slice(0, 10),
        ]),
      })}
    />
  )
}

// ---------------------------------------------------------------------------
// PELUNASAN HUTANG
// ---------------------------------------------------------------------------

type SettlementRow = SettlementLine

const settlementColumns: ColumnDef<TableSetup, SettlementRow>[] = [
  {
    accessorKey: "date",
    header: "Tanggal",
    size: 120,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => day(row.original.date),
  },
  {
    accessorKey: "voucher",
    header: "No voucher",
    size: 160,
    enableSorting: false,
    meta: { card: "id" },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.voucher}
      </span>
    ),
  },
  {
    accessorKey: "invoice",
    header: "No faktur",
    size: 160,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.invoice}
      </span>
    ),
  },
  {
    accessorKey: "bank",
    header: "Bank",
    size: 180,
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => (
      <span className="block truncate text-body">{row.original.bank}</span>
    ),
  },
  {
    id: "supplier",
    accessorFn: (row) => row.supplierName ?? row.supplierId,
    header: "Supplier",
    size: 240,
    enableSorting: false,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <SupplierName
        id={row.original.supplierId}
        name={row.original.supplierName}
        className="block truncate font-medium text-ink"
      />
    ),
  },
  {
    accessorKey: "supplierId",
    header: "Kode",
    size: 100,
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => (
      <span className="text-mute">{row.original.supplierId}</span>
    ),
  },
  absent<SettlementRow>("Lokasi", 130),
  {
    accessorKey: "invoiceTotal",
    header: "Nilai faktur",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "hide", priority: 2 },
    cell: ({ row }) => figure(row.original.invoiceTotal),
  },
  {
    accessorKey: "discount",
    header: "Potongan",
    size: 120,
    enableSorting: false,
    meta: { align: "right", card: "hide", priority: 3 },
    cell: ({ row }) =>
      row.original.discount === 0 ? (
        <span className="text-faint">—</span>
      ) : (
        figure(row.original.discount)
      ),
  },
  {
    accessorKey: "paid",
    header: "Bayar",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "lead" },
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        <CellMoney minor={row.original.paid} />
      </span>
    ),
  },
  {
    accessorKey: "reference",
    header: "No reff",
    size: 130,
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => (
      <span className="block truncate text-body">
        {row.original.reference || "—"}
      </span>
    ),
  },
]

/// 7Soft's PELUNASAN HUTANG: every bill a payment settled in the window, one
/// row per bill per payment — voucher, invoice, bank, the invoice's value, the
/// discount (Potongan), what was paid, and the giro it was written on (its
/// number and due date, from the giro book). A row opens the payment.
export function SettlementsTab({
  lead,
  controls,
  supplier,
  from,
  to,
  onOpenPayment,
}: {
  lead: React.ReactNode
  controls: React.ReactNode
  supplier: string
  from: string
  to: string
  onOpenPayment: (paymentId: string) => void
}) {
  const { query: payments, rows } = useSettlementLines(supplier, from, to)
  const giros = useGiroOfPayment()
  const columns = useMemo<ColumnDef<TableSetup, SettlementRow>[]>(
    () => [
      ...settlementColumns,
      {
        id: "giro-no",
        accessorFn: (row) => giros.get(row.paymentId)?.number ?? "",
        header: "Giro no",
        size: 140,
        enableSorting: false,
        meta: { card: "hide", priority: 3 },
        cell: ({ row }) => (
          <span className="block truncate font-mono text-id text-body">
            {giros.get(row.original.paymentId)?.number ?? "—"}
          </span>
        ),
      },
      {
        id: "giro-due",
        accessorFn: (row) => giros.get(row.paymentId)?.due_date ?? "",
        header: "Giro jtempo",
        size: 130,
        enableSorting: false,
        meta: { card: "hide", priority: 3 },
        cell: ({ row }) => {
          const giro = giros.get(row.original.paymentId)
          return giro === undefined ? dash : day(giro.due_date)
        },
      },
    ],
    [giros]
  )
  const paid = rows.reduce((sum, row) => sum + row.paid, 0)
  const discount = rows.reduce((sum, row) => sum + row.discount, 0)
  return (
    <InfoTable<SettlementRow>
      lead={lead}
      controls={controls}
      columns={columns}
      rows={rows}
      getId={(row) => row.id}
      searchLabel="Search payments"
      onRowClick={(row) => onOpenPayment(row.paymentId)}
      empty="No bill was paid in this window."
      loading={payments.isPending && from <= to}
      more={payments}
      sheet={() => ({
        filename: `Info-Pembelian-Pelunasan-Hutang-${from}`,
        sheet: "Pelunasan Hutang",
        title: "Info Pembelian · Pelunasan Hutang",
        subtitle: `${day(from)} – ${day(to)}`,
        columns: [
          xDate("Tanggal"),
          xText("No voucher", 18),
          xText("No faktur", 18),
          xText("Bank", 24),
          xText("Supplier", 36),
          xText("Kode", 12),
          xText("Lokasi", 14),
          xMoney("Nilai faktur"),
          xMoney("Potongan"),
          xMoney("Bayar"),
          xText("No reff", 16),
          xText("Giro no", 16),
          xDate("Giro jtempo"),
        ],
        rows: rows.map((one) => [
          one.date.slice(0, 10),
          one.voucher,
          one.invoice,
          one.bank,
          one.supplierName,
          one.supplierId,
          null,
          one.invoiceTotal,
          one.discount,
          one.paid,
          one.reference,
          giros.get(one.paymentId)?.number ?? null,
          giros.get(one.paymentId)?.due_date.slice(0, 10) ?? null,
        ]),
      })}
      summary={{
        supplier: `Total · ${count(rows.length)} ${rows.length === 1 ? "line" : "lines"}`,
        discount:
          discount === 0 ? "—" : `Rp ${discount.toLocaleString("id-ID")}`,
        paid: `Rp ${paid.toLocaleString("id-ID")}`,
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// SUMMARY HUTANG
// ---------------------------------------------------------------------------

interface BalanceRow {
  readonly code: string
  readonly name: string
  readonly opening: number
  readonly debit: number
  readonly credit: number
  readonly closing: number
}

const balanceColumns: ColumnDef<TableSetup, BalanceRow>[] = [
  {
    id: "supplier",
    accessorFn: (row) => row.name,
    header: "Supplier",
    size: 280,
    enableSorting: false,
    meta: { card: "title", grow: 240 },
    cell: ({ row }) => (
      <SupplierName
        id={row.original.code}
        className="block truncate font-medium text-ink"
      />
    ),
  },
  {
    accessorKey: "code",
    header: "Kode",
    size: 110,
    enableSorting: false,
    meta: { card: "id", priority: 3 },
    cell: ({ row }) => <span className="text-mute">{row.original.code}</span>,
  },
  {
    accessorKey: "opening",
    header: "Saldo awal",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "metric", priority: 2 },
    cell: ({ row }) => figure(row.original.opening),
  },
  {
    accessorKey: "debit",
    header: "Debet",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "metric", priority: 2 },
    cell: ({ row }) => figure(row.original.debit),
  },
  {
    accessorKey: "credit",
    header: "Kredit",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "metric", priority: 2 },
    cell: ({ row }) => figure(row.original.credit),
  },
  {
    accessorKey: "closing",
    header: "Saldo akhir",
    size: 160,
    enableSorting: false,
    meta: { align: "right", card: "lead" },
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        <CellMoney minor={row.original.closing} />
      </span>
    ),
  },
]

/// 7Soft's SUMMARY HUTANG: for each supplier, what was owed at the start of
/// the window, what was paid (Debet), what was bought (Kredit) and what is
/// owed at its end. The figures are each supplier's ledger
/// (`payment-ledger/SUPPLIER/{code}/movements`); a supplier with nothing in
/// any of the four is left out. A row opens that supplier's Kartu Hutang.
export function BalancesTab({
  lead,
  controls,
  from,
  to,
  unit,
  onOpen,
}: {
  lead: React.ReactNode
  controls: React.ReactNode
  from: string
  to: string
  unit: string
  onOpen: (code: string) => void
}) {
  const book = useSupplierMovements(from, to, unit)
  const rows = useMemo<BalanceRow[]>(
    () =>
      book.rows.flatMap((one) => {
        const m = one.movements
        if (m === undefined) return []
        if (
          m.opening_minor === 0 &&
          m.debit_minor === 0 &&
          m.credit_minor === 0 &&
          m.closing_minor === 0
        )
          return []
        return [
          {
            code: one.code,
            name: one.name,
            opening: m.opening_minor,
            debit: m.debit_minor,
            credit: m.credit_minor,
            closing: m.closing_minor,
          },
        ]
      }),
    [book.rows]
  )
  const total = (pick: (row: BalanceRow) => number) =>
    `Rp ${rows.reduce((sum, row) => sum + pick(row), 0).toLocaleString("id-ID")}`
  return (
    <InfoTable<BalanceRow>
      lead={lead}
      controls={controls}
      columns={balanceColumns}
      rows={rows}
      getId={(row) => row.code}
      searchLabel="Search suppliers"
      onRowClick={(row) => onOpen(row.code)}
      empty="No supplier has a balance or a movement in this window."
      loading={book.pending}
      sheet={() => ({
        filename: `Info-Pembelian-Summary-Hutang-${to}`,
        sheet: "Summary Hutang",
        title: "Info Pembelian · Summary Hutang",
        subtitle: `${day(from)} – ${day(to)}`,
        columns: [
          xText("Supplier", 36),
          xText("Kode", 12),
          xMoney("Saldo awal"),
          xMoney("Debet"),
          xMoney("Kredit"),
          xMoney("Saldo akhir"),
        ],
        rows: rows.map((one) => [
          one.name,
          one.code,
          one.opening,
          one.debit,
          one.credit,
          one.closing,
        ]),
        totalRow: [
          "Total",
          null,
          rows.reduce((sum, one) => sum + one.opening, 0),
          rows.reduce((sum, one) => sum + one.debit, 0),
          rows.reduce((sum, one) => sum + one.credit, 0),
          rows.reduce((sum, one) => sum + one.closing, 0),
        ],
      })}
      summary={{
        supplier: "Total",
        opening: total((row) => row.opening),
        debit: total((row) => row.debit),
        credit: total((row) => row.credit),
        closing: total((row) => row.closing),
      }}
    />
  )
}
