import { useQueries, useQuery } from "@tanstack/react-query"
import { ChevronLeft } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { DayRange, type DayWindow } from "@/components/ui/day-range"
import { Field, Input, Select } from "@/components/ui/field"
import { ExportCsv } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import type { CsvColumn } from "@/lib/csv"
import { count, day, money } from "@/lib/format"
import {
  cashDocument,
  cashDocumentKeys,
  cashDocumentsQuery,
} from "@/lib/queries/cash-documents"
import {
  accountLedger,
  financeKeys,
  ledgerWindowQuery,
  listGiros,
  moneyOverviewQuery,
} from "@/lib/queries/finance"
import { todayIso } from "@/screens/finance/chart"
import { giroStatusWord, type GiroWord } from "@/screens/finance/giro-words"
import {
  useMeaningLabel,
  useSupplierName,
  useWindow,
} from "@/screens/finance/hooks"
import { ScreenPending } from "@/screens/finance/pending"
import { Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import type {
  CashDocumentRow,
  GiroRow,
  MoneyAccountRow,
} from "@itulah/contract"

/// Laporan Kas/Bank — the twenty reports of 7Soft 6.6 (manual hal. 192-199).
///
/// 7Soft's way is kept: a numbered list of reports, one picked, its selection
/// box (the days, the Kas/Bank, the customer or supplier, the document number,
/// the giro status ALL / NEW / CAIR / TOLAKAN), then the report in 7Soft's
/// columns with its totals. The report follows the selection as it is typed.
///
/// # Where the figures come from
///
/// Nothing is added up that the books have not already said:
///
/// - the balances (Saldo awal, Debet, Kredit, Saldo akhir) are the ledger
///   window of each Kas/Bank account (`GET /accounts/{code}/ledger`);
/// - the movements are that ledger's rows, and the BKM / BKK numbers, names
///   and lines are the posted cash documents (`GET /cash-documents`);
/// - the giro reports are the giro register (`GET /giros`), a BKM's issuing
///   bank taken from the BKM that received it.
///
/// A ledger is read 200 rows at a time per account; a window with more says so
/// under its totals.

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

type Ask = "day" | "range" | "account" | "party" | "doc" | "status"

interface Spec {
  readonly n: number
  readonly title: string
  readonly ask: readonly Ask[]
}

const SPECS: readonly Spec[] = [
  { n: 1, title: "Laporan Harian Kas & Bank", ask: ["day", "account"] },
  { n: 2, title: "Laporan Harian Kas-Bank Detail", ask: ["day", "account"] },
  {
    n: 3,
    title: "Laporan Harian Kas-Bank Detail Per Transaksi",
    ask: ["day", "account"],
  },
  {
    n: 4,
    title: "Laporan Kas-Bank Detail Per Transaksi Periodik",
    ask: ["range", "account"],
  },
  { n: 5, title: "Laporan Kas-Bank Per Periode", ask: ["range", "account"] },
  {
    n: 6,
    title: "Laporan Kas-Bank Per Periode Detail",
    ask: ["range", "account"],
  },
  {
    n: 7,
    title: "Summary Pelunasan Piutang",
    ask: ["range", "account", "doc"],
  },
  { n: 8, title: "Detail Pelunasan Piutang", ask: ["range", "account", "doc"] },
  { n: 9, title: "Summary Pelunasan Hutang", ask: ["range", "account", "doc"] },
  { n: 10, title: "Detail Pelunasan Hutang", ask: ["range", "account", "doc"] },
  {
    n: 11,
    title: "Summary Bukti Kas Masuk (BKM)",
    ask: ["range", "account", "doc"],
  },
  {
    n: 12,
    title: "Detail Bukti Kas Masuk (BKM)",
    ask: ["range", "account", "doc"],
  },
  {
    n: 13,
    title: "Summary Bukti Kas Keluar (BKK)",
    ask: ["range", "account", "doc"],
  },
  {
    n: 14,
    title: "Detail Bukti Kas Keluar (BKK)",
    ask: ["range", "account", "doc"],
  },
  {
    n: 15,
    title: "Laporan Giro Masuk",
    ask: ["range", "party", "doc", "status"],
  },
  {
    n: 16,
    title: "Laporan Giro Keluar",
    ask: ["range", "party", "doc", "status"],
  },
  {
    n: 17,
    title: "Laporan Giro Masuk Belum Cair",
    ask: ["range", "party", "doc", "status"],
  },
  {
    n: 18,
    title: "Laporan Giro Keluar Belum Cair",
    ask: ["range", "party", "doc", "status"],
  },
  {
    n: 19,
    title: "Laporan Perincian Tolakan Giro Masuk",
    ask: ["range", "party", "doc"],
  },
  {
    n: 20,
    title: "Laporan Perincian Tolakan Giro Keluar",
    ask: ["range", "party", "doc"],
  },
]

type GiroStatus = "ALL" | "NEW" | "CAIR" | "TOLAKAN"
const GIRO_STATUSES: readonly GiroStatus[] = ["ALL", "NEW", "CAIR", "TOLAKAN"]

interface Params {
  readonly day: string
  readonly range: DayWindow
  /// `unit \t code` of one Kas/Bank, or "" for all.
  readonly account: string
  readonly party: string
  readonly doc: string
}

export function LaporanKasBank() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Laporan Kas/Bank" title="Laporan">
          Reading the accounts…
        </ScreenPending>
      }
    >
      <LaporanScreen />
    </Suspense>
  )
}

