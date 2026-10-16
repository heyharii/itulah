import { queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"
import { financeKeys } from "@/lib/queries/finance"
import type {
  CashDocumentRow,
  CashDocumentSlip,
  CashSide,
  RecordVoucherRequest,
  VoucherLineRequest,
} from "@itulah/contract"

/// The client's cash vouchers — Bukti Kas Keluar / Bukti Kas Masuk — kept
/// apart from `finance.ts` rather than added to it: that file is already past
/// two thousand lines, and this module owns the one thing the Klasik form
/// needs that no other screen does — `CashDocumentDraft` and
/// `buildVoucherRequest`, the single place the form's state becomes a
/// `RecordVoucherRequest` (`POST /cash-documents/voucher`, 0711): the Settle
/// tab's bills, the Other lines, the advances netted off on the Offset tab,
/// how it was paid and the giro.

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/// Nested under `financeKeys.all` (`["finance"]`) on purpose and not a fresh
/// prefix of its own: posting or reversing a cash document moves the journal,
/// every balance and both statements, exactly like posting a payment does, so
/// the same broad `invalidateQueries({ queryKey: financeKeys.all })` a screen
/// already reaches for after a post has to catch this module too.
export const cashDocumentKeys = {
  list: (status: string | null, kind: string | null, unit: string | null) =>
    [...financeKeys.all, "cash-documents", status, kind, unit] as const,
  detail: (id: string) =>
    [...financeKeys.all, "cash-documents", "detail", id] as const,
  slip: (id: string) =>
    [...financeKeys.all, "cash-documents", "slip", id] as const,
}

function search(
  params: Readonly<Record<string, string | number | undefined | null>>
): string {
  const parts = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    parts.set(key, String(value))
  }
  const text = parts.toString()
  return text === "" ? "" : `?${text}`
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function listCashDocuments(
  options: {
    status?: string
    /// `PAY` (BKK), `RECEIVE` (BKM) or `TRANSFER`.
    kind?: string
    /// Either side: a unit's screen wants what touched its own books,
    /// whichever way the money went — the server narrows this way too.
    unit?: string
    limit?: number
  } = {},
  signal?: AbortSignal
): Promise<CashDocumentRow[]> {
  return node.get<CashDocumentRow[]>(
    `/api/v1/finance/cash-documents${search(options)}`,
    { signal }
  )
}

/// The register of BKK (`PAY`) or BKM (`RECEIVE`) documents, narrowed on the
/// server by status and unit.
export const cashDocumentsQuery = (
  kind: "PAY" | "RECEIVE",
  status = "",
  unit = ""
) =>
  queryOptions({
    queryKey: cashDocumentKeys.list(status || null, kind, unit || null),
    queryFn: ({ signal }) =>
      listCashDocuments(
        {
          status: status || undefined,
          kind,
          unit: unit || undefined,
          limit: 300,
        },
        signal
      ),
  })

export function cashDocument(
  id: string,
  signal?: AbortSignal
): Promise<CashDocumentRow> {
  return node.get<CashDocumentRow>(
    `/api/v1/finance/cash-documents/${encodeURIComponent(id)}`,
    { signal }
  )
}

/// Everything printed on the slip — title, both account names, the amount in
/// words — assembled on the server so the screen never re-derives any of it.
export function cashDocumentSlip(
  id: string,
  signal?: AbortSignal
): Promise<CashDocumentSlip> {
  return node.get<CashDocumentSlip>(
    `/api/v1/finance/cash-documents/${encodeURIComponent(id)}/slip`,
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/// Key a BKK or BKM with its lines. Nothing is numbered and nothing is in the
/// books yet — see `approveCashDocument` and `postCashDocument`.
export function recordVoucher(
  request: RecordVoucherRequest,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<CashDocumentRow> {
  return node.post<CashDocumentRow>(
    "/api/v1/finance/cash-documents/voucher",
    request,
    { signal, headers: { "Idempotency-Key": idempotencyKey } }
  )
}

/// A supplier's advances with money still in them — what the Offset tab of a
/// BKK can net off against the bills it settles.
export interface OpenAdvance {
  readonly advance_id: string
  readonly advance_number: string
  readonly supplier_id: string
  readonly po_number: string
  readonly advance_date: string
  readonly amount_minor: number
  readonly outstanding_minor: number
  readonly reference: string | null
  readonly status: string
}

export function openAdvances(
  supplierId: string,
  signal?: AbortSignal
): Promise<OpenAdvance[]> {
  return node.get<OpenAdvance[]>(
    `/api/v1/finance/supplier-advances?supplier=${encodeURIComponent(supplierId)}`,
    { signal }
  )
}

/// Approve it. This is where the number — `KK-26-09-00001` — is taken.
export function approveCashDocument(
  id: string,
  signal?: AbortSignal
): Promise<CashDocumentRow> {
  return node.post<CashDocumentRow>(
    `/api/v1/finance/cash-documents/${encodeURIComponent(id)}/approve`,
    {},
    { signal }
  )
}

/// Put an approved document into the books. With no date the server posts it
/// on the document's own date.
export function postCashDocument(
  id: string,
  postingDate?: string,
  signal?: AbortSignal
): Promise<CashDocumentRow> {
  return node.post<CashDocumentRow>(
    `/api/v1/finance/cash-documents/${encodeURIComponent(id)}/post`,
    { posting_date: postingDate },
    { signal }
  )
}

/// Undo a posted document by writing its mirror. The original stays exactly
/// as posted; the reason is the only record of why.
export function reverseCashDocument(
  id: string,
  reason: string,
  postingDate?: string,
  signal?: AbortSignal
): Promise<CashDocumentRow> {
  return node.post<CashDocumentRow>(
    `/api/v1/finance/cash-documents/${encodeURIComponent(id)}/reverse`,
    { reason, posting_date: postingDate },
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Reading a kind and a status
// ---------------------------------------------------------------------------

/// `PAY` → "BKK", `RECEIVE` → "BKM", `TRANSFER` → "Transfer". The client's own
/// names, kept as names (owner, 2026-09) rather than translated.
export function kindWord(kind: string): string {
  switch (kind) {
    case "PAY":
      return "BKK"
    case "RECEIVE":
      return "BKM"
    case "TRANSFER":
      return "Transfer"
    default:
      return kind
  }
}

/// The direction a fresh document is being composed in. Chosen at the top of
/// the form; everything else — which side is the cash/bank account, which
/// label the party gets — follows from it. `TRANSFER` is not offered here: it
/// is what the server calls a document whose OTHER side also turns out to
/// hold money, which this composer's own account picker never offers, so a
/// document built here is always `PAY` or `RECEIVE`.
export type ComposeKind = "BKK" | "BKM"

// ---------------------------------------------------------------------------
// The draft the form holds, and the one function that narrows it to the wire
// ---------------------------------------------------------------------------

/// One row under "Other lines": an account from the chart, with its category
/// when the account is kept by kind.
export interface CashDocumentOtherLine {
  readonly accountCode: string
  readonly categoryCode: string | null
  readonly note: string
  readonly amountMinor: number | null
}

/// One ticked bill on the Settle tab.
export interface CashDocumentSettleLine {
  readonly invoiceId: string
  readonly discountMinor: number | null
  readonly amountMinor: number | null
}

/// One ticked advance on the Offset tab.
export interface CashDocumentOffsetLine {
  readonly advanceId: string
  readonly amountMinor: number | null
}

export interface CashDocumentGiroDraft {
  readonly number: string
  readonly drawnOn: string
  readonly dueDate: string
}

/// Everything the Klasik form collects.
export interface CashDocumentDraft {
  readonly kind: ComposeKind
  readonly docDate: string
  readonly unitId: string
  readonly partyType: "SUPPLIER" | "EMPLOYEE" | "OTHER"
  readonly supplierId: string | null
  readonly employeeId: string | null
  readonly partyName: string
  /// The cash/bank side: a meaning (`bank_giro`, `cash`, …) and which one.
  readonly moneyKey: string
  readonly moneyQualifier: string
  readonly method: "cash" | "transfer" | "giro"
  readonly giro: CashDocumentGiroDraft
  readonly reference: string
  readonly otherLines: readonly CashDocumentOtherLine[]
  readonly settleLines: readonly CashDocumentSettleLine[]
  readonly offsetLines: readonly CashDocumentOffsetLine[]
  readonly memo: string
}

/// The request for a draft: every ticked bill, every Other line with an
/// account and an amount, every advance netted off. Rows left blank are
/// dropped rather than sent; the server refuses what is left if it adds up to
/// nothing.
export function buildVoucherRequest(
  draft: CashDocumentDraft
): RecordVoucherRequest {
  const lines: VoucherLineRequest[] = []
  for (const line of draft.settleLines) {
    if (line.amountMinor === null || line.amountMinor <= 0) continue
    lines.push({
      kind: "SETTLE",
      invoice_id: line.invoiceId,
      amount_minor: line.amountMinor,
      discount_minor: line.discountMinor ?? 0,
    })
  }
  for (const line of draft.otherLines) {
    if (
      line.accountCode === "" ||
      line.amountMinor === null ||
      line.amountMinor <= 0
    )
      continue
    const account: CashSide = {
      semantic_key: null,
      qualifier: "",
      account_code: line.accountCode,
      category_code: line.categoryCode,
      unit_id: draft.unitId,
    }
    lines.push({
      kind: "OTHER",
      account,
      amount_minor: line.amountMinor,
      note: line.note.trim() === "" ? null : line.note.trim(),
    })
  }
  for (const line of draft.offsetLines) {
    if (line.amountMinor === null || line.amountMinor <= 0) continue
    lines.push({
      kind: "OFFSET",
      advance_id: line.advanceId,
      amount_minor: line.amountMinor,
    })
  }
  const giro = draft.method === "giro"
  return {
    doc_date: draft.docDate,
    direction: draft.kind === "BKK" ? "OUT" : "IN",
    money: {
      semantic_key: draft.moneyKey,
      qualifier: draft.moneyQualifier,
      account_code: null,
      category_code: null,
      unit_id: draft.unitId,
    },
    method: draft.method.toUpperCase(),
    reference: draft.reference.trim() === "" ? null : draft.reference.trim(),
    giro_number: giro ? draft.giro.number.trim() : null,
    giro_due_date: giro ? draft.giro.dueDate : null,
    giro_bank: giro && draft.kind === "BKM" ? draft.giro.drawnOn.trim() : null,
    party_type: draft.partyType,
    supplier_id: draft.partyType === "SUPPLIER" ? draft.supplierId : null,
    employee_id: draft.partyType === "EMPLOYEE" ? draft.employeeId : null,
    party_name: draft.partyName.trim(),
    memo: draft.memo.trim(),
    lines,
  }
}
