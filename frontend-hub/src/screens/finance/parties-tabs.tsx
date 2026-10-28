import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { CellMoney } from "@/components/ui/rows-switch"
import { EmptyState } from "@/components/ui/states"
import { count, day, label } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { projectionBillsQuery } from "@/lib/queries/finance"
import { memberDirectoryQuery } from "@/lib/queries/members"
import { paymentTermsQuery } from "@/lib/queries/payment-terms"
import { supplierNamesQuery } from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useColumnFit } from "@/screens/finance/column-fit"
import { ppnCode } from "@/screens/finance/purchasing"
import { Code } from "@/screens/finance-final/parts"
import { YesNo } from "@/screens/finance/master-parts"
import type { MemberRow, PaymentTermRow, Supplier } from "@itulah/contract"

/// The rest of 7Soft's Customer · Supplier · Pajak menu, read by Finance.
///
/// 7Soft keeps credit terms, suppliers and customers in this menu and writes
/// them here. The hub keeps each where its owner works — payment terms and
/// suppliers in Master, customers in Sales — and Finance reads them: a second
/// copy in Finance is the one thing the owner ruled out on 27 Oct 2026, because
/// two masters drift. So these tabs show 7Soft's columns from the master's own
/// data, and a row opens that master.

/// A 7Soft column the hub's data does not carry: it keeps its place and reads
/// "—", so the table is 7Soft's and the gap is visible.
const dash = <span className="text-faint">—</span>

// ---------------------------------------------------------------------------
// Jangka Waktu Kredit
// ---------------------------------------------------------------------------

/// Whole days only: a term counted in months from month end has no day figure
/// to print, and its basis column says so.
function daysOf(term: PaymentTermRow): number | null {
  return term.basis === "MONTHS_AFTER_BILL_MONTH_END" ? null : term.offset_value
}

const BASIS_WORDS: Record<string, string> = {
  DAYS_AFTER_BILL: "Days after the bill",
  DAYS_AFTER_BILL_MONTH_END: "Days after the bill's month end",
  MONTHS_AFTER_BILL_MONTH_END: "Months after the bill's month end",
}

/// 7Soft's columns — Nama / Kode, Keterangan, Jangka Wkt (Hari), Default, Aktif
/// — with the hub's basis beside them. Default reads "—": the hub sets a default
/// term on each supplier, not one for the whole company.
const termColumns: ColumnDef<TableSetup, PaymentTermRow>[] = [
  {
    accessorKey: "code",
    header: "Nama / Kode",
    size: 160,
    meta: { card: "meta" },
    cell: ({ row }) => <Code>{row.original.code}</Code>,
  },
  {
    accessorKey: "label",
    header: "Keterangan",
    size: 300,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => <span className="text-ink">{row.original.label}</span>,
  },
  {
    id: "days",
    accessorFn: (row) => daysOf(row) ?? -1,
    header: "Jangka Wkt (Hari)",
    size: 170,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => {
      const days = daysOf(row.original)
      return days === null ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="tabular-nums">{days}</span>
      )
    },
  },
  {
    id: "basis",
    accessorFn: (row) => BASIS_WORDS[row.basis] ?? label(row.basis),
    header: "Counted from",
    size: 280,
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) => (
      <span className="text-body">
        {BASIS_WORDS[row.original.basis] ?? label(row.original.basis)}
      </span>
    ),
  },
  {
    id: "default",
    accessorFn: () => "",
    header: "Default",
    size: 110,
    meta: { align: "center", card: "hide" },
    cell: () => dash,
  },
  {
    id: "active",
    accessorFn: (row) => (row.active ? "Yes" : ""),
    header: "Aktif",
    size: 110,
    meta: { align: "center", card: "status" },
    cell: ({ row }) => <YesNo on={row.original.active} />,
  },
]

