import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import {
  bankStatementLines,
  bankSuggestions,
  confirmBankMatch,
  financeKeys,
  listBankStatements,
} from "@/lib/finance"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { BankStatementLineRow, Suggestion } from "@itulah/contract"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Link2, TriangleAlert } from "lucide-react"
import { useState } from "react"

/// The bank's account of events, beside ours.
///
/// # What this screen is for
///
/// Not to record anything. Matching a line says "we booked this and the bank
/// has now confirmed it" — there is nothing new to write, and this screen
/// deliberately posts no journal. The rows that matter are the ones that do NOT
/// match: either the money is still in transit, or the bank knows about
/// something we have not booked. Making "reconcile" post entries would turn a
/// checking tool into one that quietly invents them.
///
/// # Why a suggestion shows its reasons and not just a score
///
/// The person accepting a match is deciding whether two records are the same
/// event. "94" tells them nothing about that. "amount matches exactly · same
/// day · reference matches" tells them exactly what agreed, and — more usefully
/// — what did not.
///
/// A tie at the top auto-matches nothing, on purpose. Two identical payments to
/// two suppliers on the same Friday is an ordinary week, and it is precisely
/// the case a person exists to settle.
export function BankReconciliationScreen() {
  const [open, setOpen] = useState<string | null>(null)
  const statements = useQuery({
    queryKey: financeKeys.bankStatements(),
    queryFn: ({ signal }) => listBankStatements(signal),
  })

  const rows = statements.data ?? []
  const active = open ?? rows[0]?.statement_id ?? null

  return (
    <AppShell nav={<Nav />} section={<FinanceNav />}>
      <ScreenHeader
        title="Bank Reconciliation"
        subtitle={rows.length === 0 ? undefined : `${rows.length} statements`}
      />

      {statements.isPending ? (
        <ScreenState>Loading…</ScreenState>
      ) : statements.error !== null ? (
        <ScreenState tone="problem">
          {statements.error instanceof Error
            ? statements.error.message
            : "could not load statements"}
        </ScreenState>
      ) : rows.length === 0 ? (
        <ScreenState>
          No statement has been imported. A statement is what the bank says
          happened; reconciling it against the ledger proves the two agree, and
          shows what neither side can explain on its own.
        </ScreenState>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-2.5 py-1.5">
            {rows.map((statement) => {
              const done = statement.matched_count === statement.line_count
              return (
                <button
                  key={statement.statement_id}
                  type="button"
                  onClick={() => setOpen(statement.statement_id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px]",
                    statement.statement_id === active
                      ? "bg-muted font-medium"
                      : "hover:bg-muted/60",
                  )}
                >
                  <span>{statement.account_name}</span>
                  <span className="text-muted-foreground">{statement.period_start}</span>
                  <span
                    className={cn(
                      "font-mono text-[10px]",
                      done ? "text-emerald-600" : "text-amber-600",
                    )}
                  >
                    {statement.matched_count}/{statement.line_count}
                  </span>
                </button>
              )
            })}
          </div>
          {active !== null && <Lines statementId={active} />}
        </div>
      )}
    </AppShell>
  )
}

