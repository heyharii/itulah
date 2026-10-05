import { useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type { BankRuleProposalRow, CashDocumentRow } from "@itulah/contract"

/// Reads and writes for the bank rule engine's proposals — the automatic
/// half of reconciliation ERPNext does not have. A rule recognises a
/// bank-only line ("BIAYA ADM" is always 6301) and proposes booking it; a
/// person still presses Accept, so nothing here posts on its own until they
/// do.
///
/// Kept apart from `lib/queries/finance.ts` rather than folded into it: that
/// file is the whole of Finance's wire already, and the bank reconciliation
/// screens are the only readers of this endpoint family. One small file for
/// one small family, rather than growing the shared one for a single caller.

function search(params: Readonly<Record<string, string | undefined>>): string {
  const parts = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue
    parts.set(key, value)
  }
  const text = parts.toString()
  return text === "" ? "" : `?${text}`
}

export const bankReconKeys = {
  proposals: (statementId: string | null) =>
    ["finance", "bank-proposals", statementId] as const,
}

/// Rule-made proposals still waiting for a person, for one statement.
///
/// `status` defaults to `PROPOSED`: `ACCEPTED` and `IGNORED` are history and
/// belong to the rule's own screen (`bank-rules`), not to a line still open
/// here.
export function listBankProposals(
  options: { statementId?: string; status?: string } = {},
  signal?: AbortSignal
): Promise<BankRuleProposalRow[]> {
  return node.get<BankRuleProposalRow[]>(
    `/api/v1/finance/bank-proposals${search({
      statement_id: options.statementId,
      status: options.status ?? "PROPOSED",
    })}`,
    { signal }
  )
}

/// A person agrees: the rule's guess becomes a posted BKM/BKK (or a plain
/// categorisation) and the bank line is reconciled against it in the same
/// breath — there is no separate "match" step for a line booked this way.
export function acceptBankProposal(
  proposalId: string,
  signal?: AbortSignal
): Promise<CashDocumentRow> {
  return node.post<CashDocumentRow>(
    `/api/v1/finance/bank-proposals/${encodeURIComponent(proposalId)}/accept`,
    {},
    { signal }
  )
}

/// A person says no. The proposal is kept, marked IGNORED, so the rule's own
/// screen can show that people keep refusing it — and the line goes back to
/// being an ordinary open line, matched or booked by hand.
export function ignoreBankProposal(
  proposalId: string,
  reason?: string,
  signal?: AbortSignal
): Promise<BankRuleProposalRow> {
  return node.post<BankRuleProposalRow>(
    `/api/v1/finance/bank-proposals/${encodeURIComponent(proposalId)}/ignore`,
    { reason: reason ?? null },
    { signal }
  )
}

/// Every rule-made proposal still open for one statement, keyed by the line
/// it names — so a row can ask "is there a one-click answer for me" without
/// scanning the whole list itself.
export function useBankProposals(statementId: string | null) {
  return useQuery({
    queryKey: bankReconKeys.proposals(statementId),
    queryFn: ({ signal }) =>
      listBankProposals({ statementId: statementId ?? undefined }, signal),
    enabled: statementId !== null,
  })
}
