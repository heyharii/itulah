import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { X } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Panel } from "@/components/ui/dialog"
import { Checkbox, Field, Textarea } from "@/components/ui/field"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { count, day, label, money } from "@/lib/format"
import {
  acceptBankProposal,
  bankReconKeys,
  ignoreBankProposal,
  useBankProposals,
} from "@/lib/queries/bank-recon"
import {
  bookBankLine,
  bookOnlyLines,
  confirmBankMatch,
  financeKeys,
  unmatchBankLine,
} from "@/lib/queries/finance"
import {
  AccountAndCategory,
  accountChoiceReady,
  type AccountChoice,
} from "@/screens/finance/parts"
import {
  CardRow,
  Grid,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { Reasons } from "@/screens/finance-lab-2/parts"
import {
  useMoney,
  useStatementLines,
  useStatements,
  useSuggestions,
} from "@/screens/finance-lab-2/hooks"
import type {
  BankRuleProposalRow,
  BankStatementLineRow,
  BookOnlyLine,
  LineAllocation,
  Suggestion,
} from "@itulah/contract"

/// Option 1 of the prototype the owner sketched — "Sejajar otomatis"
/// (file:///bank-recon-options-prototype.html, ~line 963): the system has
/// already paired what it can, each row is one bank line beside the book
/// line it is, and the work left is "Confirm all exact" plus the two piles
/// that fall out the bottom — only on the bank, only in the books.
///
/// # What "paired" means here
///
/// The prototype invents four reasons a pair can be right — Exact, Date
/// moved, 2→1, and a fee shortfall. This screen only ever gets to say two of
/// them, because that is what `GET .../suggestions` can prove on its own:
/// the matcher's automatic plan (`resolve`, `cloud/domain/bank_match.rs`)
/// only ever hands back a LONE candidate whose amount agrees exactly, same
/// day or a few days apart. A two-book-lines-to-one-bank-line pairing and a
/// fee shortfall both exist in the ledger, but nothing here proposes them
/// pre-paired — a person still has to notice and tick them, which is what
/// "Open the full matcher" is for.
///
/// # Two more ways in
///
/// One bank line can be several vouchers ("Match several…", 2→1): the picker
/// lists what `/suggestions?exact=0` offers for the line, drawn with the
/// date, entry and amount `/book-only` knows about each, and settles the line
/// only when the ticked ones add up to exactly what is left of it.
///
/// "In the books, not on the bank" is ERPNext's *Amounts not reflected in
/// bank*: `/book-only` lists every posting on the account nobody has claimed,
/// and the summary under it walks from the books' balance to the balance the
/// bank should be showing. When that endpoint does not answer (an older
/// server) the section, and the picker's detail, stay away quietly.
export function PairedReconciliation({
  statementId,
  onOpenFullMatcher,
}: {
  statementId: string
  /// Escape hatch to `finance-lab-2/bank-reconciliation`'s own matcher — the
  /// screen that can still split one bank line across several vouchers or
  /// allocate a partial amount, which nothing here auto-pairs.
  onOpenFullMatcher: () => void
}) {
  const client = useQueryClient()
  const statements = useStatements()
  const overview = useMoney()
  const lines = useStatementLines(statementId)
  const suggestions = useSuggestions(statementId, true)
  const proposals = useBankProposals(statementId)
  // Quiet when the server is older than this screen: no retry, no error line.
  const bookOnly = useQuery({
    queryKey: financeKeys.bankBookOnly(statementId),
    queryFn: ({ signal }) => bookOnlyLines(statementId, signal),
    retry: false,
  })
  const [matching, setMatching] = useState<BankStatementLineRow | null>(null)

  const statement = statements.data?.rows.find(
    (row) => row.statement_id === statementId
  )
  const book = useMemo(() => {
    if (statement === undefined) return null
    return (
      overview.data?.rows.find(
        (row) =>
          row.account_code === statement.account_code &&
          row.unit_id === statement.unit_id
      ) ?? null
    )
  }, [overview.data, statement])

  const byLine = useMemo(() => {
    const table = new Map<string, Suggestion[]>()
    for (const entry of suggestions.data ?? [])
      table.set(entry.line_id, [...entry.suggestions])
    return table
  }, [suggestions.data])

  const proposalByLine = useMemo(() => {
    const table = new Map<string, BankRuleProposalRow>()
    for (const row of proposals.data ?? []) table.set(row.line_id, row)
    return table
  }, [proposals.data])

  const refresh = () => {
    void client.invalidateQueries({
      queryKey: financeKeys.bankLines(statementId),
    })
    void client.invalidateQueries({
      queryKey: financeKeys.bankSuggestions(statementId, true),
    })
    void client.invalidateQueries({
      queryKey: financeKeys.bankSuggestions(statementId, false),
    })
    void client.invalidateQueries({ queryKey: financeKeys.bankStatements() })
    void client.invalidateQueries({
      queryKey: bankReconKeys.proposals(statementId),
    })
    void client.invalidateQueries({
      queryKey: financeKeys.bankBookOnly(statementId),
    })
    void client.invalidateQueries({ queryKey: ["finance", "money"] })
  }

  const linesData = lines.data ?? []
  const settled = linesData.filter((line) => line.unallocated_minor === 0)
  const open = linesData.filter((line) => line.unallocated_minor > 0)

  const paired: PairedRow[] = []
  const bankOnly: BankStatementLineRow[] = []
  for (const line of open) {
    const leader = (byLine.get(line.line_id) ?? []).find((c) => c.auto_match)
    if (leader === undefined) {
      bankOnly.push(line)
    } else {
      paired.push({
        line,
        suggestion: leader,
        kind: leader.reasons.includes("same day") ? "exact" : "date",
      })
    }
  }
  const exactCount = paired.length

  const confirm = useMutation({
    mutationFn: (input: { lineId: string; suggestion: Suggestion }) =>
      confirmBankMatch(input.lineId, {
        journal_line_id: input.suggestion.journal_line_id,
        score: input.suggestion.score,
        reasons: [...input.suggestion.reasons],
        automatic: input.suggestion.auto_match,
        allocated_minor: null,
      }),
    onSuccess: refresh,
  })

  const confirmAll = useMutation({
    mutationFn: async () => {
      for (const row of paired) {
        await confirmBankMatch(row.line.line_id, {
          journal_line_id: row.suggestion.journal_line_id,
          score: row.suggestion.score,
          reasons: [...row.suggestion.reasons],
          automatic: true,
          allocated_minor: null,
        })
      }
      return paired.length
    },
    onSuccess: refresh,
  })

  const undo = useMutation({
    mutationFn: (input: { lineId: string; journalLineId?: string }) =>
      unmatchBankLine(input.lineId, undefined, input.journalLineId),
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
        category_code: input.picked.category_code,
        party_name: null,
      }),
    onSuccess: refresh,
  })

  const accept = useMutation({
    mutationFn: (proposalId: string) => acceptBankProposal(proposalId),
    onSuccess: refresh,
  })

  /// "No, that is not what this is." The proposal is kept as IGNORED so the
  /// rule's screen can show people keep refusing it; the line stays open.
  const ignore = useMutation({
    mutationFn: (proposalId: string) => ignoreBankProposal(proposalId),
    onSuccess: refresh,
  })

  if (statement === undefined || lines.isPending) {
    return <LoadingState>Reading the statement…</LoadingState>
  }

  const difference =
    book === null ? null : book.per_books_minor - statement.closing_minor

  return (
    <div className="flex flex-col gap-4 px-5 pb-6">
      <CardRow>
        <NumberCard
          label="Bank statement closing balance"
          value={statement.closing_minor}
          note={`to ${day(statement.period_end)}`}
        />
        <NumberCard
          label="Our books"
          value={book?.per_books_minor ?? null}
          note={
            book === null ? "no mapped account" : `ledger ${book.account_code}`
          }
        />
        <NumberCard
          label="Difference"
          value={difference}
          tone={
            difference === null ? undefined : difference === 0 ? "ok" : "bad"
          }
          note={
            difference === 0
              ? "the bank and the books match"
              : `${count(settled.length)} of ${count(linesData.length)} lines agreed`
          }
        />
      </CardRow>

      <div className="flex items-center gap-3">
        <h2 className="text-[0.9375rem] font-medium text-ink">
          Paired for you
        </h2>
        <span className="text-[0.9375rem] text-mute">
          tick to confirm — each row is one bank line and the book line it is
        </span>
        <span className="flex-1" />
        <Button
          variant="primary"
          size="sm"
          pending={confirmAll.isPending}
          disabled={exactCount === 0}
          onClick={() => confirmAll.mutate()}
        >
          {confirmAll.isPending
            ? "Confirming…"
            : `Confirm all exact (${count(exactCount)})`}
        </Button>
      </div>

      {settled.length === 0 && paired.length === 0 ? (
        <EmptyState>Nothing has been paired yet on this statement.</EmptyState>
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th width="6rem">Bank date</Th>
              <Th>Bank statement</Th>
              <Th align="right" width="8.5rem">
                Amount
              </Th>
              <Th width="12rem">Why</Th>
              <Th>Our books</Th>
              <Th align="right" width="8.5rem">
                Amount
              </Th>
              <Th width="14rem" />
            </tr>
          </thead>
          <tbody>
            {settled.map((line) => (
              <SettledRow
                key={line.line_id}
                line={line}
                busy={undo.isPending}
                onUndo={() => undo.mutate({ lineId: line.line_id })}
                onUndoOne={(journalLineId) =>
                  undo.mutate({ lineId: line.line_id, journalLineId })
                }
              />
            ))}
            {paired.map((row) => (
              <PairRow
                key={row.line.line_id}
                row={row}
                busy={confirm.isPending || confirmAll.isPending}
                onConfirm={() =>
                  confirm.mutate({
                    lineId: row.line.line_id,
                    suggestion: row.suggestion,
                  })
                }
                onMatchSeveral={() => setMatching(row.line)}
              />
            ))}
          </tbody>
        </Grid>
      )}

      <div>
        <h2 className="text-[0.9375rem] font-medium text-ink">
          Only in the bank
        </h2>
        <p className="mt-0.5 text-[0.9375rem] text-mute">
          The bank reported these; nothing in the books looks like them. Book
          the other side, or open the full matcher if a voucher really is in
          here somewhere.
        </p>
      </div>
      {bankOnly.length === 0 ? (
        <EmptyState>
          Every bank line either paired or is already agreed.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {bankOnly.map((line) => (
            <BankOnlyRow
              key={line.line_id}
              line={line}
              proposal={proposalByLine.get(line.line_id) ?? null}
              busy={create.isPending || accept.isPending || ignore.isPending}
              onAccept={(proposalId) => accept.mutate(proposalId)}
              onIgnore={(proposalId) => ignore.mutate(proposalId)}
              onCreate={(picked, memo) =>
                create.mutate({ lineId: line.line_id, picked, memo })
              }
              onOpenFullMatcher={onOpenFullMatcher}
              onMatchSeveral={() => setMatching(line)}
              onUndoOne={(journalLineId) =>
                undo.mutate({ lineId: line.line_id, journalLineId })
              }
            />
          ))}
        </div>
      )}

      {bookOnly.data !== undefined && (
        <BookOnlySection
          rows={bookOnly.data}
          booksMinor={book?.per_books_minor ?? null}
          closingMinor={statement.closing_minor}
        />
      )}

      {matching !== null && (
        <MatchSeveralPanel
          statementId={statementId}
          line={
            linesData.find((one) => one.line_id === matching.line_id) ??
            matching
          }
          details={bookOnly.data}
          onClose={() => setMatching(null)}
          onDone={() => {
            refresh()
            setMatching(null)
          }}
        />
      )}
    </div>
  )
}

