import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import type { MoneyAccountRow, MoneyPot } from "@itulah/contract"

import {
  bankStatementLines,
  bankSuggestions,
  financeKeys,
  listBankStatements,
  moneyOverview,
} from "@/lib/queries/finance"

/// The module's reads. Every key here is one the live Finance module already
/// owns, so opening both costs one request, not two, and the two screens can
/// never disagree about a number.

/// The three pots that hold notes and coins.
///
/// Named here rather than inferred from the account code, because the server
/// already decided it: `MoneyPot` is computed from the meaning, and a screen
/// re-deriving it by substring would get `card_receivable` wrong the first time
/// somebody wrote a key containing "cash".
export const CASH_POTS: readonly MoneyPot[] = [
  "CASH",
  "PETTY_CASH",
  "CASHIER_FLOAT",
]

/// The other half of the same decision. Bank money is one pot, but it is named
/// here for the same reason: the server decided it, and a screen re-deriving it
/// from an account code would be a second opinion.
export const BANK_POTS: readonly MoneyPot[] = ["BANK"]

export function useMoney() {
  return useQuery({
    queryKey: financeKeys.money(null, null),
    queryFn: ({ signal }) => moneyOverview({}, signal),
  })
}

/// Money accounts of one kind, in the chart's own order.
export function useMoneyRows(pots: readonly MoneyPot[]): {
  rows: MoneyAccountRow[]
  pending: boolean
  error: unknown
} {
  const money = useMoney()
  const rows = useMemo(
    () => (money.data?.rows ?? []).filter((row) => pots.includes(row.pot)),
    // `pots` is a module-level constant at every call site, so it is stable.
    [money.data, pots]
  )
  return { rows, pending: money.isPending, error: money.error }
}

export function useStatements() {
  return useQuery({
    queryKey: financeKeys.bankStatements(),
    queryFn: ({ signal }) => listBankStatements(signal),
  })
}

export function useStatementLines(statementId: string | null) {
  return useQuery({
    queryKey: financeKeys.bankLines(statementId ?? ""),
    queryFn: ({ signal }) => bankStatementLines(statementId ?? "", signal),
    enabled: statementId !== null,
  })
}

/// Candidates for every line with room left.
///
/// `exact` is ERPNext's switch and it is part of the key: turning it off asks
/// a different question — "what could cover PART of this line" — and the two
/// answers are cached side by side rather than one evicting the other.
export function useSuggestions(statementId: string | null, exact = true) {
  return useQuery({
    queryKey: financeKeys.bankSuggestions(statementId ?? "", exact),
    queryFn: ({ signal }) => bankSuggestions(statementId ?? "", signal, exact),
    enabled: statementId !== null,
  })
}

/// How many bank lines nobody has agreed yet, across every statement.
///
/// The server adds this up — a browser summing the page it happens to hold
/// would report reconciliation finished while a second page of unagreed lines
/// waited below. Undefined while loading, which the sidebar draws as nothing.
export function useUnagreedLineCount(): number | null | undefined {
  const statements = useStatements()
  return statements.data?.total_unmatched
}
