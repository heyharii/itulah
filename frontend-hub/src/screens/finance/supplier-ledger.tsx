import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { ExportButton } from "@/components/ui/export-button"
import { PageHeader } from "@/components/ui/page-header"
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
  type DateWindow,
} from "@/screens/finance/hooks"
import { CardFigure, PhoneList } from "@/components/ui/phone-cards"
import {
  SupplierPicker,
  UnitSelect,
  WindowControl,
} from "@/screens/finance/parts"
import { ReportFilters, ReportSummary } from "@/screens/finance/report"
import type { PartyMovementRow, PartyMovements } from "@itulah/contract"

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

export function SupplierLedger() {
  const linked = useSheet("supplier")
  const suppliers = useSuppliers()
  const supplierName = useSupplierName()
  const unitName = useUnitName()
  const range = useYearToDate()
  const [unit, setUnit] = useState("")

  const code = linked.value ?? ""
  const chosen = (suppliers.data ?? []).find(
    (one) => one.supplier_code === code
  )

  const ledger = useQuery({
    queryKey: financeKeys.partyMovements(
      "SUPPLIER",
      code,
      range.from,
      range.to,
      unit || null
    ),
    queryFn: ({ signal }) =>
      partyMovements(
        "SUPPLIER",
        code,
        { from: range.from, to: range.to, unit: unit || undefined },
        signal
      ),
    enabled: code !== "" && range.from <= range.to,
  })

  const build = (): ExportSheet | null => {
    const data = ledger.data
    if (data === undefined) return null
    const name = supplierName(code)
    return {
      filename: `Supplier-Ledger-${fileSafe(name)}-${data.from}`,
      sheet: "Supplier Ledger",
      title: `Supplier Ledger · ${name}`,
      subtitle: `${day(data.from)} → ${day(data.to)} · ${
        unit === "" ? "all units" : unitName(unit)
      }`,
      columns: [
        { header: "Date", kind: "date", width: 13 },
        { header: "Entry", kind: "text", width: 16 },
        { header: "Type", kind: "text", width: 20 },
        { header: "Account", kind: "text", width: 36 },
        { header: "Memo", kind: "text", width: 44 },
        { header: "Debit", kind: "money" },
        { header: "Credit", kind: "money" },
        { header: "Balance", kind: "money" },
      ],
      rows: [
        [
          data.from,
          null,
          "Opening balance",
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

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Payables"
        title="Supplier Ledger"
        actions={
          <ExportButton build={build} disabled={ledger.data === undefined} />
        }
      />

      <ReportFilters
        exportAction={
          <ExportButton
            variant="ghost"
            build={build}
            disabled={ledger.data === undefined}
          />
        }
        note={
          code !== "" && (
            <>
              {supplierName(code)} · {range.chip}
            </>
          )
        }
      >
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
        <WindowControl range={range} />
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
      </ReportFilters>

      {code === "" ? (
        <EmptyState>Choose a supplier to read its ledger.</EmptyState>
      ) : range.from > range.to ? (
        <EmptyState>The window ends before it starts.</EmptyState>
      ) : (
        queryState(ledger, {
          loading: "Reading the supplier's ledger…",
          render: (data) => <Ledger data={data} />,
        })
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
          { label: "Opening balance", value: data.opening_minor },
          { label: "Debit (paid)", value: data.debit_minor },
          { label: "Credit (billed)", value: data.credit_minor },
          { label: "Closing balance", value: data.closing_minor },
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
              <Th width="7.5rem">Date</Th>
              <Th width="8.5rem">Entry</Th>
              <Th width="10rem">Type</Th>
              <Th width="100%">Memo</Th>
              <Th align="right" width="8.5rem">
                Debit
              </Th>
              <Th align="right" width="8.5rem">
                Credit
              </Th>
              <Th align="right" width="9.5rem">
                Balance
              </Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>{day(data.from)}</Td>
              <Td>
                <span className="text-faint">—</span>
              </Td>
              <Td className="font-medium text-ink">Opening balance</Td>
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