export function PaymentTermsTab() {
  const phone = useLayout() === "phone"
  const navigate = useNavigate()
  const list = useQuery(paymentTermsQuery())
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])
  const rows = useMemo(
    () =>
      [...(list.data?.terms ?? [])].sort(
        (a, b) => a.display_order - b.display_order
      ),
    [list.data]
  )
  const [measure, fit] = useColumnFit(termColumns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: termColumns,
        getRowId: (row: PaymentTermRow) => row.code,
        state: {
          globalFilter: needle,
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setNeedle,
        onColumnVisibilityChange: fit.onChange,
      }),
      [rows, needle, sorting, fit]
    )
  )

  return (
    <>
      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search credit terms"
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>
      <DockTools
        search={{
          value: needle,
          onChange: setNeedle,
          label: "Search credit terms",
        }}
        sort={dockSortOf(table)}
      />
      <div ref={measure}>
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          {queryState(list, {
            loading: "Reading the credit terms…",
            render: () =>
              rows.length === 0 ? (
                <EmptyState>No credit term yet.</EmptyState>
              ) : (
                <DataTable<PaymentTermRow>
                  table={table}
                  refresh={[list]}
                  // Terms are written in Master › Payment terms.
                  onRowClick={() =>
                    void navigate({ to: "/master/payment-templates" } as never)
                  }
                  empty="No credit term matches the search."
                  pageScroll
                  cardsApart
                  cardSort={false}
                  summary={{
                    label: (
                      <span>
                        {count(rows.length)}{" "}
                        <span className="font-normal text-body">
                          {rows.length === 1 ? "term" : "terms"} · written in{" "}
                          <AppLink
                            to="/master/payment-templates"
                            className="underline underline-offset-2"
                          >
                            Master › Payment terms
                          </AppLink>
                        </span>
                      </span>
                    ),
                  }}
                />
              ),
          })}
        </Card>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// PPN
// ---------------------------------------------------------------------------

/// A PPN code and what was written under it.
interface PpnRow {
  readonly code: string
  readonly percent: number
  readonly invoices: number
  readonly base: number
  readonly tax: number
}

const ppnColumns: ColumnDef<TableSetup, PpnRow>[] = [
  {
    accessorKey: "code",
    header: "Kode Pajak",
    size: 160,
    meta: { card: "title" },
    cell: ({ row }) => <Code>{row.original.code}</Code>,
  },
  {
    accessorKey: "percent",
    header: "Persen",
    size: 110,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.percent}%</span>
    ),
  },
  {
    id: "default",
    accessorFn: () => "",
    header: "Default",
    size: 110,
    meta: { align: "center", card: "hide" },
    cell: () => dash,
  },
  {
    accessorKey: "invoices",
    header: "Faktur",
    size: 110,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span className="tabular-nums">{count(row.original.invoices)}</span>
    ),
  },
  {
    accessorKey: "base",
    header: "DPP",
    size: 170,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        <CellMoney minor={row.original.base} />
      </span>
    ),
  },
  {
    accessorKey: "tax",
    header: "PPN",
    size: 170,
    meta: { align: "right", card: "lead" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        <CellMoney minor={row.original.tax} />
      </span>
    ),
  },
]

