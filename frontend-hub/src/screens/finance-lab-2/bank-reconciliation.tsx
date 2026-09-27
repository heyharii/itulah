import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import type {
  BankStatementLineRow,
  Suggestion,
  UpdateBankLineRequest,
} from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/ui/dialog"
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import { parseMinor } from "@/screens/finance/chart"
import {
  AccountAndCategory,
  accountChoiceReady,
  type AccountChoice,
} from "@/screens/finance/parts"
import {
  bookBankLine,
  confirmBankMatch,
  financeKeys,
  unmatchBankLine,
  updateBankLine,
} from "@/lib/queries/finance"
import {
  CardRow,
  Grid,
  LabNote,
  NumberCard,
  Reasons,
  Td,
  Th,
} from "@/screens/finance-lab-2/parts"
import {
  useMoney,
  useStatementLines,
  useStatements,
  useSuggestions,
} from "@/screens/finance-lab-2/hooks"

/// Reconcile the bank, in ERPNext's shape, against our own endpoints.
///
/// # The page, in their order
///
/// Buttons at the top right — *Upload bank statement · Auto reconcile · Get
/// unreconciled entries*. Then the filter row: bank account, from and to date,
/// closing balance. Then three number cards whose third is a difference that
/// has to reach zero. Then the transaction table, nine columns, with an
/// **Actions** button inside each row. Then one modal per row, governed by a
/// single **Action** select: *Match against voucher · Create voucher · Update
/// bank transaction*.
///
/// Nothing else is on this screen. Bulk selection lives on the Bank
/// Transactions list, where ERPNext's own list view keeps it; rules and
/// statement sources are sheets from that list; transfers are a document. The
/// question here is small and concrete — which booked transaction is this bank
/// line — and every extra control is a way of not answering it.
///
/// # Where it goes further than a copy, and why
///
/// Candidates say *why* rather than showing `rank 4`: the matcher already
/// returns the terms as sentences, so the screen stops hiding them. And the
/// allocation column is editable per candidate, which is what makes one bank
/// line settle two vouchers — the thing ERPNext has and we did not, now built
/// from `bank_line_match.allocated_minor` (0213).
export function BankReconciliation({
  statementId,
}: {
  /// Which statement to open on, when a caller has already chosen one.
  ///
  /// Additive: absent, this screen behaves exactly as it did — its own picker,
  /// defaulting to the first statement. `bank-reconciliation-list` passes one
  /// because it is a list of accounts and a row press means "that one".
  statementId?: string | null
} = {}) {
  const statements = useStatements()
  const money_ = useMoney()
  const [chosen, setChosen] = useState<string | null>(statementId ?? null)
  const [exact, setExact] = useState(true)
  // The dates start as the statement's own period, which is what somebody
  // types into ERPNext by hand before it will show them anything. Held with
  // the statement they came from and adjusted DURING render when that changes:
  // an effect doing the same thing renders the old period once first, which is
  // a flash of the wrong window on every statement switch.
  const [range, setRange] = useState<{
    statementId: string | null
    from: string
    to: string
  }>({ statementId: null, from: "", to: "" })

  // Its own memo so the identity is stable: a fresh [] every render would
  // re-run every memo downstream of it.
  const rows = useMemo(() => statements.data?.rows ?? [], [statements.data])
  const statement = useMemo(
    () => rows.find((row) => row.statement_id === chosen) ?? rows[0],
    [rows, chosen]
  )

  if (statement !== undefined && range.statementId !== statement.statement_id) {
    setRange({
      statementId: statement.statement_id,
      from: statement.period_start,
      to: statement.period_end,
    })
  }
  const { from, to } = range
  const setFrom = (value: string) =>
    setRange((was) => ({ ...was, from: value }))
  const setTo = (value: string) => setRange((was) => ({ ...was, to: value }))

  const lines = useStatementLines(statement?.statement_id ?? null)
  const suggestions = useSuggestions(statement?.statement_id ?? null, exact)

  const book = useMemo(() => {
    if (statement === undefined) return null
    return (
      money_.data?.rows.find(
        (row) =>
          row.account_code === statement.account_code &&
          row.site_id === statement.site_id
      ) ?? null
    )
  }, [money_.data, statement])

  const byLine = useMemo(() => {
    const table = new Map<string, Suggestion[]>()
    for (const entry of suggestions.data ?? []) {
      table.set(entry.line_id, [...entry.suggestions])
    }
    return table
  }, [suggestions.data])

  const shown = useMemo(
    () =>
      (lines.data ?? []).filter(
        (row) =>
          (from === "" || row.value_date >= from) &&
          (to === "" || row.value_date <= to)
      ),
    [lines.data, from, to]
  )

  const [open, setOpen] = useState<string | null>(null)
  const line = (lines.data ?? []).find((row) => row.line_id === open) ?? null

  const client = useQueryClient()
  const refresh = () => {
    if (statement === undefined) return
    void client.invalidateQueries({
      queryKey: financeKeys.bankLines(statement.statement_id),
    })
    void client.invalidateQueries({
      queryKey: [
        "finance",
        "bank-statements",
        statement.statement_id,
        "suggestions",
      ],
    })
    void client.invalidateQueries({ queryKey: financeKeys.bankStatements() })
    void client.invalidateQueries({ queryKey: financeKeys.money(null, null) })
  }

  /// Agree one or several vouchers against one line, in the order the person
  /// listed them. Sequential and not parallel: the server checks what is left
  /// of the line on each write, and two writes racing would both be told there
  /// is room for the last of it.
  const reconcile = useMutation({
    mutationFn: async (input: {
      lineId: string
      picks: { suggestion: Suggestion; allocated: number }[]
    }) => {
      for (const pick of input.picks) {
        await confirmBankMatch(input.lineId, {
          journal_line_id: pick.suggestion.journal_line_id,
          score: pick.suggestion.score,
          reasons: [...pick.suggestion.reasons],
          automatic: false,
          allocated_minor: pick.allocated,
        })
      }
    },
    onSuccess: () => {
      setOpen(null)
      refresh()
    },
  })

  const undo = useMutation({
    mutationFn: (input: { lineId: string; journalLineId?: string }) =>
      unmatchBankLine(input.lineId, undefined, input.journalLineId),
    onSuccess: refresh,
  })

  const describe = useMutation({
    mutationFn: (input: { lineId: string; request: UpdateBankLineRequest }) =>
      updateBankLine(input.lineId, input.request),
    onSuccess: refresh,
  })

  const create = useMutation({
    mutationFn: (input: {
      lineId: string
      picked: AccountChoice
      memo: string
    }) =>
      bookBankLine(input.lineId, {
        account_code: input.picked.account_code,
        memo: input.memo,
        // What the charge was. 6301 alone stopped saying it the day the chart
        // collapsed to forty accounts.
        category_code: input.picked.category_code,
        party_name: null,
      }),
    onSuccess: () => {
      setOpen(null)
      refresh()
    },
  })

  /// ERPNext's *Auto Reconcile*: sweep the lines whose best candidate is a
  /// lone leader above the threshold, and report how many were taken. The
  /// server decides what qualifies, which is why two identical payments on one
  /// Friday are still left for a person.
  const auto = useMutation({
    mutationFn: async () => {
      let taken = 0
      for (const row of shown) {
        if (row.unallocated_minor <= 0) continue
        const leader = (byLine.get(row.line_id) ?? []).find(
          (candidate) => candidate.auto_match
        )
        if (leader === undefined) continue
        await confirmBankMatch(row.line_id, {
          journal_line_id: leader.journal_line_id,
          score: leader.score,
          reasons: [...leader.reasons],
          automatic: true,
          // Null, not the line's amount: the server reads "all that is left",
          // which is the same thing and stays right if somebody has claimed
          // part of the line since this list was drawn.
          allocated_minor: null,
        })
        taken += 1
      }
      return taken
    },
    onSuccess: refresh,
  })

  const unagreed = shown.filter((row) => row.unallocated_minor > 0).length
  const difference =
    book === null || statement === undefined
      ? null
      : book.per_books_minor - statement.closing_minor

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Cash & Bank"
        title="Bank Reconciliation"
        sub="Match what the bank reported against what the books already hold."
        actions={
          <>
            <Button variant="ghost" disabled>
              Upload bank statement
            </Button>
            <Button
              variant="ghost"
              pending={auto.isPending}
              disabled={statement === undefined}
              onClick={() => auto.mutate()}
            >
              {auto.isPending ? "Reconciling…" : "Auto reconcile"}
            </Button>
            <Button variant="primary" onClick={refresh}>
              Get unreconciled entries
            </Button>
          </>
        }
      />

      {statements.isPending ? (
        <LoadingState>Reading what the bank has told us…</LoadingState>
      ) : rows.length === 0 ? (
        <EmptyState>
          No bank statement has been imported yet. Import one and it appears
          here.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <Toolbar>
            <Select
              aria-label="Bank account"
              value={statement?.statement_id ?? ""}
              onChange={setChosen}
              className="h-8 w-[20rem]"
            >
              {rows.map((row) => (
                <option key={row.statement_id} value={row.statement_id}>
                  {row.account_name} — {row.site_id}
                </option>
              ))}
            </Select>
            <Input
              type="date"
              aria-label="From date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-8 w-[9.5rem]"
            />
            <Input
              type="date"
              aria-label="To date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-8 w-[9.5rem]"
            />
            <Toolbar.Spacer />
            <span className="text-[0.875rem] text-mute">
              {statement === undefined
                ? null
                : `${shown.length} of ${statement.line_count} lines · ${unagreed} unreconciled`}
            </span>
          </Toolbar>

          <CardRow>
            <NumberCard
              label="Closing balance as per bank statement"
              value={statement?.closing_minor ?? null}
              note="from the imported file, not typed on this screen"
            />
            <NumberCard
              label="Closing balance as per books"
              value={book?.per_books_minor ?? null}
              note={
                book === null
                  ? "no mapped account for this statement"
                  : `ledger ${book.account_code}`
              }
            />
            <NumberCard
              label="Difference"
              value={difference}
              tone={
                difference === null
                  ? undefined
                  : difference === 0
                    ? "ok"
                    : "bad"
              }
              note={
                difference === 0
                  ? "the bank and the books match"
                  : `${unagreed} lines unreconciled`
              }
            />
          </CardRow>

          {auto.data === 0 && (
            <Banner tone="info">
              No matches occurred via auto reconciliation.
            </Banner>
          )}

          {lines.isPending ? (
            <LoadingState>Reading the statement…</LoadingState>
          ) : (
            <Grid>
              <thead>
                <tr>
                  <Th width="5.5rem">Date</Th>
                  <Th width="6rem">Counterparty</Th>
                  <Th width="8rem">Who</Th>
                  <Th>Description</Th>
                  <Th align="right" width="7rem">
                    Deposit
                  </Th>
                  <Th align="right" width="7rem">
                    Withdrawal
                  </Th>
                  <Th align="right" width="7rem">
                    Unallocated
                  </Th>
                  <Th width="6.5rem">Reference</Th>
                  <Th width="6.5rem" />
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <Row
                    key={row.line_id}
                    row={row}
                    candidates={byLine.get(row.line_id) ?? []}
                    onOpen={() => setOpen(row.line_id)}
                    onUndo={(journalLineId) =>
                      undo.mutate({ lineId: row.line_id, journalLineId })
                    }
                    busy={undo.isPending}
                  />
                ))}
              </tbody>
            </Grid>
          )}

          <LabNote>
            <b>Party</b> is drawn because it is part of the shape and is empty
            because a statement line has no party field on our side yet — the
            next schema change after this one. <b>Unallocated</b> is live: since{" "}
            <code>0213</code> a line may be settled by more than one voucher,
            and what is left of it is what the matcher scores the next candidate
            against.
          </LabNote>
        </div>
      )}

      <ReconcileDialog
        // A different line is a different question, so it gets a different
        // component instance: nothing a person ticked or typed for the last
        // line can survive into this one, and no effect has to undo it.
        key={line?.line_id ?? "none"}
        line={line}
        candidates={line === null ? [] : (byLine.get(line.line_id) ?? [])}
        scoring={suggestions.isPending}
        exact={exact}
        onExact={setExact}
        busy={reconcile.isPending || create.isPending}
        problem={
          reconcile.error instanceof Error
            ? reconcile.error.message
            : create.error instanceof Error
              ? create.error.message
              : null
        }
        onClose={() => setOpen(null)}
        onReconcile={(picks) =>
          line && reconcile.mutate({ lineId: line.line_id, picks })
        }
        onCreate={(picked, memo) =>
          line && create.mutate({ lineId: line.line_id, picked, memo })
        }
        onUndo={(journalLineId) =>
          line && undo.mutate({ lineId: line.line_id, journalLineId })
        }
        onUpdate={(request) =>
          line && describe.mutate({ lineId: line.line_id, request })
        }
      />
    </PageContent>
  )
}

