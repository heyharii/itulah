import { Printer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { terbilang } from "@/lib/terbilang"
import type { JournalEntry, Minor } from "@/screens/finance-lab/engine/types"
import { rp } from "@/screens/finance-lab/parts"

/// The documents this module puts on paper.
///
/// # Why `window.print()` on its own was not printing
///
/// The one Print button this module had called `window.print()` and produced
/// the browser's idea of the page: the sidebar, the filter row, the KPI cards
/// and a table cut off at the margin. That is a screenshot of an application,
/// not a document — and the things a finance office actually prints are
/// documents with a fixed shape that somebody signs.
///
/// So printing here means: render the document, preview it on screen, and let
/// the print stylesheet hide everything that is not it.
///
/// # Which documents, and why these
///
/// The client's own journal is organised by document number, and the families
/// in it name themselves:
///
///   BKK   Bukti Kas Keluar — money out, signed by three people
///   BKM   Bukti Kas Masuk — money in
///   GL    the general journal
///   giro  the instrument itself
///
/// Those are what gets printed, so those are what this file draws.
///
/// # Why the amount appears twice
///
/// A figure can be altered with a pen and words cannot, which is why every
/// instrument in the world carries both. `terbilang` is not decoration on a
/// bilyet giro: a bank rejects one whose words and figures disagree.

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/// The print stylesheet.
///
/// `visibility` rather than `display`, because collapsing the app's layout
/// mid-print is how a document ends up on page three. Everything is hidden,
/// the document is made visible again, and it is lifted to the top-left of the
/// sheet so it does not inherit the app's scroll position.
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .fin-print, .fin-print * { visibility: visible !important; }
  .fin-print {
    position: absolute !important;
    left: 0; top: 0; right: 0;
    padding: 0 !important;
    margin: 0 !important;
    box-shadow: none !important;
    border: 0 !important;
  }
  .fin-print .fin-noprint { display: none !important; }

  /* A report runs over pages. Repeat the heading on each one, never split a
     row across the fold, and keep a total with the rows it totals — three
     rules that are the difference between a document and a long screenshot. */
  .fin-print thead { display: table-header-group; }
  .fin-print tfoot { display: table-footer-group; }
  .fin-print tr { break-inside: avoid; page-break-inside: avoid; }
  .fin-print .fin-keep { break-inside: avoid; page-break-inside: avoid; }
  .fin-print .fin-break { break-before: page; page-break-before: always; }

  @page { margin: 14mm; }
}
`

/// A document, previewed on screen and printed on its own.
export function PrintSheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width="wide"
      actions={
        <Button variant="primary" onClick={() => window.print()}>
          <Printer className="size-3.5" />
          Print
        </Button>
      }
    >
      <style>{PRINT_CSS}</style>
      <div className="fin-print bg-canvas text-ink">{children}</div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Shared furniture
// ---------------------------------------------------------------------------

/// The client, as it appears on their own paper.
///
/// Exported since 2026-09-13: the Letters module prints the company's goods
/// receipt notes and delivery notes, and a second copy of the address is a
/// second thing to forget on the day they move.
export const COMPANY = {
  name: "CENTRAL FASHION STORE",
  address: "JL. Moh Yamin No. 1",
  phone: "0747 322806",
}

function Letterhead({
  title,
  right,
}: {
  title: string
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b-2 border-ink pb-2">
      <div className="min-w-0">
        <div className="text-[0.9375rem] font-semibold tracking-[0.04em] text-ink uppercase">
          {COMPANY.name}
        </div>
        <div className="text-[0.6875rem] text-body">{COMPANY.address}</div>
        <div className="text-[0.6875rem] text-body">{COMPANY.phone}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[0.9375rem] font-semibold tracking-[0.06em] text-ink uppercase">
          {title}
        </div>
        {right && (
          <div className="mt-0.5 text-[0.6875rem] text-body">{right}</div>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  children,
  wide,
}: {
  label: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <div className="text-[0.625rem] tracking-[0.06em] text-mute uppercase">
        {label}
      </div>
      <div className="mt-0.5 border-b border-dotted border-hairline-2 pb-0.5 text-[0.8125rem] text-ink">
        {children}
      </div>
    </div>
  )
}

/// Three names and three empty boxes. Not padding: a BKK at this client is not
/// a valid document until it carries them, and a printed voucher with nowhere
/// to sign gets handwritten in the margin.
function Signatures({ roles }: { roles: readonly string[] }) {
  return (
    <div
      className="mt-8 grid gap-6"
      style={{ gridTemplateColumns: `repeat(${roles.length}, 1fr)` }}
    >
      {roles.map((r) => (
        <div key={r} className="text-center">
          <div className="text-[0.6875rem] text-body">{r}</div>
          <div className="mt-10 border-t border-ink pt-1 text-[0.625rem] text-mute">
            nama &amp; tanggal
          </div>
        </div>
      ))}
    </div>
  )
}

function AmountInWords({ amount }: { amount: Minor }) {
  return (
    <div className="mt-3 border border-hairline bg-soft px-3 py-2">
      <div className="text-[0.625rem] tracking-[0.06em] text-mute uppercase">
        Terbilang
      </div>
      <div className="mt-0.5 text-[0.8125rem] leading-snug text-ink italic">
        # {terbilang(amount)} #
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bilyet giro
// ---------------------------------------------------------------------------

/// The instrument itself.
///
/// Laid out the way a giro leaf is: bank and number at the top, the order to
/// pay in the middle, the two amounts, and the value date — which is the whole
/// point of a giro and the one field that makes it not a cheque.
export function GiroSlip({
  number,
  bank,
  payee,
  amount,
  issued_on,
  value_on,
  unit,
  source,
}: {
  number: string
  bank: string
  payee: string
  amount: Minor
  issued_on: string
  value_on: string
  unit: string
  source?: string
}) {
  return (
    <div className="border-2 border-ink p-4">
      <div className="flex items-start justify-between gap-6 border-b border-ink pb-2">
        <div>
          <div className="text-[1rem] font-semibold tracking-[0.08em] text-ink uppercase">
            Bilyet Giro
          </div>
          <div className="text-[0.6875rem] text-body">{bank}</div>
        </div>
        <div className="text-right">
          <div className="text-[0.625rem] tracking-[0.06em] text-mute uppercase">
            Nomor
          </div>
          <div className="font-mono text-[0.9375rem] font-semibold text-ink">
            {number}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[0.8125rem] leading-relaxed text-ink">
        Diminta kepada Saudara supaya pada tanggal{" "}
        <span className="font-semibold underline">{value_on}</span>{" "}
        memindahbukukan dana atas beban rekening kami kepada:
      </p>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Nama penerima" wide>
          {payee}
        </Field>
        <Field label="Jumlah">{rp(amount)}</Field>
        <Field label="Tanggal penarikan">{issued_on}</Field>
      </div>

      <AmountInWords amount={amount} />

      <div className="mt-3 flex items-end justify-between gap-6">
        <div className="text-[0.6875rem] text-body">
          <div>Unit: {unit}</div>
          {source && <div>Untuk pembayaran: {source}</div>}
        </div>
        <div className="w-52 text-center">
          <div className="text-[0.6875rem] text-body">{COMPANY.name}</div>
          <div className="mt-10 border-t border-ink pt-1 text-[0.625rem] text-mute">
            tanda tangan &amp; cap
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Kas voucher — BKK and BKM
// ---------------------------------------------------------------------------

/// Bukti Kas Keluar or Bukti Kas Masuk.
///
/// One component because they are one document with the arrow reversed: the
/// client's own numbering says so — `C006-BKK-26-07-00046` and
/// `C006-BKM-26-07-00003` differ by three characters and by nothing else.
export function CashVoucher({
  kind,
  number,
  on,
  unit,
  counterparty,
  amount,
  memo,
  lines,
}: {
  kind: "BKK" | "BKM"
  number: string
  on: string
  unit: string
  counterparty: string
  amount: Minor
  memo?: string
  lines: readonly { account: string; code: string; amount: Minor }[]
}) {
  const out = kind === "BKK"
  return (
    <div>
      <Letterhead
        title={out ? "Bukti Kas Keluar" : "Bukti Kas Masuk"}
        right={
          <>
            <span className="font-mono">{number}</span> · {on}
          </>
        }
      />

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label={out ? "Dibayarkan kepada" : "Diterima dari"} wide>
          {counterparty}
        </Field>
        <Field label="Unit">{unit}</Field>
        <Field label="Jumlah">{rp(amount)}</Field>
        {memo && (
          <Field label="Untuk pembayaran" wide>
            {memo}
          </Field>
        )}
      </div>

      <AmountInWords amount={amount} />

      <table className="mt-4 w-full border-collapse text-[0.75rem]">
        <thead>
          <tr className="border-y border-ink">
            <th className="py-1 text-left tracking-[0.06em] text-mute uppercase">
              Perkiraan
            </th>
            <th className="py-1 text-left tracking-[0.06em] text-mute uppercase">
              Kode
            </th>
            <th className="py-1 text-right tracking-[0.06em] text-mute uppercase">
              Jumlah
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-hairline">
              <td className="py-1 text-ink">{l.account}</td>
              <td className="py-1 font-mono text-[0.6875rem] text-body">
                {l.code}
              </td>
              <td className="py-1 text-right text-ink tabular-nums">
                {rp(l.amount)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-ink font-semibold">
            <td className="py-1 text-ink" colSpan={2}>
              Jumlah
            </td>
            <td className="py-1 text-right text-ink tabular-nums">
              {rp(amount)}
            </td>
          </tr>
        </tbody>
      </table>

      <Signatures
        roles={[
          "Dibuat oleh",
          "Diperiksa",
          "Disetujui",
          out ? "Penerima" : "Penyetor",
        ]}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bukti jurnal
// ---------------------------------------------------------------------------

/// A journal entry on paper, with both columns and the proof it balances.
export function JournalVoucher({ entry }: { entry: JournalEntry }) {
  const debit = entry.lines.reduce((n, l) => n + l.debit, 0)
  const credit = entry.lines.reduce((n, l) => n + l.credit, 0)
  return (
    <div>
      <Letterhead
        title="Bukti Jurnal"
        right={
          <>
            <span className="font-mono">{entry.entry_number}</span> ·{" "}
            {entry.dates.posting_on}
          </>
        }
      />

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Dokumen">{entry.document_ref}</Field>
        <Field label="Sumber">{entry.source_kind}</Field>
        <Field label="Keterangan" wide>
          {entry.memo ?? "—"}
        </Field>
      </div>

      <table className="mt-4 w-full border-collapse text-[0.75rem]">
        <thead>
          <tr className="border-y border-ink">
            <th className="py-1 text-left tracking-[0.06em] text-mute uppercase">
              Kode
            </th>
            <th className="py-1 text-left tracking-[0.06em] text-mute uppercase">
              Perkiraan
            </th>
            <th className="py-1 text-left tracking-[0.06em] text-mute uppercase">
              Unit
            </th>
            <th className="py-1 text-right tracking-[0.06em] text-mute uppercase">
              Debet
            </th>
            <th className="py-1 text-right tracking-[0.06em] text-mute uppercase">
              Kredit
            </th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((l) => (
            <tr key={l.line_no} className="border-b border-hairline align-top">
              <td className="py-1 font-mono text-[0.6875rem] text-body">
                {l.account_code}
              </td>
              <td className="py-1 text-ink">
                {l.account_name}
                {l.memo && (
                  <div className="text-[0.625rem] text-mute">{l.memo}</div>
                )}
              </td>
              <td className="py-1 text-body">{l.unit_id}</td>
              <td className="py-1 text-right text-ink tabular-nums">
                {l.debit ? rp(l.debit) : ""}
              </td>
              <td className="py-1 text-right text-ink tabular-nums">
                {l.credit ? rp(l.credit) : ""}
              </td>
            </tr>
          ))}
          <tr className="border-t border-ink font-semibold">
            <td className="py-1 text-ink" colSpan={3}>
              {debit === credit ? "Seimbang" : "TIDAK SEIMBANG"}
            </td>
            <td className="py-1 text-right text-ink tabular-nums">
              {rp(debit)}
            </td>
            <td className="py-1 text-right text-ink tabular-nums">
              {rp(credit)}
            </td>
          </tr>
        </tbody>
      </table>

      <AmountInWords amount={debit} />
      <Signatures roles={["Dibuat oleh", "Diperiksa", "Disetujui"]} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rekening koran
// ---------------------------------------------------------------------------

/// One account's movements with a running balance — what the office means by
/// "print the rekening koran".
export function LedgerPrint({
  account,
  code,
  unit,
  from,
  to,
  opening,
  lines,
}: {
  account: string
  code: string
  unit?: string
  from: string
  to: string
  opening: Minor
  lines: readonly {
    on: string
    entry: string
    doc: string
    memo: string
    debit: Minor
    credit: Minor
    running: Minor
  }[]
}) {
  const debit = lines.reduce((n, l) => n + l.debit, 0)
  const credit = lines.reduce((n, l) => n + l.credit, 0)
  return (
    <div>
      <Letterhead title="Buku Besar" right={`${from} — ${to}`} />

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Perkiraan" wide>
          <span className="font-mono">{code}</span> {account}
        </Field>
        <Field label="Unit">{unit ?? "—"}</Field>
        <Field label="Saldo awal">{rp(opening)}</Field>
      </div>

      <table className="mt-4 w-full border-collapse text-[0.75rem]">
        <thead>
          <tr className="border-y border-ink">
            <th className="py-1 text-left tracking-[0.06em] text-mute uppercase">
              Tanggal
            </th>
            <th className="py-1 text-left tracking-[0.06em] text-mute uppercase">
              Jurnal
            </th>
            <th className="py-1 text-left tracking-[0.06em] text-mute uppercase">
              Dokumen
            </th>
            <th className="py-1 text-left tracking-[0.06em] text-mute uppercase">
              Keterangan
            </th>
            <th className="py-1 text-right tracking-[0.06em] text-mute uppercase">
              Debet
            </th>
            <th className="py-1 text-right tracking-[0.06em] text-mute uppercase">
              Kredit
            </th>
            <th className="py-1 text-right tracking-[0.06em] text-mute uppercase">
              Saldo
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-hairline">
              <td className="py-1 whitespace-nowrap text-body">{l.on}</td>
              <td className="py-1 font-mono text-[0.6875rem] text-body">
                {l.entry}
              </td>
              <td className="py-1 font-mono text-[0.6875rem] text-body">
                {l.doc}
              </td>
              <td className="py-1 text-ink">{l.memo || "—"}</td>
              <td className="py-1 text-right text-ink tabular-nums">
                {l.debit ? rp(l.debit) : ""}
              </td>
              <td className="py-1 text-right text-ink tabular-nums">
                {l.credit ? rp(l.credit) : ""}
              </td>
              <td className="py-1 text-right font-semibold text-ink tabular-nums">
                {rp(l.running)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-ink font-semibold">
            <td className="py-1 text-ink" colSpan={4}>
              {lines.length} baris
            </td>
            <td className="py-1 text-right text-ink tabular-nums">
              {rp(debit)}
            </td>
            <td className="py-1 text-right text-ink tabular-nums">
              {rp(credit)}
            </td>
            <td className="py-1 text-right text-ink tabular-nums">
              {rp(lines.at(-1)?.running ?? opening)}
            </td>
          </tr>
        </tbody>
      </table>

      <Signatures roles={["Dibuat oleh", "Diperiksa"]} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Which document an entry is
// ---------------------------------------------------------------------------

/// What the client calls this piece of paper, read from their own numbering.
///
/// `C006-BKK-26-07-00046` is a cash-out voucher and `C006-BKM-26-07-00003` a
/// cash-in one; the two differ by one character and by which way the money
/// went. Everything else prints as a journal voucher. Reading the reference
/// rather than storing a document type keeps one source of truth: the number
/// on the paper.
export function voucherKind(document_ref: string): string {
  if (/-BKK-|^BKK/.test(document_ref)) return "Bukti Kas Keluar"
  if (/-BKM-|^BKM/.test(document_ref)) return "Bukti Kas Masuk"
  return "Bukti Jurnal"
}

/// The right document for an entry.
///
/// A cash voucher only makes sense when exactly one side of the entry is a
/// money account — that is what makes it a receipt or a payment. Anything else
/// is a journal, and printing it as a voucher would invent a counterparty that
/// does not exist.
const MONEY = /^10110(0[1-4])/

export function EntryDocument({ entry }: { entry: JournalEntry }) {
  const money = entry.lines.filter((l) => MONEY.test(l.account_code))
  const others = entry.lines.filter((l) => !MONEY.test(l.account_code))
  const kind = voucherKind(entry.document_ref)

  if (
    (kind === "Bukti Kas Keluar" || kind === "Bukti Kas Masuk") &&
    money.length === 1
  ) {
    const cash = money[0]
    const out = cash.credit > 0
    return (
      <CashVoucher
        kind={out ? "BKK" : "BKM"}
        number={entry.document_ref}
        on={entry.dates.posting_on}
        unit={cash.unit_id}
        counterparty={others[0]?.account_name ?? "—"}
        amount={out ? cash.credit : cash.debit}
        memo={entry.memo}
        lines={others.map((l) => ({
          account: l.account_name,
          code: l.account_code,
          amount: l.debit || l.credit,
        }))}
      />
    )
  }
  return <JournalVoucher entry={entry} />
}

// ---------------------------------------------------------------------------
// Rekening koran — the bank's own record
// ---------------------------------------------------------------------------

/// A bank statement as the office files it, with the status of each line.
///
/// The status column is the reason to print it at all: a statement that shows
/// which lines are still unmatched is a worklist somebody can take away from
/// the screen, and an unannotated one is just the bank's paper again.
export function StatementPrint({
  account,
  bank_account_id,
  unit,
  lines,
}: {
  account: string
  bank_account_id: string
  unit: string
  lines: readonly {
    on: string
    description: string
    direction: "IN" | "OUT"
    amount: Minor
    status: string
  }[]
}) {
  const inflow = lines
    .filter((l) => l.direction === "IN")
    .reduce((n, l) => n + l.amount, 0)
  const outflow = lines
    .filter((l) => l.direction === "OUT")
    .reduce((n, l) => n + l.amount, 0)
  return (
    <div>
      <Letterhead
        title="Rekening Koran"
        right={`${lines[0]?.on ?? "—"} — ${lines.at(-1)?.on ?? "—"}`}
      />

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Rekening" wide>
          {account}{" "}
          <span className="font-mono text-[0.6875rem]">{bank_account_id}</span>
        </Field>
        <Field label="Unit">{unit}</Field>
        <Field label="Jumlah baris">{lines.length}</Field>
      </div>

      <table className="mt-4 w-full border-collapse text-[0.75rem]">
        <thead>
          <tr className="border-y border-ink">
            <th className="py-1 text-left tracking-[0.06em] text-mute uppercase">
              Tanggal
            </th>
            <th className="py-1 text-left tracking-[0.06em] text-mute uppercase">
              Keterangan bank
            </th>
            <th className="py-1 text-right tracking-[0.06em] text-mute uppercase">
              Debet
            </th>
            <th className="py-1 text-right tracking-[0.06em] text-mute uppercase">
              Kredit
            </th>
            <th className="py-1 text-left tracking-[0.06em] text-mute uppercase">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-hairline">
              <td className="py-1 whitespace-nowrap text-body">{l.on}</td>
              <td className="py-1 text-ink">{l.description}</td>
              <td className="py-1 text-right text-ink tabular-nums">
                {l.direction === "OUT" ? rp(l.amount) : ""}
              </td>
              <td className="py-1 text-right text-ink tabular-nums">
                {l.direction === "IN" ? rp(l.amount) : ""}
              </td>
              <td className="py-1 text-body">{l.status.toLowerCase()}</td>
            </tr>
          ))}
          <tr className="border-t border-ink font-semibold">
            <td className="py-1 text-ink" colSpan={2}>
              {lines.length} baris
            </td>
            <td className="py-1 text-right text-ink tabular-nums">
              {rp(outflow)}
            </td>
            <td className="py-1 text-right text-ink tabular-nums">
              {rp(inflow)}
            </td>
            <td />
          </tr>
        </tbody>
      </table>

      <Signatures roles={["Dibuat oleh", "Diperiksa"]} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reports on paper
// ---------------------------------------------------------------------------

export interface ReportColumn {
  readonly label: string
  readonly align?: "left" | "right"
  /// Rendered per row. Returning a string keeps the document plain, which is
  /// what a printed report should be.
  readonly cell: (row: never) => React.ReactNode
}

/// Any list, as a signed document.
///
/// # Why one component for twelve reports
///
/// Because on paper they are the same object: a letterhead, what the report
/// covers, a table, a total, and somewhere to sign. The differences between a
/// payables ageing and a trial balance are the columns, and columns are an
/// argument. Twelve hand-drawn layouts would be twelve chances to print a
/// heading in a different size.
export function ReportPrint<Row>({
  title,
  period,
  scope,
  note,
  columns,
  rows,
  total,
  signatures = ["Dibuat oleh", "Diperiksa", "Disetujui"],
}: {
  title: string
  /// What it covers — a date range, or "as at" a day.
  period: string
  /// Unit, book, or whatever narrows it. Printed so a report cannot be
  /// mistaken for the whole business when it is one shop.
  scope?: string
  note?: React.ReactNode
  columns: readonly {
    label: string
    align?: "left" | "right"
    cell: (row: Row) => React.ReactNode
  }[]
  rows: readonly Row[]
  /// The closing line. Given as cells so it lines up with the columns above it.
  total?: readonly React.ReactNode[]
  signatures?: readonly string[]
}) {
  return (
    <div>
      <Letterhead title={title} right={period} />

      {scope && (
        <div className="mt-2 text-[0.75rem] text-body">
          {scope} · {rows.length} baris
        </div>
      )}

      <table className="mt-4 w-full border-collapse text-[0.75rem]">
        <thead>
          <tr className="border-y border-ink">
            {columns.map((c) => (
              <th
                key={c.label}
                className={cn(
                  "py-1 tracking-[0.06em] text-mute uppercase",
                  c.align === "right" ? "pl-3 text-right" : "pr-2 text-left"
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-hairline align-top">
              {columns.map((c) => (
                <td
                  key={c.label}
                  className={cn(
                    "py-1 text-ink",
                    c.align === "right"
                      ? "pl-3 text-right tabular-nums"
                      : "pr-2"
                  )}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
          {total && (
            <tr className="border-t border-ink font-semibold">
              {total.map((cell, i) => (
                <td
                  key={i}
                  className={cn(
                    "py-1 text-ink",
                    columns[i]?.align === "right"
                      ? "pl-3 text-right tabular-nums"
                      : "pr-2"
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>

      {note && (
        <div className="mt-3 text-[0.6875rem] leading-snug text-body">
          {note}
        </div>
      )}

      <Signatures roles={signatures} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The statements
// ---------------------------------------------------------------------------

export interface StatementRow {
  readonly label: string
  readonly note?: string
  readonly amount: Minor
  readonly kind: "add" | "less" | "subtotal" | "total"
}

/// A profit and loss or a balance sheet.
///
/// # Why not the same component as the lists above
///
/// A statement is a ladder, not a table: the indentation carries the
/// arithmetic, subtotals rule off, and there is exactly one number per line.
/// Forcing it into a five-column grid is how a printed P&L ends up with three
/// empty columns and a reader who has to work out which figures are being
/// added.
export function StatementDoc({
  title,
  period,
  scope,
  rows,
  note,
}: {
  title: string
  period: string
  scope?: string
  rows: readonly StatementRow[]
  note?: React.ReactNode
}) {
  return (
    <div>
      <Letterhead title={title} right={period} />
      {scope && <div className="mt-2 text-[0.75rem] text-body">{scope}</div>}

      <div className="mt-4">
        {rows.map((r, i) => (
          <div
            key={i}
            className={cn(
              "fin-keep flex items-baseline justify-between gap-6 py-1",
              r.kind === "subtotal" &&
                "mt-1 border-t border-hairline pt-1.5 font-semibold",
              r.kind === "total" &&
                "mt-1 border-t-2 border-ink pt-1.5 text-[0.875rem] font-semibold"
            )}
          >
            <div className={cn("min-w-0", r.kind === "less" && "pl-4")}>
              <span className="text-[0.8125rem] text-ink">
                {r.kind === "less" ? "\u2212 " : ""}
                {r.label}
              </span>
              {r.note && (
                <span className="ml-2 text-[0.625rem] text-mute">{r.note}</span>
              )}
            </div>
            <div className="shrink-0 text-[0.8125rem] text-ink tabular-nums">
              {rp(r.amount)}
            </div>
          </div>
        ))}
      </div>

      {note && (
        <div className="mt-4 text-[0.6875rem] leading-snug text-body">
          {note}
        </div>
      )}
      <Signatures roles={["Dibuat oleh", "Diperiksa", "Disetujui"]} />
    </div>
  )
}