/// 7Soft's Pajak list for PPN: Kode Pajak, Persen, Default. The hub keeps no PPN
/// master — a bill carries the tax in rupiah, not the code it was keyed under —
/// so each code is the one the posted bills' amounts imply (PPN0, PPN11…), with
/// how many faktur wrote it and what they came to. Default reads "—".
export function PpnTab() {
  const phone = useLayout() === "phone"
  const bills = useQuery(projectionBillsQuery("POSTED"))
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])
  const rows = useMemo<PpnRow[]>(() => {
    const by = new Map<string, PpnRow>()
    for (const bill of bills.data ?? []) {
      const code = ppnCode(bill)
      const was = by.get(code)
      const base = bill.subtotal_minor - bill.discount_minor
      by.set(code, {
        code,
        percent: Number(code.slice(3)),
        invoices: (was?.invoices ?? 0) + 1,
        base: (was?.base ?? 0) + base,
        tax: (was?.tax ?? 0) + bill.tax_minor,
      })
    }
    return [...by.values()].sort((a, b) => a.percent - b.percent)
  }, [bills.data])
  const [measure, fit] = useColumnFit(ppnColumns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: ppnColumns,
        getRowId: (row: PpnRow) => row.code,
        state: {
          globalFilter: needle,
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setNeedle,
        onColumnVisibilityChange: fit.onChange,
      }),
      [rows, needle, sorting, fit]
    )
  )
  return (
    <>
      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search PPN codes"
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>
      <DockTools
        search={{
          value: needle,
          onChange: setNeedle,
          label: "Search PPN codes",
        }}
        sort={dockSortOf(table)}
      />
      <div ref={measure}>
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          {queryState(bills, {
            loading: "Reading the PPN codes…",
            render: () =>
              rows.length === 0 ? (
                <EmptyState>No posted faktur yet.</EmptyState>
              ) : (
                <DataTable<PpnRow>
                  table={table}
                  refresh={[bills]}
                  empty="No PPN code matches the search."
                  pageScroll
                  cardsApart
                  cardSort={false}
                />
              ),
          })}
        </Card>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Supplier
// ---------------------------------------------------------------------------

/// 7Soft's Supplier list, column for column: Kode Supplier, Nama Supplier,
/// Termin Pembayaran, Batas Hutang, No NPWP, Diskon, COA Hutang, Termasuk
/// Customer, Keterangan, Aktif. The supplier master holds the code, the name,
/// the term, the NPWP, the note and the status; Batas Hutang, Diskon, COA Hutang
/// and Termasuk Customer are not fields of it and read "—".
function pending<T>(
  header: string,
  size: number,
  align?: "right" | "center"
): ColumnDef<TableSetup, T> {
  return {
    id: `pending-${header}`,
    accessorFn: () => "",
    header,
    size,
    meta: { card: "hide", ...(align ? { align } : {}) },
    cell: () => dash,
  }
}

const supplierColumns: ColumnDef<TableSetup, Supplier>[] = [
  {
    accessorKey: "supplier_code",
    header: "Kode Supplier",
    size: 150,
    meta: { card: "meta" },
    cell: ({ row }) => <Code>{row.original.supplier_code}</Code>,
  },
  {
    accessorKey: "name",
    header: "Nama Supplier",
    size: 320,
    meta: { card: "title", grow: 220 },
    cell: ({ row }) => <span className="text-ink">{row.original.name}</span>,
  },
  {
    id: "terms",
    accessorFn: (row) => row.default_payment_terms_code ?? "",
    header: "Termin Pembayaran",
    size: 190,
    meta: { card: "metric" },
    cell: ({ row }) =>
      row.original.default_payment_terms_code === null ? (
        <span className="text-faint">—</span>
      ) : (
        <Code>{row.original.default_payment_terms_code}</Code>
      ),
  },
  pending<Supplier>("Batas Hutang", 150, "right"),
  {
    id: "npwp",
    accessorFn: (row) => row.npwp ?? "",
    header: "No NPWP",
    size: 210,
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) =>
      row.original.npwp === null || row.original.npwp === "" ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="font-mono text-[0.9375rem] text-body">
          {row.original.npwp}
        </span>
      ),
  },
  pending<Supplier>("Diskon", 110, "right"),
  pending<Supplier>("COA Hutang", 150),
  pending<Supplier>("Termasuk Customer", 170, "center"),
  {
    id: "notes",
    accessorFn: (row) => row.notes ?? "",
    header: "Keterangan",
    size: 240,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) =>
      row.original.notes === null || row.original.notes === "" ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="block truncate text-body" title={row.original.notes}>
          {row.original.notes}
        </span>
      ),
  },
  {
    id: "active",
    accessorFn: (row) => (row.status === "ACTIVE" ? "Yes" : ""),
    header: "Aktif",
    size: 110,
    meta: { align: "center", card: "status" },
    cell: ({ row }) => <YesNo on={row.original.status === "ACTIVE"} />,
  },
]

