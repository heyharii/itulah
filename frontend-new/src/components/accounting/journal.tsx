/*
 * Journal — the posted general-ledger lines, filtered by date window and
 * account, with a running balance carried down the debit-positive column.
 *
 * `/v1/accounting/general-ledger` returns the line: account, debit, credit and
 * the hub's own running balance. It carries no memo, no voucher number and no
 * source, so those columns are filled from the journal header the line belongs
 * to (`/v1/accounting/journal-entries`, matched on `journal_entry_id`). A line
 * whose header is not in the same window shows an em dash rather than borrowing
 * another voucher's description.
 *
 * The running balance is only meaningful when the rows share one account, so it
 * is shown as "Balance" when an account filter is set and labelled as a
 * per-page running total otherwise. Nothing here is computed from anything but
 * the rows the API returned.
 */

import { useMemo } from "react"

import {
  JOURNAL_LIMIT,
  money,
  moneyOrDash,
  signedAmount,
  type JournalLine,
} from "@/components/accounting/api"
import { num } from "@/components/accounting/parts"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

export interface JournalRow extends JournalLine {
  /** Debit-positive running total across the rows as ordered on screen. */
  running: number
}

const JOURNAL_COLUMNS =
  "104px 210px minmax(0,1fr) 170px 140px 140px 150px"

/** Oldest first, so the running balance reads downward like a bank statement. */
export function withRunningBalance(lines: JournalLine[]): JournalRow[] {
  const ordered = [...lines].sort((a, b) => {
    const byDate = a.postingDate.localeCompare(b.postingDate)
    if (byDate !== 0) return byDate
    const byJournal = a.journalEntryId.localeCompare(b.journalEntryId)
    if (byJournal !== 0) return byJournal
    return Number(a.journalLineId) - Number(b.journalLineId)
  })
  let running = 0
  return ordered.map((line) => {
    running += signedAmount(line)
    return { ...line, running }
  })
}

export function JournalTable({
  lines,
  perAccount,
}: {
  lines: JournalLine[]
  /** True when an account filter is active — the running balance then means it. */
  perAccount: boolean
}) {
  const rows = useMemo(() => withRunningBalance(lines), [lines])
  const totals = useMemo(
    () => ({
      debit: rows.reduce((sum, row) => sum + row.debit, 0),
      credit: rows.reduce((sum, row) => sum + row.credit, 0),
    }),
    [rows]
  )

  return (
    <>
      <VirtualRows
        rows={rows}
        rowKey={(row) => row.id}
        columns={JOURNAL_COLUMNS}
        rowHeight={44}
        /* The caller renders its own empty-state message (`ReadState`) right
         * below this table when there are no lines, so this table stays
         * silent rather than adding a second "nothing here" of its own. */
        empty={<></>}
        header={
          <>
            <span className="pl-3.5">Date</span>
            <span className="px-3">Journal</span>
            <span className="px-3">Account</span>
            <span className="px-3">Source</span>
            <span className="px-3 text-right">Debit</span>
            <span className="px-3 text-right">Credit</span>
            <span className="pr-3.5 pl-3 text-right">
              {perAccount ? "Balance" : "Running"}
            </span>
          </>
        }
        renderRow={(row) => (
          <>
            <span role="gridcell" className="pl-3.5">
              <span className={cn(num, "text-ink-3")}>{row.postingDate}</span>
            </span>
            <span role="gridcell" className="px-3">
              <span className="block truncate text-[11.5px] text-ink-2">
                {row.entryNumber ?? "—"}
              </span>
              <span className={cn(num, "block truncate text-[10.5px] text-ink-4")}>
                {row.journalEntryId}
              </span>
            </span>
            <span role="gridcell" className="min-w-0 px-3">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className={cn(num, "shrink-0 text-ink-4")}>
                  {row.accountCode}
                </span>
                <span className="truncate text-xs text-ink-2">
                  {row.accountName}
                </span>
              </span>
              {row.memo && (
                <span className="block truncate text-[10.5px] text-ink-4">
                  {row.memo}
                </span>
              )}
            </span>
            <span role="gridcell" className="min-w-0 px-3">
              <span className="block truncate text-[11px] text-ink-3">
                {row.sourceType ?? "—"}
              </span>
              <span className="block truncate text-[10.5px] text-ink-4">
                {row.sourceId ?? ""}
              </span>
            </span>
            <span role="gridcell" className="px-3 text-right">
              <span className={cn(num, "text-ink")}>
                {row.debit !== 0 ? money(row.debit) : "—"}
              </span>
            </span>
            <span role="gridcell" className="px-3 text-right">
              <span className={cn(num, "text-ink")}>
                {row.credit !== 0 ? money(row.credit) : "—"}
              </span>
            </span>
            <span role="gridcell" className="pr-3.5 pl-3 text-right">
              <span
                className={cn(num, row.running < 0 ? "text-ember" : "text-ink-2")}
              >
                {moneyOrDash(row.running)}
              </span>
            </span>
          </>
        )}
      />

      {/* Not part of the virtualized rows: a totals row, in the same position
       * it held as the table's <tfoot> — after every line, not pinned to the
       * viewport. */}
      <div
        role="row"
        className="grid h-9 items-center border-t border-t-line-strong bg-surface"
        style={{ gridTemplateColumns: JOURNAL_COLUMNS }}
      >
        <span className="col-span-4 pl-3.5 text-[11px] font-semibold text-ink-3">
          {rows.length} line{rows.length === 1 ? "" : "s"}
        </span>
        <span className="px-3 text-right">
          <span className={cn(num, "text-ink")}>{moneyOrDash(totals.debit)}</span>
        </span>
        <span className="px-3 text-right">
          <span className={cn(num, "text-ink")}>{moneyOrDash(totals.credit)}</span>
        </span>
        <span className="pr-3.5 pl-3 text-right">
          <span
            className={cn(
              num,
              totals.debit === totals.credit ? "text-ink-4" : "text-ember"
            )}
          >
            {totals.debit === totals.credit
              ? "balanced"
              : moneyOrDash(totals.debit - totals.credit)}
          </span>
        </span>
      </div>

      {rows.length >= JOURNAL_LIMIT && (
        <p className="border-t border-line px-3.5 py-2.5 text-[11px] text-ink-4">
          Showing the first {JOURNAL_LIMIT} lines — the ceiling the general-ledger
          route enforces on `limit`. Narrow by period or account to see the rest.
        </p>
      )}
    </>
  )
}