function LaporanScreen() {
  const win = useWindow()
  const [picked, setPicked] = useState<number | null>(null)
  const [params, setParams] = useState<Params>({
    day: todayIso(),
    range: { from: win.from, to: win.to },
    account: "",
    party: "",
    doc: "",
  })
  const spec = SPECS.find((one) => one.n === picked) ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Laporan Kas/Bank"
        title={spec === null ? "Laporan Kas/Bank" : spec.title}
        actions={
          spec === null ? undefined : (
            <Button variant="primary" onClick={() => setPicked(null)}>
              <ChevronLeft className="size-3.5" />
              Laporan
            </Button>
          )
        }
      />
      {spec === null ? (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-hairline">
            {SPECS.map((one) => (
              <li key={one.n}>
                <button
                  type="button"
                  onClick={() => setPicked(one.n)}
                  className="flex min-h-12 w-full items-baseline gap-4 px-5 py-3 text-left text-[0.9375rem] text-ink hover:bg-soft"
                >
                  <span className="w-7 shrink-0 text-right text-mute tabular-nums">
                    {one.n}
                  </span>
                  <span>{one.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <>
          <SelectionBox spec={spec} params={params} onChange={setParams} />
          <ReportBody n={spec.n} params={params} />
        </>
      )}
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// The selection box
// ---------------------------------------------------------------------------

/// The Kas/Bank accounts a report can be asked about: every mapped money
/// account but the card receivables, which 7Soft keeps out of Kas/Bank.
function useKasBankAccounts(): readonly MoneyAccountRow[] {
  const overview = useQuery(moneyOverviewQuery())
  return useMemo(
    () =>
      (overview.data?.rows ?? [])
        .filter((row) => row.pot !== "CARD_RECEIVABLE")
        .sort(
          (a, b) =>
            a.account_code.localeCompare(b.account_code) ||
            a.unit_id.localeCompare(b.unit_id)
        ),
    [overview.data]
  )
}

function accountKey(row: { account_code: string; unit_id: string }): string {
  return `${row.unit_id}\t${row.account_code}`
}

function SelectionBox({
  spec,
  params,
  onChange,
}: {
  spec: Spec
  params: Params
  onChange: (next: Params) => void
}) {
  const accounts = useKasBankAccounts()
  const set = (patch: Partial<Params>) => onChange({ ...params, ...patch })
  const has = (ask: Ask) => spec.ask.includes(ask)
  const party = spec.n % 2 === 1 ? "Customer" : "Supplier"
  const docWord = has("status")
    ? spec.n % 2 === 1
      ? "No BKM"
      : "No BKK"
    : spec.n === 19
      ? "No BKM"
      : spec.n === 20
        ? "No BKK"
        : "No dokumen"

  return (
    <Toolbar className="group/bar">
      {has("day") && (
        <Field label="Tanggal">
          <Day value={params.day} onChange={(next) => set({ day: next })} />
        </Field>
      )}
      {has("range") && (
        <DayRange
          label="Periode"
          placeholder="Periode"
          value={params.range}
          onChange={(next) => set({ range: next })}
          className="h-control min-h-0 w-52 shrink-0 py-0"
        />
      )}
      {has("account") && (
        <Select
          value={params.account}
          onChange={(next) => set({ account: next })}
          aria-label="Kas/Bank"
          className="h-control w-64"
        >
          <option value="">All Kas/Bank</option>
          {accounts.map((row) => (
            <option key={accountKey(row)} value={accountKey(row)}>
              {row.account_code} · {row.account_name}
            </option>
          ))}
        </Select>
      )}
      {has("party") && (
        <Input
          value={params.party}
          onChange={(event) => set({ party: event.target.value })}
          placeholder={`Nama ${party.toLowerCase()}`}
          aria-label={`Nama ${party.toLowerCase()}`}
          className="h-control w-56"
        />
      )}
      {has("doc") && (
        <Input
          value={params.doc}
          onChange={(event) => set({ doc: event.target.value })}
          placeholder={docWord}
          aria-label={docWord}
          className="h-control w-44"
        />
      )}
    </Toolbar>
  )
}

// ---------------------------------------------------------------------------
// The report, as a table
// ---------------------------------------------------------------------------

type Cell = string | number | null

/// `band` opens a section (one account, one customer), `row` is a line of the
/// report, `line` is a line under a voucher, `sub` a subtotal and `total` the
/// closing figures.
interface Line {
  readonly kind: "row" | "band" | "line" | "sub" | "total"
  readonly cells: readonly Cell[]
}

interface Col {
  readonly label: string
  /// Figures: money, right-aligned.
  readonly money?: boolean
}

interface Model {
  readonly head: readonly Col[]
  readonly lines: readonly Line[]
}

function Report({
  title,
  period,
  model,
  pending,
  emptyText,
  after,
}: {
  title: string
  period: string
  model: Model | null
  pending: boolean
  emptyText: string
  after?: React.ReactNode
}) {
  if (pending || model === null) return <LoadingState>Reading…</LoadingState>
  const csv: CsvColumn<Line>[] = model.head.map((col, index) => ({
    label: col.label,
    value: (line) => line.cells[index] ?? null,
  }))
  const body = model.lines.filter((line) => line.kind !== "band")
  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[0.9375rem] text-ink">
          <span className="font-medium">{title}</span>
          <span className="ml-3 text-mute tabular-nums">{period}</span>
        </p>
        <ExportCsv title={title} columns={csv} rows={() => model.lines} />
      </div>
      {body.length === 0 ? (
        <EmptyState>{emptyText}</EmptyState>
      ) : (
        <Card className="overflow-hidden max-md:overflow-visible">
          <Grid>
            <thead>
              <tr>
                {model.head.map((col) => (
                  <Th key={col.label} align={col.money ? "right" : undefined}>
                    {col.label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.lines.map((line, at) => {
                const cells = line.cells.map((cell, index) => {
                  const col = model.head[index]
                  return (
                    <Td
                      key={index}
                      align={col?.money ? "right" : undefined}
                      className={line.kind === "line" ? "text-mute" : undefined}
                    >
                      {typeof cell === "number" ? money(cell) : (cell ?? "")}
                    </Td>
                  )
                })
                if (line.kind === "band")
                  return (
                    <tr key={at}>
                      <Td
                        colSpan={model.head.length}
                        className="bg-soft font-medium text-ink"
                      >
                        {line.cells[0]}
                      </Td>
                    </tr>
                  )
                if (line.kind === "total")
                  return <TotalRow key={at}>{cells}</TotalRow>
                return (
                  <tr
                    key={at}
                    className={line.kind === "sub" ? "font-medium" : undefined}
                  >
                    {cells}
                  </tr>
                )
              })}
            </tbody>
          </Grid>
        </Card>
      )}
      {after}
    </>
  )
}

function periodText(params: Params, one: boolean): string {
  return one
    ? day(params.day)
    : `${day(params.range.from)} – ${day(params.range.to)}`
}

function ReportBody({ n, params }: { n: number; params: Params }) {
  const spec = SPECS.find((one) => one.n === n)
  if (spec === undefined) return null
  const oneDay = n <= 3
  const from = oneDay ? params.day : params.range.from
  const to = oneDay ? params.day : params.range.to
  const period = periodText(params, oneDay)
  if (n === 1 || n === 5)
    return (
      <BalancesReport
        title={spec.title}
        period={period}
        from={from}
        to={to}
        account={params.account}
      />
    )
  if (n >= 2 && n <= 6)
    return (
      <MovementsReport
        title={spec.title}
        period={period}
        from={from}
        to={to}
        account={params.account}
        perLine={n === 3 || n === 4}
      />
    )
  if (n >= 7 && n <= 14)
    return (
      <VouchersReport
        title={spec.title}
        period={period}
        side={n === 7 || n === 8 || n === 11 || n === 12 ? "RECEIVE" : "PAY"}
        mode={n <= 10 ? "settle" : "other"}
        detail={n % 2 === 0}
        params={params}
      />
    )
  if (n >= 15 && n <= 18)
    return (
      <GiroReport
        title={spec.title}
        period={period}
        direction={n % 2 === 1 ? "IN" : "OUT"}
        unpaid={n >= 17}
        params={params}
      />
    )
  return (
    <TolakanReport
      title={spec.title}
      period={period}
      direction={n === 19 ? "IN" : "OUT"}
      params={params}
    />
  )
}

// ---------------------------------------------------------------------------
// 1 and 5 — the balances
// ---------------------------------------------------------------------------

function pickAccounts(
  accounts: readonly MoneyAccountRow[],
  account: string
): readonly MoneyAccountRow[] {
  return account === ""
    ? accounts
    : accounts.filter((row) => accountKey(row) === account)
}

function BalancesReport({
  title,
  period,
  from,
  to,
  account,
}: {
  title: string
  period: string
  from: string
  to: string
  account: string
}) {
  const all = useKasBankAccounts()
  const accounts = pickAccounts(all, account)
  const windows = useQueries({
    queries: accounts.map((row) =>
      ledgerWindowQuery(row.account_code, row.unit_id, from, to)
    ),
  })
  const rejected = useQuery(giroRegisterQuery("IN"))

  const model = useMemo<Model>(() => {
    const lines: Line[] = []
    let opening = 0
    let debit = 0
    let credit = 0
    let closing = 0
    accounts.forEach((row, index) => {
      const data = windows[index]?.data
      if (data === undefined) return
      opening += data.opening_minor
      debit += data.window_debit_minor
      credit += data.window_credit_minor
      closing += data.closing_minor
      lines.push({
        kind: "row",
        cells: [
          row.account_code,
          row.account_name,
          data.opening_minor,
          data.window_debit_minor,
          data.window_credit_minor,
          data.closing_minor,
        ],
      })
    })
    lines.push({
      kind: "total",
      cells: ["", "Total", opening, debit, credit, closing],
    })
    // The giros that bounced and were not replaced: money counted on that is
    // not in the bank.
    if (rejected.data !== undefined) {
      const bounced = rejected.data
        .filter(
          (giro) => giro.status === "REJECTED" && giro.replaced_by === null
        )
        .reduce((sum, giro) => sum + giro.amount_minor, 0)
      lines.push({
        kind: "sub",
        cells: ["", "Saldo tolakan giro masuk", null, null, null, bounced],
      })
    }
    return {
      head: [
        { label: "Kode acc" },
        { label: "Nama kas/bank" },
        { label: "Saldo awal", money: true },
        { label: "Debet", money: true },
        { label: "Kredit", money: true },
        { label: "Saldo akhir", money: true },
      ],
      lines,
    }
  }, [accounts, windows, rejected.data])

  return (
    <Report
      title={title}
      period={period}
      model={model}
      pending={windows.some((one) => one.isPending)}
      emptyText="No cash or bank account is mapped yet."
    />
  )
}

/// The giro register of one direction, every status: the giro reports read
/// it, and the balances read the bounced ones off it.
const giroRegisterQuery = (direction: "IN" | "OUT") => ({
  queryKey: [...financeKeys.all, "giros", "register", direction],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    listGiros({ direction, limit: 500 }, signal),
  staleTime: 30_000,
})

// ---------------------------------------------------------------------------
// 2, 3, 4 and 6 — the movements
// ---------------------------------------------------------------------------

function MovementsReport({
  title,
  period,
  from,
  to,
  account,
  perLine,
}: {
  title: string
  period: string
  from: string
  to: string
  account: string
  /// Every line of a voucher, not its sum only.
  perLine: boolean
}) {
  const all = useKasBankAccounts()
  const accounts = pickAccounts(all, account)
  const meaningLabel = useMeaningLabel()
  const ledgers = useQueries({
    queries: accounts.map((row) => ({
      queryKey: [
        ...financeKeys.all,
        "kas-bank-report",
        "moves",
        row.account_code,
        row.unit_id,
        from,
        to,
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        accountLedger(
          row.account_code,
          { unit: row.unit_id, from, to, limit: 200 },
          signal
        ),
    })),
  })
  const paid = useQuery(cashDocumentsQuery("PAY", "POSTED"))
  const received = useQuery(cashDocumentsQuery("RECEIVE", "POSTED"))
  const documents = useMemo(
    () =>
      new Map(
        [...(paid.data ?? []), ...(received.data ?? [])].map(
          (doc) => [doc.document_id, doc] as const
        )
      ),
    [paid.data, received.data]
  )

  // Per Transaksi: the lines of each voucher the ledger names.
  const ids = useMemo(() => {
    if (!perLine) return []
    const seen = new Set<string>()
    for (const ledger of ledgers)
      for (const row of ledger.data?.rows ?? [])
        if (row.source_kind === "CASH_DOC" && row.source_id !== null)
          seen.add(row.source_id)
    return [...seen]
  }, [ledgers, perLine])
  const details = useQueries({
    queries: ids.map((id) => ({
      queryKey: cashDocumentKeys.detail(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        cashDocument(id, signal),
    })),
  })
  const detailOf = useMemo(
    () =>
      new Map(
        details.flatMap((one) =>
          one.data === undefined ? [] : [[one.data.document_id, one.data]]
        )
      ),
    [details]
  )

  const model = useMemo<Model>(() => {
    const lines: Line[] = []
    let grandDebit = 0
    let grandCredit = 0
    let grandClose = 0
    accounts.forEach((row, index) => {
      const data = ledgers[index]?.data
      if (data === undefined) return
      grandDebit += data.window_debit_minor
      grandCredit += data.window_credit_minor
      grandClose += data.closing_minor
      lines.push({
        kind: "band",
        cells: [`${row.account_code} · ${row.account_name}`],
      })
      lines.push({
        kind: "sub",
        cells: ["", "", "Saldo awal", "", null, null, data.opening_minor],
      })
      for (const entry of data.rows) {
        const doc =
          entry.source_id === null ? undefined : documents.get(entry.source_id)
        lines.push({
          kind: "row",
          cells: [
            day(entry.posting_date),
            doc?.number ?? entry.entry_number,
            entry.supplier_name ?? doc?.party_name ?? "",
            entry.memo ?? "",
            entry.debit_minor === 0 ? null : entry.debit_minor,
            entry.credit_minor === 0 ? null : entry.credit_minor,
            entry.running_minor,
          ],
        })
        const detail =
          entry.source_id === null ? undefined : detailOf.get(entry.source_id)
        if (perLine && detail !== undefined)
          for (const part of detail.lines) {
            const signed =
              part.kind === "OFFSET" ? -part.amount_minor : part.amount_minor
            lines.push({
              kind: "line",
              cells: [
                "",
                part.invoice_number ??
                  part.advance_number ??
                  part.account_code ??
                  meaningLabel(part.semantic_key),
                "",
                part.note ?? "",
                entry.debit_minor > 0 ? signed : null,
                entry.credit_minor > 0 ? signed : null,
                null,
              ],
            })
          }
      }
      lines.push({
        kind: "total",
        cells: [
          "",
          "",
          "Saldo akhir",
          "",
          data.window_debit_minor,
          data.window_credit_minor,
          data.closing_minor,
        ],
      })
      if (data.total > data.rows.length)
        lines.push({
          kind: "sub",
          cells: [
            "",
            "",
            `${count(data.rows.length)} of ${count(data.total)} lines`,
            "",
            null,
            null,
            null,
          ],
        })
    })
    if (accounts.length > 1)
      lines.push({
        kind: "total",
        cells: [
          "",
          "",
          "Total semua kas/bank",
          "",
          grandDebit,
          grandCredit,
          grandClose,
        ],
      })
    return {
      head: [
        { label: "Tanggal" },
        { label: perLine ? "No transaksi / nota" : "No transaksi" },
        { label: "Nama client" },
        { label: "Keterangan" },
        { label: "Debet", money: true },
        { label: "Kredit", money: true },
        { label: "Saldo", money: true },
      ],
      lines,
    }
  }, [accounts, ledgers, documents, detailOf, perLine, meaningLabel])

  return (
    <Report
      title={title}
      period={period}
      model={model}
      pending={ledgers.some((one) => one.isPending)}
      emptyText="Nothing moved in this period."
    />
  )
}

// ---------------------------------------------------------------------------
// 7 to 14 — the vouchers
// ---------------------------------------------------------------------------

function VouchersReport({
  title,
  period,
  side,
  mode,
  detail,
  params,
}: {
  title: string
  period: string
  side: "RECEIVE" | "PAY"
  /// Pelunasan (settled bills) or lain-lain (everything else).
  mode: "settle" | "other"
  detail: boolean
  params: Params
}) {
  const all = useKasBankAccounts()
  const accounts = pickAccounts(all, params.account)
  const meaningLabel = useMeaningLabel()
  const supplierName = useSupplierName()
  const list = useQuery(cashDocumentsQuery(side, "POSTED"))
  const docs = useMemo(() => {
    const needle = params.doc.trim().toLowerCase()
    return (list.data ?? [])
      .filter((doc) => {
        if (doc.doc_date < params.range.from || doc.doc_date > params.range.to)
          return false
        if (needle !== "" && !(doc.number ?? "").toLowerCase().includes(needle))
          return false
        if (params.account === "") return true
        return accounts.some((row) => moneyMatches(doc, row))
      })
      .sort((a, b) => a.doc_date.localeCompare(b.doc_date))
  }, [list.data, params.range, params.doc, params.account, accounts])
  const details = useQueries({
    queries: docs.map((doc) => ({
      queryKey: cashDocumentKeys.detail(doc.document_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        cashDocument(doc.document_id, signal),
    })),
  })

  const word = side === "PAY" ? "BKK" : "BKM"
  const model = useMemo<Model>(() => {
    const lines: Line[] = []
    let sumAmount = 0
    let sumDiscount = 0
    let sumCash = 0
    docs.forEach((doc, index) => {
      const full = details[index]?.data
      if (full === undefined) return
      const parts = full.has_lines
        ? full.lines.filter((part) =>
            mode === "settle" ? part.kind === "SETTLE" : part.kind === "OTHER"
          )
        : []
      // A plain document, keyed without lines, is money for something other
      // than a bill.
      const plain = !full.has_lines && mode === "other"
      if (parts.length === 0 && !plain) return
      const amount = plain
        ? doc.amount_minor
        : parts.reduce((sum, part) => sum + part.amount_minor, 0)
      const discount = parts.reduce((sum, part) => sum + part.discount_minor, 0)
      sumAmount += amount
      sumDiscount += discount
      sumCash += doc.amount_minor
      const money_ = moneyText(doc, meaningLabel)
      lines.push({
        kind: detail ? "sub" : "row",
        cells: [
          day(doc.doc_date),
          doc.number ?? "",
          doc.party_type === "SUPPLIER"
            ? supplierName(doc.supplier_id, doc.party_name)
            : doc.party_name,
          money_,
          "",
          doc.memo,
          detail ? null : amount,
          detail ? null : discount === 0 ? null : discount,
          doc.amount_minor,
        ],
      })
      if (detail)
        for (const part of parts)
          lines.push({
            kind: "line",
            cells: [
              "",
              "",
              "",
              "",
              part.invoice_number ??
                part.account_code ??
                meaningLabel(part.semantic_key),
              part.note ?? "",
              part.amount_minor,
              part.discount_minor === 0 ? null : part.discount_minor,
              null,
            ],
          })
    })
    if (lines.length > 0)
      lines.push({
        kind: "total",
        cells: [
          "",
          `${count(lines.filter((line) => line.kind === "row" || line.kind === "sub").length)} ${word}`,
          "",
          "",
          "",
          "Total",
          sumAmount,
          sumDiscount,
          sumCash,
        ],
      })
    return {
      head: [
        { label: "Tanggal" },
        { label: `No ${word}` },
        { label: "Nama client" },
        { label: "Kas/Bank" },
        { label: mode === "settle" ? "No nota" : "Akun" },
        { label: "Keterangan" },
        { label: mode === "settle" ? "Dilunasi" : "Jumlah", money: true },
        { label: "Potongan", money: true },
        { label: side === "PAY" ? "Kas keluar" : "Kas masuk", money: true },
      ],
      lines,
    }
  }, [docs, details, detail, mode, side, word, meaningLabel, supplierName])

  return (
    <Report
      title={title}
      period={period}
      model={model}
      pending={list.isPending || details.some((one) => one.isPending)}
      emptyText={`No ${word} of this kind in this period.`}
    />
  )
}

function moneyMatches(doc: CashDocumentRow, row: MoneyAccountRow): boolean {
  const key = doc.kind === "PAY" ? doc.from_key : doc.to_key
  const qualifier = doc.kind === "PAY" ? doc.from_qualifier : doc.to_qualifier
  const unit = doc.kind === "PAY" ? doc.from_unit : doc.to_unit
  return (
    key === row.semantic_key &&
    qualifier === row.qualifier &&
    unit === row.unit_id
  )
}

function moneyText(
  doc: CashDocumentRow,
  meaningLabel: (key: string | null | undefined) => string
): string {
  const key = doc.kind === "PAY" ? doc.from_key : doc.to_key
  const qualifier = doc.kind === "PAY" ? doc.from_qualifier : doc.to_qualifier
  return `${meaningLabel(key)}${qualifier === "" ? "" : ` · ${qualifier}`}`
}

// ---------------------------------------------------------------------------
// 15 to 18 — the giros
// ---------------------------------------------------------------------------

function wordStatus(word: GiroWord): GiroStatus | null {
  if (word === "New") return "NEW"
  if (word === "Cair") return "CAIR"
  if (word === "Tolakan") return "TOLAKAN"
  return null
}

function GiroReport({
  title,
  period,
  direction,
  unpaid,
  params,
}: {
  title: string
  period: string
  direction: "IN" | "OUT"
  /// Belum Cair: only NEW and TOLAKAN, grouped by customer or supplier.
  unpaid: boolean
  params: Params
}) {
  const supplierName = useSupplierName()
  const [status, setStatus] = useState<GiroStatus>("ALL")
  const register = useQuery(giroRegisterQuery(direction))
  const receipts = useQuery({
    ...cashDocumentsQuery("RECEIVE"),
    enabled: direction === "IN",
  })
  const drawnOn = useMemo(
    () =>
      new Map(
        (receipts.data ?? []).map(
          (doc) => [doc.document_id, doc.giro_bank] as const
        )
      ),
    [receipts.data]
  )
  const received = direction === "IN"

  const base = useMemo(() => {
    const party = params.party.trim().toLowerCase()
    const needle = params.doc.trim().toLowerCase()
    return (register.data ?? []).filter((giro) => {
      const word = wordStatus(giroStatusWord(giro))
      if (word === null) return false
      if (unpaid && word === "CAIR") return false
      if (giro.issue_date < params.range.from) return false
      if (giro.issue_date > params.range.to) return false
      if (
        party !== "" &&
        !supplierName(giro.party_name, giro.party_name)
          .toLowerCase()
          .includes(party)
      )
        return false
      if (
        needle !== "" &&
        !(giro.cash_document_number ?? giro.payment_number ?? "")
          .toLowerCase()
          .includes(needle)
      )
        return false
      return true
    })
  }, [register.data, params, unpaid, supplierName])
  const shown = useMemo(
    () =>
      base.filter(
        (giro) =>
          status === "ALL" || wordStatus(giroStatusWord(giro)) === status
      ),
    [base, status]
  )

  const model = useMemo<Model>(() => {
    const doc = received ? "No BKM" : "No BKK"
    const head: Col[] = [
      { label: doc },
      { label: "No cek/giro" },
      { label: received ? "Customer" : "Supplier" },
      { label: "Tanggal buat" },
      { label: "Jatuh tempo" },
      { label: "Tanggal cair" },
      ...(received ? [{ label: "Bank" }] : []),
      { label: received ? "Bank tujuan" : "Bank asal" },
      { label: "Total", money: true },
      { label: "Status" },
    ]
    const cellsOf = (giro: GiroRow): Cell[] => [
      giro.cash_document_number ?? giro.payment_number ?? "—",
      giro.number,
      supplierName(giro.party_name, giro.party_name),
      day(giro.issue_date),
      day(giro.due_date),
      giro.cleared_on === null ? "—" : day(giro.cleared_on),
      ...(received ? [drawnOn.get(giro.cash_document_id ?? "") || "—"] : []),
      giro.bank,
      giro.amount_minor,
      giroStatusWord(giro).toUpperCase(),
    ]
    const lines: Line[] = []
    const blanks = (n: number): Cell[] => Array.from({ length: n }, () => "")
    const at = head.length - 2
    if (unpaid) {
      const groups = new Map<string, GiroRow[]>()
      for (const giro of shown) {
        const name = supplierName(giro.party_name, giro.party_name)
        groups.set(name, [...(groups.get(name) ?? []), giro])
      }
      for (const [name, rows] of [...groups.entries()].sort((a, b) =>
        a[0].localeCompare(b[0])
      )) {
        lines.push({ kind: "band", cells: [name] })
        for (const giro of rows)
          lines.push({ kind: "row", cells: cellsOf(giro) })
        lines.push({
          kind: "sub",
          cells: [
            ...blanks(at - 1),
            "Subtotal",
            rows.reduce((sum, giro) => sum + giro.amount_minor, 0),
            "",
          ],
        })
      }
    } else
      for (const giro of [...shown].sort((a, b) =>
        a.issue_date.localeCompare(b.issue_date)
      ))
        lines.push({ kind: "row", cells: cellsOf(giro) })
    if (shown.length > 0)
      lines.push({
        kind: "total",
        cells: [
          ...blanks(at - 1),
          "Total",
          shown.reduce((sum, giro) => sum + giro.amount_minor, 0),
          "",
        ],
      })
    return { head, lines }
  }, [shown, received, unpaid, supplierName, drawnOn])

  const counts = (one: GiroStatus) =>
    one === "ALL"
      ? base.length
      : base.filter((giro) => wordStatus(giroStatusWord(giro)) === one).length

  return (
    <>
      <SubTabs
        value={status}
        onChange={(next) => setStatus(next as GiroStatus)}
        tabs={GIRO_STATUSES.filter((one) => !unpaid || one !== "CAIR").map(
          (one) => ({
            value: one,
            label: (
              <>
                {one}
                <span className="ml-1.5 text-mute tabular-nums">
                  {count(counts(one))}
                </span>
              </>
            ),
            short: one,
          })
        )}
      />
      <Report
        title={title}
        period={period}
        model={model}
        pending={register.isPending}
        emptyText="No giro matches this selection."
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// 19 and 20 — the bounced giros
// ---------------------------------------------------------------------------

function TolakanReport({
  title,
  period,
  direction,
  params,
}: {
  title: string
  period: string
  direction: "IN" | "OUT"
  params: Params
}) {
  const supplierName = useSupplierName()
  const register = useQuery(giroRegisterQuery(direction))
  const received = direction === "IN"

  const model = useMemo<Model>(() => {
    const party = params.party.trim().toLowerCase()
    const needle = params.doc.trim().toLowerCase()
    const rows = (register.data ?? [])
      .filter((giro) => {
        // Bounced now, or bounced once and since put back.
        if (giro.rejected_on === null && giro.status !== "REJECTED")
          return false
        const on = giro.rejected_on ?? giro.issue_date
        if (on < params.range.from || on > params.range.to) return false
        if (
          party !== "" &&
          !supplierName(giro.party_name, giro.party_name)
            .toLowerCase()
            .includes(party)
        )
          return false
        return (
          needle === "" ||
          (giro.cash_document_number ?? giro.payment_number ?? "")
            .toLowerCase()
            .includes(needle)
        )
      })
      .sort((a, b) => (a.rejected_on ?? "").localeCompare(b.rejected_on ?? ""))
    const lines: Line[] = rows.map((giro) => ({
      kind: "row",
      cells: [
        giro.cash_document_number ?? giro.payment_number ?? "—",
        giro.number,
        supplierName(giro.party_name, giro.party_name),
        giro.rejected_on === null ? "—" : day(giro.rejected_on),
        giro.rejected_reason ?? "—",
        giro.amount_minor,
        giro.replacement_number ?? "—",
        giro.replacement_number !== null || giro.replaced_by !== null
          ? "DIGANTI"
          : giro.status === "REJECTED"
            ? "TOLAKAN"
            : giroStatusWord(giro).toUpperCase(),
      ],
    }))
    if (rows.length > 0)
      lines.push({
        kind: "total",
        cells: [
          "",
          "",
          "",
          "",
          "Total",
          rows.reduce((sum, giro) => sum + giro.amount_minor, 0),
          "",
          "",
        ],
      })
    return {
      head: [
        { label: received ? "No BKM" : "No BKK" },
        { label: "No cek/giro" },
        { label: received ? "Customer" : "Supplier" },
        { label: "Tanggal tolak" },
        { label: "Alasan" },
        { label: "Total", money: true },
        { label: "Pengganti" },
        { label: "Status" },
      ],
      lines,
    }
  }, [register.data, params, supplierName, received])

  return (
    <Report
      title={title}
      period={period}
      model={model}
      pending={register.isPending}
      emptyText="No giro was bounced in this period."
    />
  )
}