interface PairedRow {
  readonly line: BankStatementLineRow
  readonly suggestion: Suggestion
  readonly kind: "exact" | "date"
}

function SettledRow({
  line,
  busy,
  onUndo,
  onUndoOne,
}: {
  line: BankStatementLineRow
  busy: boolean
  onUndo: () => void
  onUndoOne: (journalLineId: string) => void
}) {
  const amount = line.debit_minor === 0 ? line.credit_minor : line.debit_minor
  // Two or more vouchers settled this line: draw each, with its own way back.
  const several = line.allocations.length > 1
  return (
    <tr className="bg-soft/60">
      <Td>{day(line.value_date)}</Td>
      <Td className="text-ink">{line.description}</Td>
      <Td align="right">{money(amount)}</Td>
      <Td>
        <span className="text-[0.9375rem] text-ok-fg">Agreed</span>
      </Td>
      {several ? (
        <>
          <Td className="py-1.5">
            <Allocations
              allocations={line.allocations}
              busy={busy}
              onUndo={onUndoOne}
            />
          </Td>
          <Td align="right" className="py-1.5">
            <div className="flex flex-col">
              {line.allocations.map((one) => (
                <span
                  key={one.match_id}
                  className="flex h-9 items-center justify-end"
                >
                  {money(one.allocated_minor)}
                </span>
              ))}
            </div>
          </Td>
        </>
      ) : (
        <>
          <Td className="text-body">
            {line.matched_entry_number ??
              (line.allocations.length > 0
                ? (line.allocations[0]?.entry_number ?? "1 entry")
                : "—")}
          </Td>
          <Td align="right">{money(line.allocated_minor)}</Td>
        </>
      )}
      <Td align="right">
        <Button size="sm" variant="quiet" disabled={busy} onClick={onUndo}>
          Undo
        </Button>
      </Td>
    </tr>
  )
}