function Row({
  row,
  candidates,
  onOpen,
  onUndo,
  busy,
}: {
  row: BankStatementLineRow
  candidates: readonly Suggestion[]
  onOpen: () => void
  onUndo: (journalLineId?: string) => void
  busy: boolean
}) {
  // A debit on the bank's own statement is money leaving the account — their
  // Withdrawal column. A credit is their Deposit. The translation is here and
  // nowhere else on this screen.
  const deposit = row.credit_minor
  const withdrawal = row.debit_minor
  const settled = row.unallocated_minor === 0

  return (
    <tr className={settled ? "bg-soft/60" : undefined}>
      <Td>{day(row.value_date)}</Td>
      <Td className={row.party_type === null ? "text-mute" : undefined}>
        {row.party_type === null ? (
          "—"
        ) : (
          <Pill>{KIND_LABEL[row.party_type] ?? row.party_type}</Pill>
        )}
      </Td>
      <Td className={row.party_name === "" ? "text-mute" : undefined}>
        {row.party_name === "" ? (
          row.bank_said === "" ? (
            "—"
          ) : (
            <span title="what the bank called them">{row.bank_said}</span>
          )
        ) : (
          <span className="text-ink">{row.party_name}</span>
        )}
      </Td>
      <Td>
        <span className="text-ink">{row.description}</span>
        {row.note !== "" && (
          <span className="mt-0.5 block text-[0.875rem] text-body italic">
            {row.note}
          </span>
        )}
        {row.allocations.length > 0 && (
          <span className="mt-0.5 block text-[0.875rem] text-mute">
            {row.allocations
              .map(
                (claim) =>
                  `${claim.entry_number ?? "an entry"} ${money(claim.allocated_minor)}`
              )
              .join(" · ")}
          </span>
        )}
      </Td>
      <Td align="right">{deposit === 0 ? "—" : money(deposit)}</Td>
      <Td align="right">{withdrawal === 0 ? "—" : money(withdrawal)}</Td>
      <Td align="right">
        <span className={settled ? "text-mute" : "font-medium text-ink"}>
          {money(row.unallocated_minor)}
        </span>
      </Td>
      <Td className="font-mono text-[0.875rem] text-mute">
        {row.reference ?? "—"}
      </Td>
      <Td>
        {settled ? (
          <div className="flex items-center gap-1.5">
            <Pill tone="ok">Reconciled</Pill>
            <Button
              size="sm"
              variant="quiet"
              disabled={busy}
              onClick={() => onUndo(undefined)}
            >
              Undo
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant={
              candidates.some((candidate) => candidate.auto_match)
                ? "primary"
                : "ghost"
            }
            onClick={onOpen}
          >
            Actions
          </Button>
        )}
      </Td>
    </tr>
  )
}