/// The opening-balance table both parties' detail ends with: 7Soft's Saldo
/// Awal (No Faktur, Tanggal, Jatuh Tempo, Total, Keterangan). The hub keeps no
/// opening invoice per party, so the row reads "—".
function SaldoAwal() {
  return (
    <div>
      <SubHead>Saldo Awal</SubHead>
      <MiniTable
        head={[
          "No faktur",
          "Tanggal",
          "Jatuh tempo",
          { label: "Total", align: "right" },
          "Keterangan",
        ]}
      >
        <MiniRow>
          <MiniCell>—</MiniCell>
          <MiniCell>—</MiniCell>
          <MiniCell>—</MiniCell>
          <MiniCell align="right">—</MiniCell>
          <MiniCell>—</MiniCell>
        </MiniRow>
      </MiniTable>
    </div>
  )
}

/// A supplier as 7Soft's form shows it: the header (Kode, Nama, Termin
/// Pembayaran, Batas Hutang, No NPWP, Diskon, Keterangan, COA Hutang, Termasuk
/// Customer, Status), then the address grid (Lokasi, Alamat, Kontak, Phone,
/// Fax, Bank Account, Aktif and the Kirim / Penagihan / Pajak ticks) and Saldo
/// Awal. What the master does not hold reads "—".
function SupplierSheet({
  supplier,
  onClose,
}: {
  supplier: Supplier
  onClose: () => void
}) {
  const navigate = useNavigate()
  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      title={supplier.name}
      size="wide"
      footer={
        <Button
          variant="primary"
          onClick={() => void navigate({ to: "/master/suppliers" } as never)}
        >
          Open in Master
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <Facts>
          <Fact term="Kode Supplier">{supplier.supplier_code}</Fact>
          <Fact term="Nama Supplier">{supplier.name}</Fact>
          <Fact term="Termin Pembayaran">
            {supplier.default_payment_terms_code ?? "—"}
          </Fact>
          <Fact term="Batas Hutang">—</Fact>
          <Fact term="No NPWP">{supplier.npwp || "—"}</Fact>
          <Fact term="Diskon">—</Fact>
          <Fact term="COA Hutang">—</Fact>
          <Fact term="Termasuk Customer">—</Fact>
          <Fact term="Status">
            {supplier.status === "ACTIVE" ? "Aktif" : "Tidak aktif"}
          </Fact>
          <Fact term="Keterangan" wide>
            {supplier.notes || "—"}
          </Fact>
        </Facts>
        <div>
          <SubHead>Detail 1 of 1</SubHead>
          <MiniTable
            head={[
              "Lokasi",
              "Alamat",
              "Kontak",
              "Phone",
              "Fax",
              "Bank account",
              "Aktif",
              "Kirim",
              "Penagihan",
              "Pajak",
            ]}
          >
            <MiniRow>
              <MiniCell>—</MiniCell>
              <MiniCell>{supplier.address || "—"}</MiniCell>
              <MiniCell>{supplier.contact_name || "—"}</MiniCell>
              <MiniCell>{supplier.phone || "—"}</MiniCell>
              <MiniCell>—</MiniCell>
              <MiniCell>—</MiniCell>
              <MiniCell>
                {supplier.status === "ACTIVE" ? "Ya" : "Tidak"}
              </MiniCell>
              <MiniCell>—</MiniCell>
              <MiniCell>—</MiniCell>
              <MiniCell>—</MiniCell>
            </MiniRow>
          </MiniTable>
        </div>
        <SaldoAwal />
      </div>
    </Sheet>
  )
}

