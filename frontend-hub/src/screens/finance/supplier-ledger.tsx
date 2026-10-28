import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { DayRange } from "@/components/ui/day-range"
import { ExportButton } from "@/components/ui/export-button"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { SubTabs } from "@/components/ui/sub-tabs"
import { CellMoney } from "@/components/ui/rows-switch"
import { EmptyState } from "@/components/ui/states"
import { count, day, label, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { fileSafe, type ExportSheet } from "@/lib/export-xlsx"
import { cashDocument, cashDocumentKeys } from "@/lib/queries/cash-documents"
import { financeKeys, partyMovements } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { Code, Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { todayIso } from "@/screens/finance/chart"
import {
  useSupplierName,
  useSuppliers,
  useUnitName,
  useWindow,
  type DateWindow,
} from "@/screens/finance/hooks"
import { CardFigure, PhoneList } from "@/components/ui/phone-cards"
import { CreditNoteDetail } from "@/screens/finance/credit-notes"
import { SupplierPicker, UnitSelect } from "@/screens/finance/parts"
import {
  BalancesTab,
  PurchasesTab,
  SettlementsTab,
  SuppliersTab,
} from "@/screens/finance/purchasing-info"
import { useInfoOpeners } from "@/screens/finance/purchasing"
import { ReportSummary } from "@/screens/finance/report"
import type {
  CreditNote,
  PartyMovementRow,
  PartyMovements,
} from "@itulah/contract"

/// Supplier Ledger — 7Soft's Kartu Hutang, ERPNext's party General Ledger.
///
/// One supplier's movements over a window, with what is owed walking down
/// them. Read from the general ledger's own party lines
/// (`GET /finance/payment-ledger/SUPPLIER/{code}/movements`), so the closing
/// figure is the balance the books carry and not a second opinion assembled
/// from bills and payments. The balance is credits less debits: what is owed
/// to the supplier. A bill raises it; a payment, a discount or an advance
/// lowers it; a negative balance (drawn in brackets) is money the supplier
/// holds of ours.
///
/// The supplier is named by its CODE (`SUP-001`) — bills, payments and the
/// party lines all carry the code, not the register's uuid. It comes from the
/// picker, or from `?supplier=` so Accounts Payable Summary can link here.

/// A balance as an accountant writes it: owed to us, in brackets.
function balance(minor: number): string {
  return minor < 0 ? `(${money(-minor)})` : money(minor)
}

/// `balance`, as a row of the table prints it: without the "Rp" in a compact one.
function BalanceCell({ minor }: { minor: number }) {
  return minor < 0 ? (
    <>
      (<CellMoney minor={-minor} />)
    </>
  ) : (
    <CellMoney minor={minor} />
  )
}

/// The year so far, which is what a ledger is read over. `useWindow`'s
/// default is the month the books are being worked in — right for a month-end
/// report, too narrow for a supplier's history.
function useYearToDate(): DateWindow {
  const [draft, setDraft] = useState(() => {
    const to = todayIso()
    return { from: `${to.slice(0, 4)}-01-01`, to }
  })
  return {
    from: draft.from,
    to: draft.to,
    setFrom: (from) => setDraft((was) => ({ ...was, from })),
    setTo: (to) => setDraft((was) => ({ ...was, to })),
    chip: `${day(draft.from)} – ${day(draft.to)}`,
  }
}

/// 7Soft's Info Pembelian (4.1): SUPPLIER, PEMBELIAN & RETUR, PELUNASAN HUTANG,
/// SUMMARY HUTANG and KARTU HUTANG, as the tabs of one screen. The supplier a
/// reader picks is the page's — `?supplier=`, so Accounts Payable Summary and
/// the Supplier tab can link here — and narrows every tab but the two that are
/// across all suppliers. 7Soft's PO tab is Procurement's.
type InfoTab = "supplier" | "pembelian" | "pelunasan" | "summary" | "kartu"

export function SupplierLedger() {
  const linked = useSheet("supplier")
  const suppliers = useSuppliers()
  const supplierName = useSupplierName()
  const unitName = useUnitName()
  const open = useInfoOpeners()
  const [tab, setTab] = useState<InfoTab>(
    linked.value !== undefined && linked.value !== "" ? "kartu" : "supplier"
  )
  const month = useWindow()
  const year = useYearToDate()
  const [unit, setUnit] = useState("")
  const [noted, setNoted] = useState<CreditNote | null>(null)

  const code = linked.value ?? ""
  const chosen = (suppliers.data ?? []).find(
    (one) => one.supplier_code === code
  )

  /// The window the lists are read over. A ledger is read over the year so far;
  /// the lists over the month the books are open in, as 7Soft's Periode is.
  /// An open end of the box (it can be cleared) is the earliest day the books
  /// can have, or today.
  const range = tab === "kartu" ? year : month
  /// 7Soft's Summary Hutang reads from the start of Periode up to its own
  /// Sampai tanggal, which can stop short of the period's end.
  const [until, setUntil] = useState("")
  const from = range.from === "" ? "2000-01-01" : range.from
  const to =
    tab === "summary" && until !== ""
      ? until
      : range.to === ""
        ? todayIso()
        : range.to
  const client = useQueryClient()

  const ledger = useQuery({
    queryKey: financeKeys.partyMovements(
      "SUPPLIER",
      code,
      from,
      to,
      unit || null
    ),
    queryFn: ({ signal }) =>
      partyMovements(
        "SUPPLIER",
        code,
        { from, to, unit: unit || undefined },
        signal
      ),
    enabled: tab === "kartu" && code !== "" && from <= to,
  })

  const build = (): ExportSheet | null => {
    const data = ledger.data
    if (data === undefined) return null
    const name = supplierName(code)
    return {
      filename: `Kartu-Hutang-${fileSafe(name)}-${data.from}`,
      sheet: "Kartu Hutang",
      title: `Kartu Hutang · ${name}`,
      subtitle: `${day(data.from)} → ${day(data.to)} · ${
        unit === "" ? "all units" : unitName(unit)
      }`,
      columns: [
        { header: "Tanggal", kind: "date", width: 13 },
        { header: "No transaksi", kind: "text", width: 16 },
        { header: "Transaksi", kind: "text", width: 20 },
        { header: "Account", kind: "text", width: 36 },
        { header: "Keterangan", kind: "text", width: 44 },
        { header: "Debet", kind: "money" },
        { header: "Kredit", kind: "money" },
        { header: "Saldo akhir", kind: "money" },
      ],
      rows: [
        [
          data.from,
          null,
          "Saldo awal",
          null,
          null,
          null,
          null,
          data.opening_minor,
        ],
        ...data.rows.map((row) => [
          row.posting_date,
          row.entry_number,
          label(row.source_kind),
          `${row.account_code} ${row.account_name}`,
          row.memo,
          row.debit_minor === 0 ? null : row.debit_minor,
          row.credit_minor === 0 ? null : row.credit_minor,
          row.balance_minor,
        ]),
      ],
      rowStyles: [{ bold: true }],
      totalRow: [
        null,
        null,
        `Total of ${count(data.rows.length)} movements`,
        null,
        null,
        data.debit_minor,
        data.credit_minor,
        data.closing_minor,
      ],
    }
  }

  const lead = (
    <SubTabs
      value={tab}
      onChange={(next) => setTab(next as InfoTab)}
      tabs={[
        { value: "supplier", label: "Supplier" },
        { value: "pembelian", label: "Pembelian & retur" },
        { value: "pelunasan", label: "Pelunasan hutang" },
        { value: "summary", label: "Summary hutang" },
        { value: "kartu", label: "Kartu hutang" },
      ]}
    />
  )
  /// 7Soft's Supplier tick: a supplier picked narrows the tab, none shows all.
  const picker = (
    <SupplierPicker
      value={chosen?.supplier_id ?? ""}
      onPick={(supplier) =>
        supplier === null
          ? linked.close()
          : linked.replace(supplier.supplier_code)
      }
      label="Supplier"
      className="h-control w-72"
    />
  )
  const periode = (
    <DayRange
      label="Periode"
      placeholder="Periode"
      value={{ from: range.from, to: range.to }}
      onChange={(next) => {
        range.setFrom(next.from)
        range.setTo(next.to)
      }}
      className="h-control min-h-0 w-52 shrink-0 py-0"
    />
  )
  const unitBox = (
    <UnitSelect
      value={unit}
      onChange={setUnit}
      className="h-control w-44"
      aria-label="Unit"
    />
  )
  /// 7Soft's Sampai tanggal and Refresh, beside Periode on Summary Hutang.
  const sampai = (
    <>
      <label className="flex items-center gap-1.5 text-[0.9375rem] text-mute">
        Sampai tanggal
        <Day
          value={to}
          onChange={setUntil}
          className="h-8 w-40"
          label="Sampai tanggal"
        />
      </label>
      <Button
        variant="primary"
        onClick={() => {
          void client.invalidateQueries({ queryKey: financeKeys.all })
        }}
      >
        Refresh
      </Button>
    </>
  )
  const openKartu = (supplier: string) => {
    linked.replace(supplier)
    setTab("kartu")
  }

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Payables"
        title="Info Pembelian"
        actions={
          tab === "kartu" ? (
            <ExportButton build={build} disabled={ledger.data === undefined} />
          ) : tab === "supplier" ? (
            <Button variant="primary" onClick={() => void open.newSupplier()}>
              Supplier baru
            </Button>
          ) : tab === "pelunasan" ? (
            <Button variant="primary" onClick={() => void open.giro()}>
              Pencairan giro
            </Button>
          ) : tab === "pembelian" ? (
            <>
              <Button variant="primary" onClick={() => void open.newInvoice()}>
                Nota pembelian baru
              </Button>
              <Button variant="primary" onClick={() => void open.newReturn()}>
                Retur pembelian baru
              </Button>
            </>
          ) : undefined
        }
      />

      {tab === "supplier" ? (
        <SuppliersTab lead={lead} controls={null} onOpen={openKartu} />
      ) : tab === "pembelian" ? (
        <PurchasesTab
          lead={lead}
          controls={
            <>
              {picker}
              {periode}
            </>
          }
          supplier={code}
          from={from}
          to={to}
          onOpenBill={(id) => void open.bill(id)}
          onOpenNote={setNoted}
        />
      ) : tab === "pelunasan" ? (
        <SettlementsTab
          lead={lead}
          controls={
            <>
              {picker}
              {periode}
            </>
          }
          supplier={code}
          from={from}
          to={to}
          onOpenPayment={(id) => void open.payment(id)}
        />
      ) : tab === "summary" ? (
        <BalancesTab
          lead={lead}
          controls={
            <>
              {periode}
              {sampai}
              {unitBox}
            </>
          }
          from={from}
          to={to}
          unit={unit}
          onOpen={openKartu}
        />
      ) : (
        <>
          <Toolbar className="group/bar" lead={lead}>
            {picker}
            {periode}
            {unitBox}
            {code !== "" && (
              <>
                <Toolbar.Spacer />
                <span className="text-[0.9375rem] text-mute">
                  {supplierName(code)} · {range.chip}
                </span>
              </>
            )}
            <div className="md:hidden [&>button]:w-full">
              <ExportButton
                variant="ghost"
                build={build}
                disabled={ledger.data === undefined}
              />
            </div>
          </Toolbar>

          {code === "" ? (
            <EmptyState>Choose a supplier to read its ledger.</EmptyState>
          ) : from > to ? (
            <EmptyState>The window ends before it starts.</EmptyState>
          ) : (
            queryState(ledger, {
              loading: "Reading the supplier's ledger…",
              render: (data) => <Ledger data={data} />,
            })
          )}
        </>
      )}

      {noted !== null && (
        <CreditNoteDetail
          key={noted.credit_note_id}
          note={noted}
          onClose={() => setNoted(null)}
        />
      )}
    </PageContent>
  )
}

function Ledger({ data }: { data: PartyMovements }) {
  const phone = useLayout() === "phone"
  const navigate = useNavigate()
  const client = useQueryClient()
  return (
    <>
      <ReportSummary
        items={[
          { label: "Awal", value: data.opening_minor },
          { label: "Debet (paid)", value: data.debit_minor },
          { label: "Kredit (billed)", value: data.credit_minor },
          { label: "Akhir", value: data.closing_minor },
        ]}
      />
      {phone ? (
        data.rows.length === 0 ? (
          <EmptyState>No movement in this window.</EmptyState>
        ) : (
          <PhoneList
            rows={data.rows.map((row) => {
              const paid = row.debit_minor !== 0
              return {
                key: row.journal_line_id,
                title: label(row.source_kind),
                code: row.entry_number,
                line: row.memo ?? undefined,
                lead: (
                  <CardFigure
                    value={money(paid ? row.debit_minor : row.credit_minor)}
                    caption={paid ? "paid" : "billed"}
                  />
                ),
                foot: (
                  <span className="tabular-nums">
                    {day(row.posting_date)} · Balance{" "}
                    {balance(row.balance_minor)}
                  </span>
                ),
                onOpen: () => void openMovement(row, navigate, client),
              }
            })}
          />
        )
      ) : (
        <Grid followRows>
          <thead>
            <tr>
              <Th width="7.5rem">Tanggal</Th>
              <Th width="8.5rem">No transaksi</Th>
              <Th width="10rem">Transaksi</Th>
              <Th width="100%">Keterangan</Th>
              <Th align="right" width="8.5rem">
                Debet
              </Th>
              <Th align="right" width="8.5rem">
                Kredit
              </Th>
              <Th align="right" width="9.5rem">
                Saldo akhir
              </Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>{day(data.from)}</Td>
              <Td>
                <span className="text-faint">—</span>
              </Td>
              <Td className="font-medium text-ink">Saldo awal</Td>
              <Td />
              <Td />
              <Td />
              <Td align="right">
                <span className="font-medium text-ink">
                  <BalanceCell minor={data.opening_minor} />
                </span>
              </Td>
            </tr>
            {data.rows.map((row) => (
              <MovementRow key={row.journal_line_id} row={row} />
            ))}
            <TotalRow>
              <Td />
              <Td />
              <Td>Total</Td>
              <Td>
                <span className="font-normal text-mute">
                  {count(data.rows.length)}{" "}
                  {data.rows.length === 1 ? "movement" : "movements"}
                </span>
              </Td>
              <Td align="right">{money(data.debit_minor)}</Td>
              <Td align="right">{money(data.credit_minor)}</Td>
              <Td align="right">{balance(data.closing_minor)}</Td>
            </TotalRow>
          </tbody>
        </Grid>
      )}
    </>
  )
}

/// Where a journal line goes when it is pressed: the document it came from
/// where the app has a place for that; anything else opens its journal entry,
/// which every line has.
async function openMovement(
  row: PartyMovementRow,
  navigate: ReturnType<typeof useNavigate>,
  client: ReturnType<typeof useQueryClient>
) {
  const entry = () =>
    navigate({
      to: "/finance/accounting/journal-entries",
      search: { entry: row.entry_id },
    } as never)
  const id = row.source_id
  if (row.source_kind === "SUPPLIER_INVOICE" && id !== null)
    return navigate({
      to: "/finance/payables/bills",
      search: { bill: id },
    } as never)
  // The journal calls a supplier payment `PAYMENT`; `SUPPLIER_PAYMENT` is
  // the payment's own kind elsewhere. Both are the same document.
  if (
    (row.source_kind === "PAYMENT" || row.source_kind === "SUPPLIER_PAYMENT") &&
    id !== null
  )
    return navigate({
      to: "/finance/payables/payments",
      search: { payment: id },
    } as never)
  if (row.source_kind === "CASH_DOC" && id !== null) {
    // The row does not say whether the document paid (BKK) or received
    // (BKM), so the document is asked. If it cannot be read, the journal
    // entry it posted is still there to open.
    try {
      const doc = await client.fetchQuery({
        queryKey: cashDocumentKeys.detail(id),
        queryFn: ({ signal }) => cashDocument(id, signal),
        staleTime: 60_000,
      })
      return navigate({
        to:
          doc.kind === "RECEIVE"
            ? "/finance/cash-bank/bkm/$id"
            : "/finance/cash-bank/bkk/$id",
        params: { id },
      } as never)
    } catch {
      return entry()
    }
  }
  return entry()
}

/// One journal line.
function MovementRow({ row }: { row: PartyMovementRow }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const open = () => openMovement(row, navigate, client)
  return (
    <tr onClick={() => void open()} className="cursor-pointer">
      <Td>{day(row.posting_date)}</Td>
      <Td>
        <Code>{row.entry_number}</Code>
      </Td>
      {/* The account the line landed on is the Type cell's tooltip, as in
          7Soft's Kartu Hutang, which has no account column; the export keeps
          it as a column of its own. */}
      <Td>
        <span title={`${row.account_code} ${row.account_name}`}>
          {label(row.source_kind)}
        </span>
      </Td>
      <Td className="max-w-0">
        <span
          className="block truncate text-body"
          title={row.memo ?? undefined}
        >
          {row.memo ?? "—"}
        </span>
      </Td>
      <Td align="right">
        {row.debit_minor === 0 ? (
          <span className="text-faint">·</span>
        ) : (
          <CellMoney minor={row.debit_minor} />
        )}
      </Td>
      <Td align="right">
        {row.credit_minor === 0 ? (
          <span className="text-faint">·</span>
        ) : (
          <CellMoney minor={row.credit_minor} />
        )}
      </Td>
      <Td align="right">
        <span className="font-medium text-ink">
          <BalanceCell minor={row.balance_minor} />
        </span>
      </Td>
    </tr>
  )
}