/// What each register is called where a person reads it.
const KIND_LABEL: Record<string, string> = {
  SUPPLIER: "Supplier",
  CUSTOMER: "Customer",
  MEMBER: "Member",
  EMPLOYEE: "Employee",
  OTHER: "Someone else",
}

type Action = "match" | "create" | "update"

/// The modal ERPNext opens from the row's Actions button: one select at the
/// top that governs everything under it.
function ReconcileDialog({
  line,
  candidates,
  scoring,
  exact,
  onExact,
  busy,
  problem,
  onClose,
  onReconcile,
  onCreate,
  onUndo,
  onUpdate,
}: {
  line: BankStatementLineRow | null
  candidates: readonly Suggestion[]
  scoring: boolean
  exact: boolean
  onExact: (exact: boolean) => void
  busy: boolean
  problem: string | null
  onClose: () => void
  onReconcile: (picks: { suggestion: Suggestion; allocated: number }[]) => void
  onCreate: (picked: AccountChoice, memo: string) => void
  onUndo: (journalLineId: string) => void
  onUpdate: (request: UpdateBankLineRequest) => void
}) {
  // Keyed on the line at the call site, so these initialisers run again for
  // every line and the state starts as what the server last stored.
  const [action, setAction] = useState<Action>("match")
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [account, setAccount] = useState<AccountChoice | null>(null)
  const [memo, setMemo] = useState("")
  const [kind, setKind] = useState(line?.party_type ?? "")
  const [who, setWho] = useState(line?.party_name ?? "")
  const [note, setNote] = useState(line?.note ?? "")

  const remaining = line?.unallocated_minor ?? 0
  const amountOf = (id: string) => parseMinor(picked[id] ?? "") ?? 0
  const allocated = Object.keys(picked).reduce(
    (sum, id) => sum + amountOf(id),
    0
  )
  const left = remaining - allocated

  const toggle = (candidate: Suggestion) => {
    setPicked((was) => {
      const next = { ...was }
      if (candidate.journal_line_id in next) {
        delete next[candidate.journal_line_id]
        return next
      }
      // What is still unclaimed, capped at what this line has left — the
      // default somebody accepts nine times out of ten.
      const taken = Object.values(next).reduce(
        (sum, value) => sum + (parseMinor(value) ?? 0),
        0
      )
      next[candidate.journal_line_id] = String(Math.max(0, remaining - taken))
      return next
    })
  }

  return (
    <Panel
      open={line !== null}
      onOpenChange={(next) => !next && onClose()}
      title="Reconcile the bank transaction"
      sub={
        line === null
          ? undefined
          : `${day(line.value_date)} · ${
              line.debit_minor > 0 ? "withdrawal" : "deposit"
            } · ${money(Math.max(line.debit_minor, line.credit_minor))} · ${money(
              line.unallocated_minor
            )} unallocated`
      }
    >
      {line === null ? null : (
        <div className="flex flex-col gap-4">
          <div className="rounded-inner border border-hairline p-3">
            <div className="text-[0.875rem] text-ink">{line.description}</div>
            <div className="mt-0.5 text-[0.875rem] text-mute">
              {line.reference ?? "no reference"}
            </div>
          </div>

          {line.allocations.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {line.allocations.map((claim) => (
                <div
                  key={claim.match_id}
                  className="flex items-center gap-2.5 rounded-inner border border-hairline bg-soft px-3 py-2"
                >
                  <span className="min-w-0 flex-1 text-[0.875rem]">
                    <span className="font-medium text-ink">
                      {claim.entry_number ?? "an entry"}
                    </span>
                    <span className="block text-[0.875rem] text-mute">
                      {claim.reasons.join(" · ")} · {claim.decided_by_kind} ·{" "}
                      {claim.matched_by}
                    </span>
                  </span>
                  <span className="text-[0.875rem] tabular-nums">
                    {money(claim.allocated_minor)}
                  </span>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => onUndo(claim.journal_line_id)}
                  >
                    Undo
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Field label="Action">
            <Select
              value={action}
              onChange={(next) => setAction(next as Action)}
              aria-label="Action"
            >
              <option value="match">Match against voucher</option>
              <option value="create">Create voucher</option>
              <option value="update">Update bank transaction</option>
            </Select>
          </Field>

          {problem !== null && <Banner tone="bad">{problem}</Banner>}

          {action === "match" && (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-inner border border-hairline px-3 py-2.5">
                <Checkbox
                  checked
                  disabled
                  onChange={() => {}}
                  label="Journal entry"
                />
                <Checkbox
                  checked={false}
                  disabled
                  onChange={() => {}}
                  label="Payment entry"
                />
                <Checkbox
                  checked={false}
                  disabled
                  onChange={() => {}}
                  label="Purchase invoice"
                />
                <Checkbox
                  checked={false}
                  disabled
                  onChange={() => {}}
                  label="Sales invoice"
                />
                <span className="ml-auto">
                  <Checkbox
                    checked={exact}
                    onChange={onExact}
                    label="Exact match"
                  />
                </span>
              </div>
              <p className="-mt-2 text-[0.875rem] text-mute">
                Only journal entries can be matched today: a payment and a bill
                both reach the bank account through one, so the ledger is where
                every candidate already is. Turning off{" "}
                <b className="font-medium">Exact match</b> also offers vouchers
                that cover only part of this line.
              </p>

              {scoring ? (
                <LoadingState>Scoring against the ledger…</LoadingState>
              ) : candidates.length === 0 ? (
                <EmptyState>
                  {exact
                    ? "Nothing in the books matches this amount. Turn off Exact match to see vouchers that could cover part of it."
                    : "Nothing in the books looks like this line. Either it is still in transit, or it was never booked — and those have different answers."}
                </EmptyState>
              ) : (
                <Grid>
                  <thead>
                    <tr>
                      <Th width="2rem" />
                      <Th>Voucher</Th>
                      <Th align="right" width="8rem">
                        Allocate
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((candidate) => {
                      const on = candidate.journal_line_id in picked
                      return (
                        <tr key={candidate.journal_line_id}>
                          <Td>
                            <Checkbox
                              checked={on}
                              onChange={() => toggle(candidate)}
                              label={
                                <span className="sr-only">
                                  Use this voucher
                                </span>
                              }
                            />
                          </Td>
                          <Td>
                            <Reasons reasons={candidate.reasons} />
                            <span className="mt-1 block font-mono text-[0.875rem] text-mute">
                              {candidate.journal_line_id}
                            </span>
                            {candidate.auto_match && (
                              <Pill tone="ok">Clear match</Pill>
                            )}
                          </Td>
                          <Td align="right">
                            {on ? (
                              <Input
                                inputMode="numeric"
                                value={picked[candidate.journal_line_id] ?? ""}
                                onChange={(event) =>
                                  setPicked((was) => ({
                                    ...was,
                                    [candidate.journal_line_id]:
                                      event.target.value,
                                  }))
                                }
                                className="h-8 w-[7.5rem] text-right"
                                aria-label="Allocated amount"
                              />
                            ) : (
                              <span className="text-mute">—</span>
                            )}
                          </Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Grid>
              )}

              <div className="flex items-center gap-3 border-t border-hairline pt-3">
                <span className="text-[0.875rem] text-body">
                  Allocated{" "}
                  <b className="font-medium text-ink tabular-nums">
                    {money(allocated)}
                  </b>{" "}
                  of {money(remaining)} ·{" "}
                  <span
                    className={
                      left === 0 ? "text-ok-fg" : "text-warn-fg tabular-nums"
                    }
                  >
                    {left === 0 ? "nothing left" : `${money(left)} left`}
                  </span>
                </span>
                <span className="ml-auto">
                  <Button
                    variant="primary"
                    disabled={busy || allocated <= 0 || left < 0}
                    onClick={() =>
                      onReconcile(
                        candidates
                          .filter(
                            (candidate) => candidate.journal_line_id in picked
                          )
                          .map((candidate) => ({
                            suggestion: candidate,
                            allocated: amountOf(candidate.journal_line_id),
                          }))
                          .filter((pick) => pick.allocated > 0)
                      )
                    }
                  >
                    Reconcile
                  </Button>
                </span>
              </div>
            </>
          )}

          {action === "create" && (
            <div className="flex flex-col gap-3">
              <p className="text-[0.875rem] leading-relaxed text-body">
                The bank did something the books never recorded — a charge,
                interest, a transfer that arrived without a document. This posts
                a journal entry for what is left of the line and agrees it in
                the same breath.
              </p>
              {/* This was a text box somebody typed `602100100103` into,
                  which is a twelve-digit exam rather than a field — and since
                  the chart collapsed to forty accounts it could not have asked
                  the second half of the question at all. The shared control
                  searches the chart and then asks for the category the chosen
                  account's family demands, or nothing at all when it demands
                  nothing. */}
              <div className="flex flex-col gap-[0.4375rem]">
                <span className="text-[0.875rem] font-medium text-text">
                  Account
                </span>
                <AccountAndCategory
                  value={account}
                  onChange={setAccount}
                  placeholder="Which account is the other side of this"
                  accept={(one) => (one.is_active ? null : "cancelled")}
                  categoryLabel="What this charge was"
                  explain
                />
              </div>
              <Field
                label="Why"
                required
                hint="The only record of the judgement somebody made."
              >
                <Textarea
                  value={memo}
                  onChange={(event) => setMemo(event.target.value)}
                  rows={2}
                />
              </Field>
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  disabled={
                    busy || !accountChoiceReady(account) || memo.trim() === ""
                  }
                  onClick={() =>
                    account !== null && onCreate(account, memo.trim())
                  }
                >
                  Create voucher and reconcile
                </Button>
              </div>
            </div>
          )}

          {action === "update" && (
            <div className="flex flex-col gap-3">
              <p className="text-[0.875rem] leading-relaxed text-body">
                Saying who the other side was makes the line recognisable, and
                is what somebody reads before agreeing it.
              </p>
              <Field label="Counterparty">
                <Select
                  value={kind}
                  onChange={setKind}
                  aria-label="Counterparty kind"
                >
                  <option value="">Not said</option>
                  <option value="SUPPLIER">Supplier</option>
                  <option value="CUSTOMER">Customer</option>
                  <option value="MEMBER">Member</option>
                  <option value="STAFF">Staff</option>
                  <option value="OTHER">Someone else</option>
                </Select>
              </Field>
              <Field
                label="Who"
                hint={
                  line.bank_said === ""
                    ? "The bank's file did not name them."
                    : `The bank called them "${line.bank_said}".`
                }
              >
                <Input
                  value={who}
                  onChange={(event) => setWho(event.target.value)}
                  placeholder="Pemasok C"
                />
              </Field>
              <Field label="Note" hint="Optional. Stays on the line for good.">
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                />
              </Field>
              <LabNote>
                The date, amount, narration and reference are not editable here
                and will not be. They came out of the bank&rsquo;s file, the
                duplicate check is computed over them, and a narration somebody
                can retype is no longer the evidence this reconciliation is
                being checked against. ERPNext lets all four be edited.
              </LabNote>
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() =>
                    onUpdate({
                      party_type: kind === "" ? null : kind,
                      party_id: null,
                      party_name: who.trim(),
                      note: note.trim(),
                    })
                  }
                >
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