/// The vouchers that together settled (or part-settled) one bank line, one per
/// row, each with an × that takes back only its own claim.
function Allocations({
  allocations,
  busy,
  onUndo,
}: {
  allocations: readonly LineAllocation[]
  busy: boolean
  onUndo: (journalLineId: string) => void
}) {
  return (
    <div className="flex flex-col">
      {allocations.map((one) => (
        <span
          key={one.match_id}
          className="flex h-9 items-center gap-2 whitespace-nowrap"
        >
          <span className="font-mono text-[0.9375rem] text-body">
            {one.entry_number ?? "—"}
          </span>
          <span className="text-mute tabular-nums">
            {money(one.allocated_minor)}
          </span>
          <Button
            size="icon"
            variant="quiet"
            className="size-7"
            aria-label={`Undo ${one.entry_number ?? "this match"}`}
            disabled={busy}
            onClick={() => onUndo(one.journal_line_id)}
          >
            <X className="size-4" />
          </Button>
        </span>
      ))}
    </div>
  )
}

function PairRow({
  row,
  busy,
  onConfirm,
  onMatchSeveral,
}: {
  row: PairedRow
  busy: boolean
  onConfirm: () => void
  onMatchSeveral: () => void
}) {
  const { line, suggestion, kind } = row
  const amount = line.debit_minor === 0 ? line.credit_minor : line.debit_minor
  return (
    <tr>
      <Td>{day(line.value_date)}</Td>
      <Td className="text-ink">{line.description}</Td>
      <Td align="right">{money(amount)}</Td>
      <Td>
        <span
          className={
            kind === "exact"
              ? "text-[0.9375rem] font-medium text-ok-fg"
              : "text-[0.9375rem] font-medium text-accent"
          }
        >
          {kind === "exact" ? "Exact" : "Date moved"}
        </span>
        <div className="mt-0.5">
          <Reasons reasons={suggestion.reasons} />
        </div>
      </Td>
      <Td className="font-mono text-[0.9375rem] text-mute">
        {suggestion.journal_line_id}
      </Td>
      <Td align="right">{money(amount)}</Td>
      <Td align="right">
        <span className="inline-flex items-center gap-1">
          <Button size="sm" variant="quiet" onClick={onMatchSeveral}>
            Match several…
          </Button>
          <Button
            size="sm"
            variant={kind === "exact" ? "soft" : "ghost"}
            disabled={busy}
            onClick={onConfirm}
          >
            Confirm
          </Button>
        </span>
      </Td>
    </tr>
  )
}

