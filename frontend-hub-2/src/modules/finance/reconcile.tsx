import { useMemo } from "react"
import { Scale, Upload } from "lucide-react"
import type { BankStatementLineRow, BankStatementRow } from "@itulah/contract"
import type { ColumnDef } from "@tanstack/react-table"

import { Button } from "@/kit/button"
import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Tile, Tiles } from "@/kit/tiles"
import { Empty, Failed, Loading } from "@/kit/state"
import { amount, count, day, rp } from "@/lib/format"
import { useBoundedList, useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import type { TableSetup } from "@/lib/table"

/// Bank reconciliation — our entries against the bank's.
///
/// ## What this screen is, and what it is NOT yet
///
/// It is the statement register and one statement's lines, with each line's
/// match state. That much the server can answer.
///
/// It is **not** the side-by-side the design asks for — book entries in one
/// column, bank lines in the other, matched across — and that is a data
/// problem rather than a layout one, worth stating exactly:
///
///   - `GET /bank-statements/{id}/suggestions` returns
///     `{ journal_line_id, score, auto_match, reasons }` — **a bare uuid and a
///     number**. No date, no amount, no memo, no entry number. The server has
///     all of it in `candidates_for` and discards it before answering.
///   - There is no journal-line-by-id endpoint, and `GeneralLedgerRow` carries
///     no `line_id`. So a suggestion cannot be joined to anything the ledger
///     can show.
///
/// Rendering the right-hand column from a uuid would mean either an N+1 fetch
/// per suggestion or drawing a number and calling it a match. Neither is a
/// reconciliation, so neither is here. What is here says what it knows.
///
/// ## Two things the data hides that a reviewer needs
///
/// **Who agreed a match, and how.** `bank_line_match` stores `decided_by_kind`
/// (MANUAL or AUTO), `score`, `matched_by` and `matched_at`, and returns none
/// of them. So "auto-matched at threshold 0.9, never looked at by a person" —
/// precisely the row a reviewer is hunting — is indistinguishable from one
/// somebody agreed by hand.
///
/// **A view across statements.** Lines are reachable only per statement, so
/// "every unmatched line on this account this quarter" cannot be asked.

export function ReconcileScreen() {
  const url = useQueryState()
  const openId = url.one("statement")

  // The register takes no parameters at all — not even `limit`. It returns
  // every statement ever imported, ordered newest period first. Unbounded is
  // not a gap the client can paper over: there is nothing to page and nothing
  // to say the answer was cut off, because it never is.
  const statements = useBoundedList<BankStatementRow>({
    key: ["finance", "bank-statements"],
    path: "/api/v1/finance/bank-statements",
    params: {},
    limit: 1000,
  })

  const open = useMemo(
    () => statements.rows.find((row) => row.statement_id === openId),
    [statements.rows, openId],
  )

  const lines = useReport<BankStatementLineRow[]>({
    key: ["finance", "bank-statement-lines", openId],
    path: `/api/v1/finance/bank-statements/${openId}/lines`,
    enabled: openId !== "",
  })

  const columns: ColumnDef<TableSetup, BankStatementRow>[] = [
    {
      id: "account",
      header: "Account",
      size: 26,
      meta: { icon: <Scale className="size-[15px]" />, min: 210 },
      cell: ({ row }) => {
        const statement = row.original
        return (
          <>
            <span className="text-ink block truncate font-medium">
              {statement.account_name}
            </span>
            <span className="text-label text-ink-4 flex items-center gap-2">
              <span className="font-mono">{statement.account_code}</span>
              <span className="truncate">{statement.site_id}</span>
            </span>
          </>
        )
      },
    },
    {
      id: "period",
      header: "Period",
      size: 17,
      meta: { min: 165 },
      cell: ({ row }) => (
        <span className="text-ink-2">
          {day(row.original.period_start)} — {day(row.original.period_end)}
        </span>
      ),
    },
    {
      id: "opening",
      header: "Opening",
      size: 13,
      meta: { align: "right", priority: 2, min: 115 },
      cell: ({ row }) => (
        <span className="text-ink-3 tabular-nums">
          {amount(row.original.opening_minor)}
        </span>
      ),
    },
    {
      id: "closing",
      header: "Closing",
      size: 13,
      meta: { align: "right", min: 115 },
      cell: ({ row }) => (
        <span className="text-ink font-medium tabular-nums">
          {amount(row.original.closing_minor)}
        </span>
      ),
    },
    {
      id: "matched",
      header: "Matched",
      size: 16,
      meta: { min: 150 },
      cell: ({ row }) => {
        const statement = row.original
        const left = statement.line_count - statement.matched_count
        return (
          <span className="flex items-center gap-1.5">
            <span className="text-ink-2 tabular-nums">
              {count(statement.matched_count)} / {count(statement.line_count)}
            </span>
            {left > 0 ? (
              <Tag tone="warn">{count(left)} left</Tag>
            ) : (
              <Tag tone="ok">all</Tag>
            )}
          </span>
        )
      },
    },
    {
      id: "imported",
      header: "Imported",
      size: 15,
      meta: { priority: 1, min: 140 },
      cell: ({ row }) => (
        <>
          <span className="text-ink-2 block">
            {day(row.original.imported_at)}
          </span>
          <span className="text-label text-ink-4 block truncate">
            {row.original.imported_by}
          </span>
        </>
      ),
    },
  ]

  const unmatched = statements.rows.reduce(
    (n, row) => n + (row.line_count - row.matched_count),
    0,
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Cash &amp; Banking"
        title="Bank reconciliation"
        description="Statements the bank sent, and how much of each one our books have accounted for."
        action={
          <Button variant="primary" icon={<Upload className="size-4" />}>
            Import a statement
          </Button>
        }
      />

      <ScopeLine
        scope={{ kind: "during", period: "every statement imported" }}
        note="a match is a bank line tied to a journal line"
      />

      <Tiles>
        <Tile
          label="Statements"
          value={count(statements.rows.length)}
          note="all that have been imported"
        />
        <Tile
          label="Lines unmatched"
          value={count(unmatched)}
          tone={unmatched > 0 ? "warn" : "ok"}
          note={
            unmatched === 0
              ? "every line is accounted for"
              : "each needs an entry, or a reason"
          }
        />
      </Tiles>

      <Toolbar trailing={statements.query.isFetching ? "Loading…" : undefined}>
        <span className="text-ctl text-ink-3">
          Pick a statement to see its lines.
        </span>
      </Toolbar>

      {statements.query.isError ? (
        <Failed
          what="bank statements"
          error={statements.query.error}
          onRetry={() => void statements.query.refetch()}
        />
      ) : statements.query.isPending ? (
        <Loading cols={6} />
      ) : statements.rows.length === 0 ? (
        <Empty
          what="bank statements"
          detail="Nothing has been imported yet. Until a statement arrives there is nothing to reconcile against."
        />
      ) : (
        <Table
          columns={columns}
          rows={statements.rows}
          rowId={(row) => row.statement_id}
          caption="Imported bank statements"
          onRowClick={(row) =>
            url.set(
              {
                statement:
                  row.statement_id === openId ? null : row.statement_id,
              },
              false,
            )
          }
          isOpen={(row) => row.statement_id === openId}
          foot={{
            account: (
              <>
                <b className="text-ink">{count(statements.rows.length)}</b>{" "}
                statements
              </>
            ),
            matched:
              unmatched === 0 ? (
                <span className="text-ok-ink font-medium">none left</span>
              ) : (
                <span className="text-warn-ink font-medium">
                  {count(unmatched)} unmatched
                </span>
              ),
          }}
        />
      )}

      {openId !== "" && open && (
        <Lines
          statement={open}
          lines={lines.data ?? []}
          loading={lines.isPending}
        />
      )}
    </div>
  )
}

/// One statement's lines, under the register.
///
/// Not a sheet: a sheet is for reading one record, and this is a second list
/// that is read ALONGSIDE the first — which statement is selected is the whole
/// context of what is below it. Putting it in a floating panel would cover the
/// row that says which statement these belong to.
function Lines({
  statement,
  lines,
  loading,
}: {
  statement: BankStatementRow
  lines: readonly BankStatementLineRow[]
  loading: boolean
}) {
  return (
    <div className="border-line flex max-h-[45%] min-h-0 shrink-0 flex-col border-t">
      <div className="bg-side flex shrink-0 items-baseline gap-2 px-4 py-2">
        <span className="text-cell text-ink font-medium">
          {statement.account_name}
        </span>
        <span className="text-ctl text-ink-3">
          {day(statement.period_start)} — {day(statement.period_end)}
        </span>
        <span className="text-ctl text-ink-4 ml-auto tabular-nums">
          {count(statement.matched_count)} of {count(statement.line_count)}{" "}
          matched
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <Loading rows={4} cols={5} />
        ) : (
          <table className="w-full">
            <tbody>
              {lines.map((line) => (
                <tr key={line.line_id} className="border-line border-b">
                  <td className="text-ctl text-ink-3 px-4 py-2 whitespace-nowrap">
                    {day(line.value_date)}
                  </td>
                  <td className="text-ctl text-ink-2 px-2 py-2">
                    <span className="block truncate">{line.description}</span>
                    {line.reference !== null && (
                      <span className="text-label text-ink-4 block truncate font-mono">
                        {line.reference}
                      </span>
                    )}
                  </td>
                  {/* A DEBIT on the bank's statement is money LEAVING the
                      account — the bank writes from its own side of the
                      relationship, and reading it as ours is the most common
                      way a reconciliation comes out backwards. */}
                  <td className="text-ctl text-ink-2 px-2 py-2 text-right whitespace-nowrap tabular-nums">
                    {line.debit_minor === 0
                      ? ""
                      : `−${amount(line.debit_minor)}`}
                  </td>
                  <td className="text-ctl text-ink-2 px-2 py-2 text-right whitespace-nowrap tabular-nums">
                    {line.credit_minor === 0 ? "" : amount(line.credit_minor)}
                  </td>
                  <td className="text-ctl px-4 py-2 whitespace-nowrap">
                    {line.matched_journal_line_id === null ? (
                      <Tag tone="warn">unmatched</Tag>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Tag tone="ok">matched</Tag>
                        {line.matched_entry_number !== null && (
                          <span className="text-label text-ink-4 font-mono">
                            {line.matched_entry_number}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="border-line text-meta text-ink-4 shrink-0 border-t px-4 py-2">
        Closing per the bank {rp(statement.closing_minor)}. Never edit a book
        figure to make it agree — an unposted line is resolved by creating the
        entry it is missing and linking it here.
      </p>
    </div>
  )
}
