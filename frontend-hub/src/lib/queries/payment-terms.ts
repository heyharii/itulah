import type {
  CreatePaymentTermRequest,
  CreatePaymentTermsTemplateRequest,
  PaymentTermRow,
  PaymentTermsTemplateRow,
  UpdatePaymentTermRequest,
  UpdatePaymentTermsTemplateRequest,
} from "@itulah/contract"

import { node } from "@/lib/api"
import { paymentTermsBook, procurementKeys } from "@/lib/queries/procurement"

/// The payment terms master: the writes.
///
/// The read is Procurement's — `paymentTermsBook` under
/// `procurementKeys.paymentTerms()` — and is re-exported here rather than
/// copied, so the master screen and every picker that still reads the book
/// hold ONE cache entry. A template renamed here that read the old way on the
/// order sheet would be two answers to one question.
///
/// Terms and templates are retired, never deleted, so there is no delete here.
export { paymentTermsBook }

export const paymentTermsKeys = {
  book: procurementKeys.paymentTerms,
}

function guarded(
  idempotencyKey: string,
  version?: number
): Record<string, string> {
  const headers: Record<string, string> = {
    "Idempotency-Key": idempotencyKey,
  }
  if (version !== undefined) headers["If-Match"] = `"${version}"`
  return headers
}

export function createPaymentTerm(
  request: CreatePaymentTermRequest,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<PaymentTermRow>("/api/v1/payment-terms/terms", request, {
    signal,
    headers: guarded(idempotencyKey),
  })
}

/// Rename, re-time, reorder, retire (`active: false`) or reactivate a term.
/// The version is required: the handler refuses a PATCH with no `If-Match`.
export function updatePaymentTerm(
  code: string,
  request: UpdatePaymentTermRequest,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.request<PaymentTermRow>(
    "PATCH",
    `/api/v1/payment-terms/terms/${encodeURIComponent(code)}`,
    request,
    { signal, headers: guarded(idempotencyKey, version) }
  )
}

/// A template and its instalments, in one transaction. The instalments must
/// add up to 10000 basis points — the server refuses anything else with a 409.
export function createPaymentTermsTemplate(
  request: CreatePaymentTermsTemplateRequest,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<PaymentTermsTemplateRow>(
    "/api/v1/payment-terms/templates",
    request,
    { signal, headers: guarded(idempotencyKey) }
  )
}

/// Rename, reorder, retire or reactivate a template; `lines`, when given,
/// replaces the instalments whole.
export function updatePaymentTermsTemplate(
  code: string,
  request: UpdatePaymentTermsTemplateRequest,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.request<PaymentTermsTemplateRow>(
    "PATCH",
    `/api/v1/payment-terms/templates/${encodeURIComponent(code)}`,
    request,
    { signal, headers: guarded(idempotencyKey, version) }
  )
}