function BankOnlyRow({
  line,
  proposal,
  busy,
  onAccept,
  onIgnore,
  onCreate,
  onOpenFullMatcher,
  onMatchSeveral,
  onUndoOne,
}: {
  line: BankStatementLineRow
  /// A rule already worked out what this line means (`bank-rules`) — one
  /// click posts it, the same as the prototype's "Aturan membuat voucher
  /// sendiri (BKK) — tidak perlu ketik".
  proposal: BankRuleProposalRow | null
  busy: boolean
  onAccept: (proposalId: string) => void
  onIgnore: (proposalId: string) => void
  onCreate: (picked: AccountChoice, memo: string) => void
  onOpenFullMatcher: () => void
  onMatchSeveral: () => void
  onUndoOne: (journalLineId: string) => void
}) {
  const [booking, setBooking] = useState(false)
  const [picked, setPicked] = useState<AccountChoice | null>(null)
  const [memo, setMemo] = useState("")
  const amount = line.debit_minor === 0 ? line.credit_minor : line.debit_minor
  const kind = line.debit_minor === 0 ? "BKM" : "BKK"

  return (
    <div className="rounded-inner border border-hairline p-3">
      <div className="flex items-start gap-2.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] text-ink">
            {line.description}
          </span>
          <span className="block text-[0.9375rem] text-mute">
            {day(line.value_date)}
            {line.reference ? ` · ${line.reference}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-right text-[0.9375rem] font-medium tabular-nums">
          {money(amount)}
          {line.allocations.length > 0 && (
            <span className="block font-normal text-mute">
              {money(line.unallocated_minor)} left
            </span>
          )}
        </span>
      </div>
      {line.allocations.length > 0 && (
        <div className="mt-1.5 border-t border-hairline pt-1.5">
          <Allocations
            allocations={line.allocations}
            busy={busy}
            onUndo={onUndoOne}
          />
        </div>
      )}

      {!booking && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-hairline pt-2">
          {line.allocations.length > 0 ? null : proposal !== null &&
            proposal.category_refusal === null ? (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => onAccept(proposal.proposal_id)}
            >
              Create {kind} — {proposal.category_name ?? proposal.semantic_key}
            </Button>
          ) : (
            <Button size="sm" onClick={() => setBooking(true)}>
              Create {kind}
            </Button>
          )}
          {/* The rule's guess can be wrong; saying so keeps the line open and
              tells the rule's screen people keep refusing it. */}
          {line.allocations.length === 0 && proposal !== null && (
            <Button
              size="sm"
              variant="quiet"
              disabled={busy}
              onClick={() => onIgnore(proposal.proposal_id)}
            >
              Ignore suggestion
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onOpenFullMatcher}>
            Match a voucher instead
          </Button>
          <Button size="sm" variant="quiet" onClick={onMatchSeveral}>
            Match several…
          </Button>
        </div>
      )}

      {booking && (
        <div className="mt-2 flex flex-col gap-2 border-t border-hairline pt-2.5">
          <AccountAndCategory
            accept={(account) => (account.is_active ? null : "cancelled")}
            value={picked}
            onChange={setPicked}
            categoryLabel="What this charge was"
            explain
          />
          <Field label="Why this account" required>
            <Textarea
              rows={2}
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
            />
          </Field>
          <div className="flex items-center justify-end gap-2">
            <Button data-cancel size="sm" variant="quiet" onClick={() => setBooking(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={
                !accountChoiceReady(picked) || memo.trim() === "" || busy
              }
              onClick={() => {
                if (picked === null) return
                onCreate(picked, memo.trim())
                setBooking(false)
              }}
            >
              {busy ? "Creating…" : `Create ${kind}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/// "Match several…" — one bank line, more than one voucher (2→1).
///
/// The candidates are what the server would offer with the exact-amount switch
/// off; the date, entry and amount come from `/book-only`, which knows each
/// unclaimed posting. Match is allowed only when the ticked ones add up to
/// exactly what is left of the line: a difference of anything else would be
/// a line that says "agreed" while a few thousand rupiah are unexplained.
function MatchSeveralPanel({
  statementId,
  line,
  details,
  onClose,
  onDone,
}: {
  statementId: string
  line: BankStatementLineRow
  details: readonly BookOnlyLine[] | undefined
  onClose: () => void
  onDone: () => void
}) {
  const suggestions = useSuggestions(statementId, false)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const incoming = line.debit_minor === 0

  const candidates = useMemo(() => {
    const byId = new Map<string, BookOnlyLine>()
    for (const one of details ?? []) byId.set(one.journal_line_id, one)
    const offered =
      suggestions.data?.find((entry) => entry.line_id === line.line_id)
        ?.suggestions ?? []
    const rows: {
      suggestion: Suggestion
      book: BookOnlyLine
      amount: number
    }[] = []
    for (const suggestion of offered) {
      const book = byId.get(suggestion.journal_line_id)
      if (book === undefined) continue
      const amount = incoming ? book.deposit_minor : book.withdrawal_minor
      // The wrong direction cannot be part of this line.
      if (amount <= 0) continue
      rows.push({ suggestion, book, amount })
    }
    return rows
  }, [details, suggestions.data, line, incoming])

  const left = line.unallocated_minor
  const selected = candidates
    .filter((one) => ticked.has(one.suggestion.journal_line_id))
    .reduce((sum, one) => sum + one.amount, 0)
  const difference = left - selected
  const exact = ticked.size > 0 && difference === 0

  const toggle = (id: string) =>
    setTicked((had) => {
      const next = new Set(had)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const match = useMutation({
    mutationFn: async () => {
      // One call per voucher, in order. Each claims its own amount; the
      // server refuses a claim that no longer fits, so a line never ends up
      // over-allocated even if somebody else touched it meanwhile.
      for (const one of candidates) {
        if (!ticked.has(one.suggestion.journal_line_id)) continue
        await confirmBankMatch(line.line_id, {
          journal_line_id: one.suggestion.journal_line_id,
          score: one.suggestion.score,
          reasons: [...one.suggestion.reasons],
          automatic: false,
          allocated_minor: one.amount,
        })
      }
    },
    onSuccess: onDone,
  })

  return (
    <Panel
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Match several vouchers"
      sub={`${line.description} · ${day(line.value_date)} · ${money(left)} still to match`}
    >
      {suggestions.isPending ? (
        <LoadingState>Looking for candidates…</LoadingState>
      ) : details === undefined ? (
        <EmptyState>
          The books' side of this list is not available from the server yet, so
          the candidates cannot be shown.
        </EmptyState>
      ) : candidates.length === 0 ? (
        <EmptyState>
          Nothing unclaimed on this account could be part of this line.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[0.9375rem] whitespace-normal text-mute">
            Tick the entries that together make up this bank line. Match is
            available when they add up to exactly what is left of it.
          </p>
          <Grid>
            <thead>
              <tr>
                <Th width="3rem" />
                <Th width="6rem">Date</Th>
                <Th width="9rem">Entry</Th>
                <Th>Memo</Th>
                <Th align="right" width="9rem">
                  Amount
                </Th>
              </tr>
            </thead>
            <tbody>
              {candidates.map(({ suggestion, book, amount }) => (
                <tr key={suggestion.journal_line_id}>
                  <Td>
                    <Checkbox
                      label={
                        <span className="sr-only">{book.entry_number}</span>
                      }
                      checked={ticked.has(suggestion.journal_line_id)}
                      onChange={() => toggle(suggestion.journal_line_id)}
                    />
                  </Td>
                  <Td>{day(book.posting_date)}</Td>
                  <Td>
                    <span className="font-mono text-[0.9375rem] text-body">
                      {book.entry_number}
                    </span>
                  </Td>
                  <Td className="max-w-0">
                    <span className="block truncate text-ink">
                      {book.memo === "" ? label(book.source_kind) : book.memo}
                    </span>
                  </Td>
                  <Td align="right">{money(amount)}</Td>
                </tr>
              ))}
            </tbody>
          </Grid>
          <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline bg-canvas px-5 py-3">
            <span className="text-[0.9375rem] text-body">
              Selected <b className="font-medium text-ink">{money(selected)}</b>{" "}
              of <b className="font-medium text-ink">{money(left)}</b>
              {" · "}difference{" "}
              <b
                className={
                  difference === 0
                    ? "font-medium text-ink"
                    : "font-medium text-bad-fg"
                }
              >
                {money(difference)}
              </b>
            </span>
            <span className="flex-1" />
            <Button data-cancel variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!exact}
              pending={match.isPending}
              onClick={() => match.mutate()}
            >
              {match.isPending
                ? "Matching…"
                : ticked.size > 1
                  ? `Match ${count(ticked.size)} entries`
                  : "Match"}
            </Button>
          </div>
          {match.isError && (
            <Banner tone="bad">
              Some of these could not be matched. What was matched stays
              matched; the line shows what is left.
            </Banner>
          )}
        </div>
      )}
    </Panel>
  )
}

/// ERPNext's *Amounts not reflected in bank*, then the walk from the books'
/// balance to the balance the bank should be showing.
function BookOnlySection({
  rows,
  booksMinor,
  closingMinor,
}: {
  rows: readonly BookOnlyLine[]
  booksMinor: number | null
  closingMinor: number
}) {
  const deposits = rows.reduce((sum, row) => sum + row.deposit_minor, 0)
  const withdrawals = rows.reduce((sum, row) => sum + row.withdrawal_minor, 0)
  const expected =
    booksMinor === null ? null : booksMinor - deposits + withdrawals
  const difference = expected === null ? null : expected - closingMinor

  return (
    <>
      <div>
        <h2 className="text-[0.9375rem] font-medium text-ink">
          In the books, not on the bank
        </h2>
        <p className="mt-0.5 text-[0.9375rem] whitespace-normal text-mute">
          Posted on this account, and no bank line has claimed them yet — a giro
          not cleared, a transfer the bank will show tomorrow.
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState>Every posting on this account is on the bank.</EmptyState>
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th width="6rem">Date</Th>
              <Th width="9rem">Entry</Th>
              <Th width="9rem">Type</Th>
              <Th>Memo</Th>
              <Th align="right" width="9rem">
                Deposit
              </Th>
              <Th align="right" width="9rem">
                Withdrawal
              </Th>
              <Th align="right" width="5rem">
                Days
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.journal_line_id}>
                <Td>{day(row.posting_date)}</Td>
                <Td>
                  <span className="font-mono text-[0.9375rem] text-body">
                    {row.entry_number}
                  </span>
                </Td>
                <Td>{label(row.source_kind)}</Td>
                <Td className="max-w-0">
                  <span className="block truncate text-ink">{row.memo}</span>
                </Td>
                <Td align="right">
                  {row.deposit_minor === 0 ? "" : money(row.deposit_minor)}
                </Td>
                <Td align="right">
                  {row.withdrawal_minor === 0
                    ? ""
                    : money(row.withdrawal_minor)}
                </Td>
                <Td align="right">
                  <span
                    className={
                      row.days_outstanding >= 30 ? "text-warn-fg" : "text-mute"
                    }
                  >
                    {count(row.days_outstanding)}
                  </span>
                </Td>
              </tr>
            ))}
            <TotalRow>
              <td className="px-3.5" colSpan={4}>
                Total
              </td>
              <td className="px-3.5 text-right">{money(deposits)}</td>
              <td className="px-3.5 text-right">{money(withdrawals)}</td>
              <td />
            </TotalRow>
          </tbody>
        </Grid>
      )}

      <Card>
        <dl className="divide-y divide-hairline">
          <SummaryRow label="Balance per books" value={booksMinor} />
          <SummaryRow
            label="Less: deposits not yet on the bank"
            value={deposits}
          />
          <SummaryRow
            label="Add: withdrawals not yet on the bank"
            value={withdrawals}
          />
          <SummaryRow label="Expected bank balance" value={expected} strong />
          <SummaryRow label="Bank statement closing" value={closingMinor} />
          <SummaryRow
            label="Difference"
            value={difference}
            strong
            bad={difference !== null && difference !== 0}
          />
        </dl>
      </Card>
    </>
  )
}

function SummaryRow({
  label: text,
  value,
  strong,
  bad,
}: {
  label: string
  value: number | null
  strong?: boolean
  bad?: boolean
}) {
  return (
    <div className="flex h-11 items-center gap-4 px-4">
      <dt className={strong ? "font-medium text-ink" : "text-body"}>{text}</dt>
      <span className="flex-1" />
      <dd
        className={
          bad
            ? "font-medium text-bad-fg tabular-nums"
            : strong
              ? "font-medium text-ink tabular-nums"
              : "text-body tabular-nums"
        }
      >
        {value === null ? "—" : money(value)}
      </dd>
    </div>
  )
}
