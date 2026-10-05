import { node } from "@/lib/api"
import type {
  CashDocumentRepeat,
  CashDocumentRepeatSweep,
  ExpensesByMonth,
  SaveCashDocumentRepeatRequest,
  WithholdingRow,
} from "@itulah/contract"

/// Reads and writes for three small Finance families that arrived together: the
/// Tax Withholding Details report, Expenses by month, and the repeating
/// BKK/BKM.
///
/// Kept apart from `lib/queries/finance.ts` for the reason `bank-recon.ts` is:
/// that file is the whole of Finance's wire already, and each of these has one
/// or two screens reading it.

function search(params: Readonly<Record<string, string | undefined>>): string {
  const parts = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue
    parts.set(key, value)
  }
  const text = parts.toString()
  return text === "" ? "" : `?${text}`
}

export const financeReportKeys = {
  withholding: (
    from: string,
    to: string,
    unit: string | null,
    template: string | null
  ) => ["finance", "withholding-report", from, to, unit, template] as const,
  expensesByMonth: (from: string, to: string, unit: string | null) =>
    ["finance", "expenses-by-month", from, to, unit] as const,
  cashRepeats: (direction: "OUT" | "IN") =>
    ["finance", "cash-document-repeats", direction] as const,
  /// Every direction at once, for invalidation after a save or a sweep.
  cashRepeatsAll: () => ["finance", "cash-document-repeats"] as const,
}

/// What was kept back from suppliers in the window, payment by payment
/// (ERPNext's Tax Withholding Details). `unit` and `template` are left off the
/// wire when empty: absent means every unit, every template.
export function withholdingReport(
  params: { from: string; to: string; unit?: string; template?: string },
  signal?: AbortSignal
): Promise<WithholdingRow[]> {
  return node.get<WithholdingRow[]>(
    `/api/v1/finance/reports/withholding${search({
      from: params.from,
      to: params.to,
      unit: params.unit,
      template: params.template,
    })}`,
    { signal }
  )
}

/// Every expense account with a movement in the window, month by month. The
/// server refuses a window of more than 24 months.
export function expensesByMonth(
  params: { from: string; to: string; unit?: string },
  signal?: AbortSignal
): Promise<ExpensesByMonth> {
  return node.get<ExpensesByMonth>(
    `/api/v1/finance/reports/expenses-by-month${search({
      from: params.from,
      to: params.to,
      unit: params.unit,
    })}`,
    { signal }
  )
}

/// The standing BKK (`OUT`) or BKM (`IN`) schedules.
export function listCashDocumentRepeats(
  direction: "OUT" | "IN",
  signal?: AbortSignal
): Promise<CashDocumentRepeat[]> {
  return node.get<CashDocumentRepeat[]>(
    `/api/v1/finance/cash-document-repeats${search({ direction })}`,
    { signal }
  )
}

/// Create a schedule (no `repeat_id`) or change one (with it). Answers with
/// the schedule as saved.
export function saveCashDocumentRepeat(
  request: SaveCashDocumentRepeatRequest
): Promise<CashDocumentRepeat> {
  return node.post<CashDocumentRepeat>(
    "/api/v1/finance/cash-document-repeats",
    request
  )
}

/// Raise every schedule that is due, now, rather than waiting for the nightly
/// sweep. What it makes are DRAFT vouchers: a person still approves and posts
/// them.
export function runCashDocumentRepeats(): Promise<CashDocumentRepeatSweep> {
  return node.post<CashDocumentRepeatSweep>(
    "/api/v1/finance/cash-document-repeats/run",
    {}
  )
}
