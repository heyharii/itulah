import { useQuery } from "@tanstack/react-query"

import type { ProfitAndLoss } from "@itulah/contract"
import { domainKeys, profitAndLoss } from "@/lib/queries/finance-domains"
import { balanceMatrix, financeKeys } from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import type { ReportScope } from "@/screens/executive/scope"

/// What the books say, for the executive pages.
///
/// The layered profit and loss (`/finance/reports/profit-and-loss`) — the
/// eleven lines of FINANCE-HARD-RULES P17 as the server derives them from each
/// account's statement section — and cash and bank from the 1001 family.

/// Head office bills every unit a management fee: income at head office (4016),
/// an other operating expense at the unit (7032). Across the whole company the
/// two are one amount paid to itself, and left in they overstate both net sales
/// and other operating expenses by it.
///
/// Taken out only when both halves agree. When they do not, the books have
/// booked one side without the other, and quietly cancelling the smaller
/// against the larger would move net profit by a difference nobody explained —
/// so the statement is shown exactly as posted instead.
const FEE_INCOME = "4016"
const FEE_EXPENSE = "7032"

export function consolidated(statement: ProfitAndLoss): ProfitAndLoss {
  const amount = (code: string) =>
    statement.lines
      .filter((line) => line.account_code === code)
      .reduce((sum, line) => sum + line.amount_minor, 0)
  const income = amount(FEE_INCOME)
  if (income === 0 || income !== amount(FEE_EXPENSE)) return statement
  return {
    ...statement,
    revenue_minor: statement.revenue_minor - income,
    gross_profit_minor: statement.gross_profit_minor - income,
    gross_operating_profit_minor:
      statement.gross_operating_profit_minor - income,
    other_operating_expenses_minor:
      statement.other_operating_expenses_minor - income,
  }
}

/// The books are a unit's (0605), and the report is narrowed to a shop — a
/// site. The unit owning that site is the one whose books answer: `undefined`
/// for the whole company, and `null` while the units register has not said
/// which unit that is.
export function useScopeUnit(scope: ReportScope): string | undefined | null {
  const units = useUnits()
  if (scope.store === undefined) return undefined
  return (
    (units.data ?? []).find((unit) =>
      unit.sites.some((site) => site.id === scope.store)
    )?.id ?? null
  )
}

export function useProfit(scope: ReportScope) {
  const unit = useScopeUnit(scope)
  const read = (from: string, to: string) => ({
    queryKey: domainKeys.profitAndLoss(from, to, unit ?? undefined),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      profitAndLoss(from, to, signal, { unit: unit ?? undefined }),
    select: unit === undefined ? consolidated : undefined,
    enabled: unit !== null,
    retry: false,
  })
  const current = useQuery(read(scope.current.from, scope.current.to))
  const before = useQuery(read(scope.before.from, scope.before.to))
  return {
    isPending: current.isPending || before.isPending,
    isError: current.isError || before.isError,
    error: current.error ?? before.error,
    data:
      current.data && before.data
        ? { now: current.data, before: before.data }
        : undefined,
    refetch: () => {
      void current.refetch()
      void before.refetch()
    },
  }
}

/// KAS & SETARA KAS — cash on hand, petty cash, the cashier float, and the
/// banks. The retired 10110 family is what older screens still ask for.
const CASH_FAMILY = "1001"

export function useCash(scope: ReportScope) {
  return useQuery({
    queryKey: financeKeys.balances(CASH_FAMILY, scope.asOf),
    queryFn: ({ signal }) => balanceMatrix(CASH_FAMILY, scope.asOf, signal),
    retry: false,
  })
}

/// One unit's cash, or the company's. The columns are units (0605), so a
/// report narrowed to a shop asks for its unit — see `useScopeUnit`.
export function cashAt(
  matrix: {
    units: string[]
    column_totals: number[]
    grand_total_minor: number
  },
  unit: string | undefined
): number {
  if (unit === undefined) return matrix.grand_total_minor
  const index = matrix.units.indexOf(unit)
  return index === -1 ? 0 : (matrix.column_totals[index] ?? 0)
}