function Lines({ statementId }: { statementId: string }) {
  const client = useQueryClient()
  const lines = useQuery({
    queryKey: financeKeys.bankLines(statementId),
    queryFn: ({ signal }) => bankStatementLines(statementId, signal),
  })
  const suggestions = useQuery({
    queryKey: financeKeys.bankSuggestions(statementId),
    queryFn: ({ signal }) => bankSuggestions(statementId, signal),
  })
  const confirm = useMutation({
    mutationFn: (input: { lineId: string; suggestion: Suggestion }) =>
      confirmBankMatch(input.lineId, {
        journal_line_id: input.suggestion.journal_line_id,
        score: input.suggestion.score,
        reasons: input.suggestion.reasons,
        automatic: input.suggestion.auto_match,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["finance", "bank-lines"] })
      void client.invalidateQueries({ queryKey: ["finance", "bank-suggestions"] })
      void client.invalidateQueries({ queryKey: ["finance", "bank-statements"] })
    },
  })

  if (lines.isPending) return <ScreenState>Loading lines…</ScreenState>
  if (lines.error !== null) {
    return (
      <ScreenState tone="problem">
        {lines.error instanceof Error ? lines.error.message : "could not load lines"}
      </ScreenState>
    )
  }

  const byLine = new Map(
    (suggestions.data ?? []).map((entry) => [entry.line_id, entry.suggestions]),
  )
  const unmatched = lines.data.filter((line) => line.matched_journal_line_id === null)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {unmatched.length === 0 && (
        <p className="flex items-center gap-1.5 border-b px-3.5 py-2 text-[12px] text-emerald-700">
          <Check className="size-3.5" /> Every line on this statement is accounted for.
        </p>
      )}
      <table className="w-full text-[12.5px]">
        <thead className="bg-card sticky top-0 border-b">
          <tr className="text-muted-foreground text-[10.5px]">
            <th className="px-3.5 py-1.5 text-left font-medium">Date</th>
            <th className="px-3 py-1.5 text-left font-medium">What the bank says</th>
            <th className="px-3 py-1.5 text-right font-medium">Out</th>
            <th className="px-3 py-1.5 text-right font-medium">In</th>
            <th className="px-3 py-1.5 text-left font-medium">Our ledger</th>
          </tr>
        </thead>
        <tbody>
          {lines.data.map((line) => (
            <LineRow
              key={line.line_id}
              line={line}
              suggestions={byLine.get(line.line_id) ?? []}
              onConfirm={(suggestion) => confirm.mutate({ lineId: line.line_id, suggestion })}
              busy={confirm.isPending}
            />
          ))}
        </tbody>
      </table>
      {confirm.error !== null && (
        <p className="text-destructive px-3.5 py-2 text-[12px]">
          {confirm.error instanceof Error ? confirm.error.message : "could not match"}
        </p>
      )}
    </div>
  )
}

function LineRow({
  line,
  suggestions,
  onConfirm,
  busy,
}: {
  line: BankStatementLineRow
  suggestions: readonly Suggestion[]
  onConfirm: (suggestion: Suggestion) => void
  busy: boolean
}) {
  const matched = line.matched_journal_line_id !== null
  return (
    <tr className={cn("border-b align-top", !matched && "bg-amber-50/30")}>
      <td className="px-3.5 py-1.5 tabular-nums">{line.value_date}</td>
      <td className="px-3 py-1.5">
        <p className="truncate">{line.description}</p>
        {line.reference !== null && (
          <p className="text-muted-foreground font-mono text-[10.5px]">{line.reference}</p>
        )}
      </td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
        {line.debit_minor === 0 ? "" : money(line.debit_minor)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
        {line.credit_minor === 0 ? "" : money(line.credit_minor)}
      </td>
      <td className="px-3 py-1.5">
        {matched ? (
          <div className="flex items-baseline gap-1.5 text-emerald-700">
            <Link2 className="size-3 shrink-0 self-center" />
            <span className="font-mono text-[11px]">{line.matched_entry_number}</span>
            {line.match_reasons.length > 0 && (
              <span className="text-muted-foreground text-[10.5px]">
                {line.match_reasons.join(" · ")}
              </span>
            )}
          </div>
        ) : suggestions.length === 0 ? (
          <span className="flex items-baseline gap-1.5 text-amber-700">
            <TriangleAlert className="size-3 shrink-0 self-center" />
            {/* The honest reading: nothing in our books looks like this. Either
                it is still in transit, or we have not booked it — and both are
                a person's problem, not the matcher's. */}
            nothing in the ledger matches — either it is in transit, or we have
            not booked it
          </span>
        ) : (
          <ul className="space-y-1">
            {suggestions.slice(0, 3).map((suggestion) => (
              <li key={suggestion.journal_line_id} className="flex items-baseline gap-2">
                <Button
                  size="sm"
                  variant={suggestion.auto_match ? "default" : "outline"}
                  className="h-5 shrink-0 px-1.5 text-[10.5px]"
                  disabled={busy}
                  onClick={() => onConfirm(suggestion)}
                >
                  {suggestion.auto_match ? "Accept" : "Match"}
                </Button>
                {/* Reasons, not the score. The score orders the list; the
                    reasons are what somebody actually checks. */}
                <span className="text-muted-foreground text-[11px]">
                  {suggestion.reasons.join(" · ")}
                </span>
              </li>
            ))}
            {suggestions.length > 1 && !suggestions[0].auto_match && (
              <li className="text-muted-foreground text-[10.5px]">
                more than one candidate fits — nothing is accepted automatically when
                the top two tie
              </li>
            )}
          </ul>
        )}
      </td>
    </tr>
  )
}
