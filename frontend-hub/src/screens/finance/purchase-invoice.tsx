import { useQueries, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { count, day, money } from "@/lib/format"
import { openAdvances } from "@/lib/queries/cash-documents"
import {
  billDetail,
  billItemLines,
  billSettlements,
  financeKeys,
  listBills,
  listPayments,
  supplierAdvance,
} from "@/lib/queries/finance"
import { orderDetailQuery, orderListQuery } from "@/lib/queries/procurement"
import { useSheet } from "@/lib/sheets"
import { useSuppliers } from "@/screens/finance/hooks"
import { SiteName } from "@/screens/finance/parts"
import {
  billStatus,
  invoiceType,
  ppnCode,
  termOf,
  useGiroOfPayment,
} from "@/screens/finance/purchasing"
import { RecordSheet } from "@/screens/finance/supplier-bills"
import type { SupplierBill } from "@itulah/contract"

/// Finance › Purchase Invoices — 7Soft's Faktur Pembelian, in its own menu.
///
/// The Bills screen beside this one is the register: one row per bill, what is
/// owed and to whom. This is the PAPER: a number, a date, a supplier, the
/// delivery lines the bill answers, and the totals a clerk writes on it. The
/// two are deliberately separate rows. A register is read to find something; an
/// invoice is read to agree with the supplier, and 7Soft gives it its own menu
/// for that reason.
///
/// It is also where a new invoice is keyed — 7Soft's New — by the same sheet the
/// register uses, so there is one way to record a bill.
///
/// # What the data carries
///
/// The item lines were written when the bill was matched to its deliveries
/// (quantity × unit price, the article, the PO and the receipt it came from).
/// What a delivery line does NOT carry is the unit, a per-line discount, a
/// note and HPP — those are 7Soft columns this schema does not hold, so they
/// read "—" rather than a number somebody invented. The same goes for No Ref
/// and the supplier's Lokasi.
const NONE = "—"

type Tab = "detail" | "uang-muka" | "pelunasan" | "po-bpb-invoice"

const TABS: readonly (readonly [Tab, string])[] = [
  ["detail", "Detail"],
  ["uang-muka", "Uang Muka"],
  ["pelunasan", "Pelunasan"],
  ["po-bpb-invoice", "PO-BPB-INVOICE"],
]

export function PurchaseInvoices() {
  const navigate = useNavigate()
  const link = useSheet("bill")
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<string | null>(
    link.value !== undefined && link.value !== "new" ? link.value : null
  )
  const [recording, setRecording] = useState(link.value === "new")
  const [tab, setTab] = useState<Tab>("detail")

  const bills = useQuery({
    queryKey: [...financeKeys.bills(null, null), "purchase-invoices"],
    queryFn: ({ signal }) => listBills({ limit: 200 }, signal),
  })

  const rows = useMemo(() => {
    const all = bills.data?.rows ?? []
    const needle = q.trim().toLowerCase()
    return needle === ""
      ? all
      : all.filter(
          (one) =>
            one.invoice_number.toLowerCase().includes(needle) ||
            (one.supplier_name ?? "").toLowerCase().includes(needle)
        )
  }, [bills.data, q])

  const bill = useQuery({
    queryKey: financeKeys.bill(selected ?? ""),
    queryFn: ({ signal }) => billDetail(selected ?? "", signal),
    enabled: selected !== null,
  })
  const lines = useQuery({
    queryKey: [...financeKeys.bill(selected ?? ""), "lines"],
    queryFn: ({ signal }) => billItemLines(selected ?? "", signal),
    enabled: selected !== null,
  })

  const chosen = bill.data
  const state = chosen === undefined ? null : billStatus(chosen)
  const paid = chosen?.payment_state === "PAID"
  const posted = chosen?.status.toUpperCase() === "POSTED"
  const itemLines = lines.data ?? []

  return (
    <PageContent>
      <PageHeader
        title="Faktur Pembelian"
        actions={
          <>
            <Button variant="primary" onClick={() => setRecording(true)}>
              Faktur baru
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                void navigate({ to: "/finance/payables/bills" } as never)
              }
            >
              Bills register
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-inner border border-hairline-2 bg-canvas px-3">
          <Search className="size-4 shrink-0 text-line-ico" />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="No faktur or supplier"
            aria-label="Search purchase invoices"
            className="h-11 min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-mute"
          />
        </label>
        <span className="text-muted text-[0.9375rem]">
          {count(rows.length)} faktur
        </span>
      </div>

      <div className="overflow-auto rounded-card border border-hairline">
        <table className="w-full min-w-[860px] border-collapse text-[0.9375rem]">
          <thead className="bg-band text-muted text-left">
            <tr>
              <th className="px-4 py-3 font-medium">No faktur</th>
              <th className="px-4 py-3 font-medium">Tanggal</th>
              <th className="px-4 py-3 font-medium">Supplier</th>
              <th className="px-4 py-3 font-medium">Gudang</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
              <th className="px-4 py-3 text-right font-medium">Bayar</th>
              <th className="px-4 py-3 text-right font-medium">Sisa</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((one) => {
              const active = one.invoice_id === selected
              const word = billStatus(one)
              return (
                <tr
                  key={one.invoice_id}
                  onClick={() => setSelected(one.invoice_id)}
                  className={`cursor-pointer border-t border-hairline ${
                    active ? "bg-soft" : "hover:bg-soft"
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-ink">
                    {one.invoice_number}
                  </td>
                  <td className="px-4 py-3 text-body">
                    {day(one.invoice_date)}
                  </td>
                  <td className="px-4 py-3 text-body">
                    {one.supplier_name ?? NONE}
                  </td>
                  <td className="text-muted px-4 py-3">
                    <SiteName id={one.site_id} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {money(one.total_minor)}
                  </td>
                  <td className="text-muted px-4 py-3 text-right tabular-nums">
                    {money(one.paid_minor)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {money(one.outstanding_minor)}
                  </td>
                  <td className="px-4 py-3">
                    <Status tone={word.tone}>{word.word}</Status>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="text-muted px-4 py-10 text-center">
                  No faktur matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {chosen && state && (
        <section
          aria-label={`Faktur ${chosen.invoice_number}`}
          className="rounded-card border border-hairline"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-[1.0625rem] font-semibold text-ink">
                {chosen.invoice_number}
              </h2>
              <Status tone={state.tone}>{state.word}</Status>
              {paid && (
                <span className="text-muted text-[0.9375rem] font-semibold">
                  READ ONLY
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={!posted || paid}
                onClick={() =>
                  void navigate({ to: "/finance/cash-bank/bkk" } as never)
                }
              >
                Cash
              </Button>
              <Button
                variant="primary"
                disabled={!posted || paid}
                onClick={() =>
                  void navigate({ to: "/finance/payables/payments" } as never)
                }
              >
                Pay
              </Button>
              <Button
                variant="primary"
                onClick={() =>
                  void navigate({
                    to: "/finance/payables/credit-notes",
                    search: { bill: "new" },
                  } as never)
                }
              >
                Retur
              </Button>
              <Button variant="primary" onClick={() => window.print()}>
                Print
              </Button>
            </div>
          </div>

          <Header bill={chosen} />

          <div
            className="flex gap-1 border-t border-hairline px-4 pt-3"
            role="tablist"
            aria-label="Faktur view"
          >
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`rounded-inner px-3 py-1.5 text-[0.9375rem] ${
                  tab === key
                    ? "bg-accent text-white"
                    : "text-body hover:bg-soft"
                }`}
              >
                {key === "detail" ? `Detail ${count(itemLines.length)}` : label}
              </button>
            ))}
          </div>

          {tab === "detail" && <Detail bill={chosen} lines={itemLines} />}
          {tab === "uang-muka" && <AdvanceTab bill={chosen} />}
          {tab === "pelunasan" && <PaymentTab bill={chosen} />}
          {tab === "po-bpb-invoice" && <ThreeWay lines={itemLines} />}
          <SisaUangMuka supplier={chosen.supplier_id} />
        </section>
      )}

      <RecordSheet
        open={recording}
        onClose={() => {
          setRecording(false)
          if (link.value !== undefined) link.close()
        }}
      />
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// The header, in 7Soft's words and order
// ---------------------------------------------------------------------------

function Header({ bill }: { bill: SupplierBill }) {
  const suppliers = useSuppliers()
  const lines = useQuery({
    queryKey: [...financeKeys.bill(bill.invoice_id), "lines"],
    queryFn: ({ signal }) => billItemLines(bill.invoice_id, signal),
  })
  const supplier = (suppliers.data ?? []).find(
    (one) => one.supplier_code === bill.supplier_id
  )
  const joined = (pick: "po_number" | "receipt_number") => {
    const numbers = [
      ...new Set(
        (lines.data ?? []).flatMap((line) =>
          line[pick] === null ? [] : [line[pick]]
        )
      ),
    ]
    return numbers.length === 0 ? NONE : numbers.join(", ")
  }
  return (
    <div className="grid gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="No faktur" value={bill.invoice_number} />
      <Field label="Tanggal" value={day(bill.invoice_date)} />
      <Field label="Tipe invoice" value={invoiceType(bill)} />
      <Field label="Status" value={billStatus(bill).word} />
      <Field label="Supplier" value={bill.supplier_name ?? NONE} />
      <Field label="Kode supplier" value={bill.supplier_id} />
      <Field label="No PO" value={joined("po_number")} />
      <Field label="No terima" value={joined("receipt_number")} />
      <Field label="Lokasi" value={NONE} />
      <Field label="Alamat" value={supplier?.address ?? NONE} />
      <Field label="Gudang" value={<SiteName id={bill.site_id} />} />
      <Field label="No ref" value={NONE} />
      <Field label="Jangka" value={termOf(bill) ?? NONE} />
      <Field label="J.tempo" value={day(bill.due_date ?? bill.invoice_date)} />
      <Field
        label="Total diskon"
        value={bill.discount_minor === 0 ? NONE : money(bill.discount_minor)}
      />
      <Field label="PPN" value={ppnCode(bill)} />
      <Field label="Keterangan" value={bill.note ?? NONE} span />
    </div>
  )
}

function Field({
  label,
  value,
  span,
}: {
  label: string
  value: React.ReactNode
  span?: boolean
}) {
  return (
    <div className={span ? "sm:col-span-2 xl:col-span-4" : undefined}>
      <span className="text-muted block text-[0.9375rem]">{label}</span>
      <span className="block text-[0.9375rem] text-ink">{value}</span>
    </div>
  )
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-inner border border-hairline px-3 py-2">
      <span className="text-muted block text-[0.9375rem]">{label}</span>
      <span className="block text-[1.0625rem] font-semibold text-ink tabular-nums">
        {value}
      </span>
    </div>
  )
}

const head = "px-3 py-2 font-medium"

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function Detail({
  bill,
  lines,
}: {
  bill: SupplierBill
  lines: {
    line_number: number
    article_code: string | null
    description: string
    quantity: number
    unit_price_minor: number
    line_amount_minor: number
  }[]
}) {
  return (
    <>
      <div className="overflow-auto border-t border-hairline">
        <table className="w-full min-w-[980px] border-collapse text-[0.9375rem]">
          <thead className="bg-band text-muted text-left">
            <tr>
              <th className={head}>#</th>
              <th className={head}>Kode</th>
              <th className={head}>Nama item</th>
              <th className={`${head} text-right`}>Jml</th>
              <th className={head}>Satuan</th>
              <th className={`${head} text-right`}>Harga</th>
              <th className={`${head} text-right`}>Diskon</th>
              <th className={`${head} text-right`}>Total</th>
              <th className={head}>Keterangan</th>
              <th className={`${head} text-right`}>HPP</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.line_number} className="border-t border-hairline">
                <td className="text-muted px-3 py-2">{line.line_number}</td>
                <td className="px-3 py-2 text-body">
                  {line.article_code ?? NONE}
                </td>
                <td className="px-3 py-2 text-ink">{line.description}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {count(line.quantity)}
                </td>
                <td className="text-muted px-3 py-2">{NONE}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(line.unit_price_minor)}
                </td>
                <td className="text-muted px-3 py-2 text-right">{NONE}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(line.line_amount_minor)}
                </td>
                <td className="text-muted px-3 py-2">{NONE}</td>
                <td className="text-muted px-3 py-2 text-right">{NONE}</td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={10} className="text-muted px-3 py-8 text-center">
                  This faktur answers no delivery, so it has no item lines.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 border-t border-hairline px-4 py-4 sm:grid-cols-3">
        <Total label="Total" value={money(bill.subtotal_minor)} />
        <Total label="PPN" value={money(bill.tax_minor)} />
        <Total label="Grand total" value={money(bill.total_minor)} />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Uang Muka
// ---------------------------------------------------------------------------

/// The advances set against this faktur: the advance's own number, date and
/// reference, what it was for, what was applied here and what is left in it.
function AdvanceTab({ bill }: { bill: SupplierBill }) {
  const navigate = useNavigate()
  const settled = useQuery({
    queryKey: financeKeys.billSettlements(bill.invoice_id),
    queryFn: ({ signal }) => billSettlements(bill.invoice_id, signal),
    enabled: bill.status.toUpperCase() === "POSTED",
    retry: false,
    staleTime: 30_000,
  })
  const applied = [
    ...(settled.data?.settlements ?? [])
      .filter(
        (row) =>
          !row.delinked &&
          row.against_voucher_kind.toUpperCase().includes("ADVANCE")
      )
      .reduce(
        (by, row) =>
          by.set(
            row.against_voucher_id,
            (by.get(row.against_voucher_id) ?? 0) + row.amount_minor
          ),
        new Map<string, number>()
      ),
  ]
  const details = useQueries({
    queries: applied.map(([advanceId]) => ({
      queryKey: financeKeys.advance(advanceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        supplierAdvance(advanceId, signal),
      staleTime: 60_000,
      retry: false,
    })),
  })
  return (
    <div className="border-t border-hairline">
      <div className="flex justify-end px-4 pt-3">
        <Button
          variant="primary"
          disabled={bill.outstanding_minor <= 0}
          onClick={() =>
            void navigate({
              to: "/finance/payables/bills",
              search: { bill: bill.invoice_id },
            } as never)
          }
        >
          Apply uang muka
        </Button>
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-[0.9375rem]">
          <thead className="bg-band text-muted text-left">
            <tr>
              <th className={head}>No faktur</th>
              <th className={head}>Tanggal</th>
              <th className={head}>No reff</th>
              <th className={`${head} text-right`}>Total</th>
              <th className={`${head} text-right`}>Uang muka yg diapply</th>
              <th className={`${head} text-right`}>Sisa</th>
            </tr>
          </thead>
          <tbody>
            {applied.map(([advanceId, amount], index) => {
              const advance = details[index]?.data
              return (
                <tr key={advanceId} className="border-t border-hairline">
                  <td className="px-3 py-2 font-mono text-ink">
                    {advance?.advance_number ?? NONE}
                  </td>
                  <td className="px-3 py-2 text-body">
                    {advance ? day(advance.advance_date) : NONE}
                  </td>
                  <td className="px-3 py-2 text-body">
                    {advance?.reference ?? NONE}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {advance ? money(advance.amount_minor) : NONE}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(amount)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {advance ? money(advance.outstanding_minor) : NONE}
                  </td>
                </tr>
              )
            })}
            {applied.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted px-3 py-8 text-center">
                  No uang muka is applied to this faktur.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/// 7Soft's footer line: what the supplier still holds of our advances.
function SisaUangMuka({ supplier }: { supplier: string }) {
  const open = useQuery({
    queryKey: [...financeKeys.all, "supplier-advances", supplier],
    queryFn: ({ signal }) =>
      openAdvances(supplier, signal).then((rows) =>
        rows.filter(
          (row) => row.status === "POSTED" && row.outstanding_minor > 0
        )
      ),
    staleTime: 60_000,
  })
  const left = (open.data ?? []).reduce(
    (sum, row) => sum + row.outstanding_minor,
    0
  )
  return (
    <p className="border-t border-hairline px-4 py-3 text-[0.9375rem] font-semibold text-ink">
      Sisa uang muka : {money(left)}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Pelunasan
// ---------------------------------------------------------------------------

/// The payments that settled this faktur, one row each: voucher, reference,
/// date, the bank, the giro it was written on, what was paid and the discount.
function PaymentTab({ bill }: { bill: SupplierBill }) {
  const giros = useGiroOfPayment()
  const payments = useQuery({
    queryKey: [
      ...financeKeys.payments("POSTED", null, bill.supplier_id),
      "bill",
    ],
    queryFn: ({ signal }) =>
      listPayments(
        { status: "POSTED", supplier: bill.supplier_id, limit: 200 },
        signal
      ),
    enabled: bill.status.toUpperCase() === "POSTED",
    staleTime: 30_000,
  })
  const rows = (payments.data?.rows ?? []).flatMap((payment) =>
    payment.allocations
      .filter((one) => one.invoice_id === bill.invoice_id)
      .map((one) => ({
        key: `${payment.payment_id}:${one.invoice_id}`,
        voucher: payment.payment_number,
        reference: payment.reference,
        date: payment.payment_date,
        bank: payment.account_name ?? payment.method,
        cheque: giros.get(payment.payment_id)?.number ?? null,
        paid: one.amount_minor - one.discount_minor,
        discount: one.discount_minor,
        note: payment.note,
      }))
  )
  const bayar = rows.reduce((sum, row) => sum + row.paid + row.discount, 0)
  return (
    <div className="border-t border-hairline">
      <div className="overflow-auto">
        <table className="w-full min-w-[900px] border-collapse text-[0.9375rem]">
          <thead className="bg-band text-muted text-left">
            <tr>
              <th className={head}>Voucher</th>
              <th className={head}>No reff</th>
              <th className={head}>Tanggal</th>
              <th className={head}>Kas/Bank</th>
              <th className={head}>No cek/BG</th>
              <th className={`${head} text-right`}>Bayar</th>
              <th className={`${head} text-right`}>Potongan</th>
              <th className={head}>Jatuh tempo</th>
              <th className={`${head} text-right`}>Hutang</th>
              <th className={head}>Keterangan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-hairline">
                <td className="px-3 py-2 font-mono text-ink">{row.voucher}</td>
                <td className="px-3 py-2 text-body">{row.reference ?? NONE}</td>
                <td className="px-3 py-2 text-body">{day(row.date)}</td>
                <td className="px-3 py-2 text-body">{row.bank}</td>
                <td className="px-3 py-2 text-body">{row.cheque ?? NONE}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(row.paid)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.discount === 0 ? NONE : money(row.discount)}
                </td>
                <td className="px-3 py-2 text-body">{day(bill.due_date)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(bill.total_minor)}
                </td>
                <td className="px-3 py-2 text-body">{row.note ?? NONE}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="text-muted px-3 py-8 text-center">
                  Nothing has been paid on this faktur.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 border-t border-hairline px-4 py-4 sm:grid-cols-3">
        <Total label="Total hutang" value={money(bill.total_minor)} />
        <Total label="Total bayar" value={money(bayar)} />
        <Total label="Sisa" value={money(bill.outstanding_minor)} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PO-BPB-INVOICE
// ---------------------------------------------------------------------------

/// Each item as ordered, as received and as invoiced: the PO's quantity, the
/// BPB's (what the order says arrived), the invoice's, and what is left
/// between them. Retur is what went back against the order. The order's own
/// lines are read for the first two, so a faktur whose PO cannot be found
/// shows its invoice quantity alone.
function ThreeWay({
  lines,
}: {
  lines: {
    line_number: number
    article_code: string | null
    description: string
    quantity: number
    po_number: string | null
    receipt_number: string | null
  }[]
}) {
  const book = useQuery(orderListQuery())
  const idOf = useMemo(
    () =>
      new Map(
        (book.data ?? []).map((one) => [one.po_number, one.purchase_order_id])
      ),
    [book.data]
  )
  const numbers = [
    ...new Set(
      lines.flatMap((line) => (line.po_number === null ? [] : [line.po_number]))
    ),
  ]
  const orders = useQueries({
    queries: numbers.map((number) => ({
      ...orderDetailQuery(idOf.get(number) ?? ""),
      enabled: idOf.has(number),
    })),
  })
  const byNumber = new Map(
    numbers.map((number, index) => [number, orders[index]?.data] as const)
  )
  return (
    <div className="overflow-auto border-t border-hairline">
      <table className="w-full min-w-[1100px] border-collapse text-[0.9375rem]">
        <thead className="bg-band text-muted text-left">
          <tr>
            <th className={head} rowSpan={2}>
              Nama item
            </th>
            <th className={head} rowSpan={2}>
              Kode item
            </th>
            <th className={head} rowSpan={2}>
              Satuan
            </th>
            <th className={`${head} text-center`} colSpan={3}>
              Qty
            </th>
            <th className={`${head} text-center`} colSpan={2}>
              Sisa
            </th>
            <th className={`${head} text-right`} rowSpan={2}>
              Retur
            </th>
            <th className={head} rowSpan={2}>
              No PO
            </th>
            <th className={head} rowSpan={2}>
              No BPB
            </th>
          </tr>
          <tr>
            <th className={`${head} text-right`}>PO</th>
            <th className={`${head} text-right`}>BPB</th>
            <th className={`${head} text-right`}>Invoice</th>
            <th className={`${head} text-right`}>PO</th>
            <th className={`${head} text-right`}>BPB</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const order =
              line.po_number === null ? undefined : byNumber.get(line.po_number)
            const row = order?.lines.find(
              (one) => one.article_code === line.article_code
            )
            const back =
              order === undefined
                ? undefined
                : order.returns.reduce(
                    (sum, one) =>
                      sum +
                      one.lines
                        .filter((l) => l.article_code === line.article_code)
                        .reduce((n, l) => n + l.quantity, 0),
                    0
                  )
            const ordered = row?.ordered_quantity
            const received = row?.received_quantity
            return (
              <tr key={line.line_number} className="border-t border-hairline">
                <td className="px-3 py-2 text-ink">{line.description}</td>
                <td className="px-3 py-2 text-body">
                  {line.article_code ?? NONE}
                </td>
                <td className="text-muted px-3 py-2">{NONE}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {ordered === undefined ? NONE : count(ordered)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {received === undefined ? NONE : count(received)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {count(line.quantity)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {ordered === undefined || received === undefined
                    ? NONE
                    : count(ordered - received)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {received === undefined
                    ? NONE
                    : count(received - line.quantity)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {back === undefined ? NONE : count(back)}
                </td>
                <td className="px-3 py-2 font-mono text-body">
                  {line.po_number ?? NONE}
                </td>
                <td className="px-3 py-2 font-mono text-body">
                  {line.receipt_number ?? NONE}
                </td>
              </tr>
            )
          })}
          {lines.length === 0 && (
            <tr>
              <td colSpan={11} className="text-muted px-3 py-8 text-center">
                This faktur answers no delivery, so there is no PO or BPB to
                compare.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
