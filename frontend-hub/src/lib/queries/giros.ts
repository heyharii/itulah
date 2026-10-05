import { node } from "@/lib/api"

import type {
  CashDocumentRow,
  GiroRow,
  ReplaceGiroRequest,
  UnclearGiroRequest,
} from "@itulah/contract"

/// The Giro Board's own writes — everything past `listGiros` and `clearGiro`,
/// which already live in `finance.ts` and are reused as they are. Kept apart
/// so the board does not grow the file `cash-documents.tsx` is being built
/// against at the same time.
///
/// No `idempotencyKey`: `clearGiro` sends none either, and a giro action is
/// guarded the way that one is — the button that started it is disabled for
/// as long as it is pending.

/// Handed to the supplier, or to whoever gave it to us. Nothing posts.
export function deliverGiro(
  giroId: string,
  signal?: AbortSignal
): Promise<GiroRow> {
  return node.post<GiroRow>(
    `/api/v1/finance/giros/${encodeURIComponent(giroId)}/deliver`,
    {},
    { signal }
  )
}

/// The date on its face has arrived and the bank has not taken it yet. Also
/// no posting — see `domain::giro` for why DUE exists at all.
export function markGiroDue(
  giroId: string,
  signal?: AbortSignal
): Promise<GiroRow> {
  return node.post<GiroRow>(
    `/api/v1/finance/giros/${encodeURIComponent(giroId)}/due`,
    {},
    { signal }
  )
}

/// It bounced, or we stopped it before the bank could take it. Reverses the
/// issue and reopens whatever the giro was written to settle — valid from any
/// state the bank has not yet taken it in, and also from CLEARED (a bounce
/// discovered after the statement already showed it cleared).
export function rejectGiro(
  giroId: string,
  on: string,
  reason: string,
  signal?: AbortSignal
): Promise<GiroRow> {
  return node.post<GiroRow>(
    `/api/v1/finance/giros/${encodeURIComponent(giroId)}/reject`,
    { on, statement_line_id: null, reason },
    { signal }
  )
}

/// Batal Cair: the clearing was wrong and is taken back into an open month.
/// Only from CLEARED.
export function unclearGiro(
  giroId: string,
  request: UnclearGiroRequest,
  signal?: AbortSignal
): Promise<GiroRow> {
  return node.post<GiroRow>(
    `/api/v1/finance/giros/${encodeURIComponent(giroId)}/unclear`,
    request,
    { signal }
  )
}

/// Say which later payment or cash document settled what a bounced giro did
/// not. Only from REJECTED, and only once.
export function replaceGiro(
  giroId: string,
  request: ReplaceGiroRequest,
  signal?: AbortSignal
): Promise<GiroRow> {
  return node.post<GiroRow>(
    `/api/v1/finance/giros/${encodeURIComponent(giroId)}/replace`,
    request,
    { signal }
  )
}

/// Posted cash documents a bounced giro's replacement might be — narrowed to
/// its own direction (`PAY` for one we wrote, `RECEIVE` for one we were
/// given), which is what the server itself insists a replacement match.
///
/// A read of its own rather than a reach into `cash-documents.tsx`, which is
/// still a stub as this is written: the picker needs a handful of candidates,
/// not that screen's register.
export function candidateCashDocuments(
  options: { kind: "PAY" | "RECEIVE"; unitId?: string; limit?: number },
  signal?: AbortSignal
): Promise<CashDocumentRow[]> {
  const params = new URLSearchParams({
    status: "POSTED",
    kind: options.kind,
    limit: String(options.limit ?? 100),
  })
  if (options.unitId) params.set("unit_id", options.unitId)
  return node.get<CashDocumentRow[]>(
    `/api/v1/finance/cash-documents?${params.toString()}`,
    { signal }
  )
}