export function SupplierTab() {
  const phone = useLayout() === "phone"
  const list = useQuery(supplierNamesQuery())
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])
  const [opened, setOpened] = useState<Supplier | null>(null)
  const rows = useMemo(() => list.data ?? [], [list.data])
  const [measure, fit] = useColumnFit(supplierColumns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: supplierColumns,
        getRowId: (row: Supplier) => row.supplier_id,
        state: {
          globalFilter: needle,
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setNeedle,
        onColumnVisibilityChange: fit.onChange,
      }),
      [rows, needle, sorting, fit]
    )
  )

  return (
    <>
      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search suppliers"
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>
      <DockTools
        search={{
          value: needle,
          onChange: setNeedle,
          label: "Search suppliers",
        }}
        sort={dockSortOf(table)}
      />
      <div ref={measure}>
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          {queryState(list, {
            loading: "Reading the suppliers…",
            render: () =>
              rows.length === 0 ? (
                <EmptyState>No supplier yet.</EmptyState>
              ) : (
                <DataTable<Supplier>
                  table={table}
                  refresh={[list]}
                  // Read here as 7Soft's form; written in Master.
                  onRowClick={setOpened}
                  empty="No supplier matches the search."
                  pageScroll
                  cardsApart
                  cardSort={false}
                  summary={{
                    name: (
                      <span>
                        {count(rows.length)}{" "}
                        <span className="font-normal text-body">
                          {rows.length === 1 ? "supplier" : "suppliers"} ·
                          written in{" "}
                          <AppLink
                            to="/master/suppliers"
                            className="underline underline-offset-2"
                          >
                            Master › Suppliers
                          </AppLink>
                        </span>
                      </span>
                    ),
                  }}
                />
              ),
          })}
        </Card>
      </div>
      {opened !== null && (
        <SupplierSheet supplier={opened} onClose={() => setOpened(null)} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

/// 7Soft's Customer list: Kode Customer, Nama Customer, Termin Pembayaran, Batas
/// JTempo, Batas Piutang, Rayon, No NPWP, Diskon, Keterangan, Sales, COA Piutang,
/// Tipe Harga Jual, Termasuk Supplier, Aktif. The hub has no credit customers;
/// its customers are the members, so those fill the list: the card number is the
/// code, the name is the name, Aktif is "not blocked". Everything else a credit
/// customer carries reads "—".
const customerColumns: ColumnDef<TableSetup, MemberRow>[] = [
  {
    accessorKey: "member_id",
    header: "Kode Customer",
    size: 150,
    meta: { card: "meta" },
    cell: ({ row }) => <Code>{row.original.member_id}</Code>,
  },
  {
    id: "name",
    accessorFn: (row) => row.display_name ?? "",
    header: "Nama Customer",
    size: 280,
    meta: { card: "title", grow: 220 },
    cell: ({ row }) => (
      <span className="text-ink">{row.original.display_name ?? "—"}</span>
    ),
  },
  pending<MemberRow>("Termin Pembayaran", 170),
  pending<MemberRow>("Batas JTempo", 130),
  pending<MemberRow>("Batas Piutang", 150, "right"),
  pending<MemberRow>("Rayon", 110),
  pending<MemberRow>("No NPWP", 170),
  pending<MemberRow>("Diskon", 110, "right"),
  pending<MemberRow>("Keterangan", 180),
  pending<MemberRow>("Sales", 130),
  pending<MemberRow>("COA Piutang", 150),
  pending<MemberRow>("Tipe Harga Jual", 150, "right"),
  pending<MemberRow>("Termasuk Supplier", 170, "center"),
  {
    id: "active",
    accessorFn: (row) => (row.blocked_at === null ? "Yes" : ""),
    header: "Aktif",
    size: 110,
    meta: { align: "center", card: "status" },
    cell: ({ row }) => <YesNo on={row.original.blocked_at === null} />,
  },
]

/// A customer as 7Soft's form shows it. The card's own facts stand where the
/// form has a field for them (Tgl. Lahir, Alamat); the rest reads "—".
function CustomerSheet({
  member,
  onClose,
}: {
  member: MemberRow
  onClose: () => void
}) {
  const navigate = useNavigate()
  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      title={member.display_name ?? member.member_id}
      size="wide"
      footer={
        <Button
          variant="primary"
          onClick={() => void navigate({ to: "/sales/customer" } as never)}
        >
          Open in Sales
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <Facts>
          <Fact term="Kode Customer">{member.member_id}</Fact>
          <Fact term="Nama Customer">{member.display_name ?? "—"}</Fact>
          <Fact term="Termin Pembayaran">—</Fact>
          <Fact term="Sales">—</Fact>
          <Fact term="Batas JTempo">—</Fact>
          <Fact term="COA Piutang">—</Fact>
          <Fact term="Batas Piutang">—</Fact>
          <Fact term="Tipe Harga Jual">—</Fact>
          <Fact term="Rayon">—</Fact>
          <Fact term="Termasuk Supplier">—</Fact>
          <Fact term="No NPWP">—</Fact>
          <Fact term="Status">
            {member.blocked_at === null ? "Aktif" : "Tidak aktif"}
          </Fact>
          <Fact term="Diskon">—</Fact>
          <Fact term="Keterangan">—</Fact>
        </Facts>
        <div>
          <SubHead>Detail 1 of 1</SubHead>
          <MiniTable
            head={[
              "Lokasi",
              "Alamat",
              "Kontak",
              "Tgl. lahir",
              "Phone",
              "Fax",
              "Bank account",
              "Aktif",
              "Kirim",
              "Tagihan",
              "Pajak",
            ]}
          >
            <MiniRow>
              <MiniCell>—</MiniCell>
              <MiniCell>{member.address ?? "—"}</MiniCell>
              <MiniCell>—</MiniCell>
              <MiniCell>
                {member.birth_date ? day(member.birth_date) : "—"}
              </MiniCell>
              <MiniCell>—</MiniCell>
              <MiniCell>—</MiniCell>
              <MiniCell>—</MiniCell>
              <MiniCell>{member.blocked_at === null ? "Ya" : "Tidak"}</MiniCell>
              <MiniCell>—</MiniCell>
              <MiniCell>—</MiniCell>
              <MiniCell>—</MiniCell>
            </MiniRow>
          </MiniTable>
        </div>
        <SaldoAwal />
      </div>
    </Sheet>
  )
}

export function CustomerTab() {
  const phone = useLayout() === "phone"
  const list = useInfiniteQuery(memberDirectoryQuery({}))
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])
  const [opened, setOpened] = useState<MemberRow | null>(null)
  const rows = useMemo(
    () => list.data?.pages.flatMap((page) => page.members) ?? [],
    [list.data]
  )
  const total = list.data?.pages[0]?.total ?? rows.length
  const [measure, fit] = useColumnFit(customerColumns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: customerColumns,
        getRowId: (row: MemberRow) => row.member_id,
        state: {
          globalFilter: needle,
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setNeedle,
        onColumnVisibilityChange: fit.onChange,
      }),
      [rows, needle, sorting, fit]
    )
  )

  return (
    <>
      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search customers"
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>
      <DockTools
        search={{
          value: needle,
          onChange: setNeedle,
          label: "Search customers",
        }}
        sort={dockSortOf(table)}
      />
      <div ref={measure}>
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          {queryState(list, {
            loading: "Reading the customers…",
            render: () =>
              rows.length === 0 ? (
                <EmptyState>No customer yet.</EmptyState>
              ) : (
                <DataTable<MemberRow>
                  table={table}
                  more={list}
                  onRowClick={setOpened}
                  empty="No customer matches the search."
                  pageScroll
                  cardsApart
                  cardSort={false}
                  summary={{
                    name: (
                      <span>
                        {count(total)}{" "}
                        <span className="font-normal text-body">
                          {total === 1 ? "customer" : "customers"} ·{" "}
                          <AppLink
                            to="/sales/customer"
                            className="underline underline-offset-2"
                          >
                            Sales › Customer
                          </AppLink>
                        </span>
                      </span>
                    ),
                  }}
                />
              ),
          })}
        </Card>
      </div>
      {opened !== null && (
        <CustomerSheet member={opened} onClose={() => setOpened(null)} />
      )}
    </>
  )
}
