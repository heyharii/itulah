import { queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type {
  AddGaContractCoverRequest,
  ApproveGaInsuranceClaimRequest,
  GaContractHub,
  GaContractRow,
  GaDisposalPage,
  GaInspectionPage,
  GaInsuranceClaimRow,
  GaMaintenanceTaskPage,
  GaOdometerReading,
  GaOperatingExpensePage,
  GaOperatingExpenseRow,
  GaOriginalHub,
  GaOriginalRow,
  GaPaper,
  GaRepairPage,
  GaReplacementPage,
  LinkGaClaimRepairRequest,
  PayGaInsuranceClaimRequest,
  RecordGaInsuranceClaimRequest,
  RecordGaOdometerReadingRequest,
  RecordGaOperatingExpenseRequest,
  RecordGaPaperRequest,
  RegisterGaOriginalRequest,
  RejectGaInsuranceClaimRequest,
  ReleaseGaOriginalRequest,
  RemoveGaContractCoverRequest,
  ReturnGaOriginalRequest,
  SubmitGaInsuranceClaimRequest,
  SurveyGaInsuranceClaimRequest,
} from "@itulah/contract"

/// GA's connected records (17 Oct 2026): everything filed against one asset,
/// the papers GA keeps with or without a scan, their physical originals and
/// handovers, the operating expenses GA records for Finance, and (0975) the
/// assets a contract covers, the claims under a policy and a car's odometer.
///
/// The wire types are the server's, from `@itulah/contract`; they are
/// re-exported here so the screens that read these records import them from
/// the module that reads them.
export type {
  GaCustodyEvent,
  GaContractCover,
  GaInsuranceClaimRow,
  GaOdometerReading,
  GaOperatingExpensePage,
  GaOperatingExpenseRow,
  GaOriginalHub,
  GaOriginalRow,
  GaPaper,
  GaPaperSubject,
  RecordGaOperatingExpenseRequest,
  RecordGaPaperRequest,
  RegisterGaOriginalRequest,
  ReleaseGaOriginalRequest,
  ReturnGaOriginalRequest,
} from "@itulah/contract"

/// The kinds an operating expense is filed under, in the order a form offers
/// them, with the word a screen shows. The server holds the same list and
/// refuses anything else; the account each resolves to is Finance's.
export const OPERATING_EXPENSE_KINDS = [
  { value: "FUEL", label: "Fuel" },
  { value: "OIL", label: "Oil & lubricant" },
  { value: "TYRES_PARTS", label: "Tyres & parts" },
  { value: "GENSET_FUEL", label: "Genset fuel" },
  { value: "COMPUTER", label: "Computer" },
  { value: "TOOLS", label: "Tools" },
  { value: "OTHER", label: "Other" },
] as const

export function expenseKindWord(kind: string): string {
  return (
    OPERATING_EXPENSE_KINDS.find((one) => one.value === kind)?.label ?? kind
  )
}

export const gaRecordKeys = {
  all: ["ga"] as const,
  /// Under the GA prefix, so every GA write that invalidates `["ga"]` also
  /// refreshes an asset's connected sections.
  assetRelated: (assetId: string, kind: string) =>
    ["ga", "asset-related", assetId, kind] as const,
  papers: (scope: { asset?: string; contract?: string; q?: string }) =>
    [
      "ga",
      "papers",
      scope.asset ?? null,
      scope.contract ?? null,
      scope.q ?? null,
    ] as const,
  paper: (documentId: string) => ["ga", "paper", documentId] as const,
  originals: (scope: { asset?: string; status?: string }) =>
    ["ga", "originals", scope.asset ?? null, scope.status ?? null] as const,
  original: (originalId: string) => ["ga", "original", originalId] as const,
  expenses: (scope: { asset?: string; site?: string }) =>
    [
      "ga",
      "operating-expenses",
      scope.asset ?? null,
      scope.site ?? null,
    ] as const,
  claims: (scope: { asset?: string; contract?: string }) =>
    ["ga", "claims", scope.asset ?? null, scope.contract ?? null] as const,
  claim: (claimId: string) => ["ga", "claim", claimId] as const,
  odometer: (assetId: string) => ["ga", "odometer", assetId] as const,
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

const id = (value: string) => encodeURIComponent(value)

// ── what one asset has filed against it ────────────────────────────────

/// The repairs, tasks, inspections, replacements and disposals of one asset,
/// each read from its own list with `asset=` (applied by the server before the
/// page and the totals).
export const assetRepairsQuery = (assetId: string) =>
  queryOptions({
    queryKey: gaRecordKeys.assetRelated(assetId, "repairs"),
    queryFn: ({ signal }) =>
      node.get<GaRepairPage>(
        `/api/v1/ga/repairs${search({ asset: assetId, limit: 100 })}`,
        { signal }
      ),
  })

export const assetTasksQuery = (assetId: string) =>
  queryOptions({
    queryKey: gaRecordKeys.assetRelated(assetId, "tasks"),
    queryFn: ({ signal }) =>
      node.get<GaMaintenanceTaskPage>(
        `/api/v1/ga/maintenance-tasks${search({ asset: assetId, limit: 100 })}`,
        { signal }
      ),
  })

export const assetInspectionsQuery = (assetId: string) =>
  queryOptions({
    queryKey: gaRecordKeys.assetRelated(assetId, "inspections"),
    queryFn: ({ signal }) =>
      node.get<GaInspectionPage>(
        `/api/v1/ga/inspections${search({ asset: assetId, limit: 100 })}`,
        { signal }
      ),
  })

export const assetReplacementsQuery = (assetId: string) =>
  queryOptions({
    queryKey: gaRecordKeys.assetRelated(assetId, "replacements"),
    queryFn: ({ signal }) =>
      node.get<GaReplacementPage>(
        `/api/v1/ga/replacements${search({ asset: assetId, limit: 100 })}`,
        { signal }
      ),
  })

export const assetDisposalsQuery = (assetId: string) =>
  queryOptions({
    queryKey: gaRecordKeys.assetRelated(assetId, "disposals"),
    queryFn: ({ signal }) =>
      node.get<GaDisposalPage>(
        `/api/v1/ga/disposals${search({ asset: assetId, limit: 100 })}`,
        { signal }
      ),
  })

/// The contracts that name the asset (insurance, STNK, its maintenance).
/// Direct links only; a contract for the asset's whole site is not shown as
/// covering it.
export const assetContractsQuery = (assetId: string) =>
  queryOptions({
    queryKey: gaRecordKeys.assetRelated(assetId, "contracts"),
    queryFn: ({ signal }) =>
      node.get<GaContractRow[]>(`/api/v1/ga/assets/${id(assetId)}/contracts`, {
        signal,
      }),
  })

// ── papers and originals ───────────────────────────────────────────────

export const papersQuery = (scope: {
  asset?: string
  contract?: string
  q?: string
}) =>
  queryOptions({
    queryKey: gaRecordKeys.papers(scope),
    queryFn: ({ signal }) =>
      node.get<GaPaper[]>(`/api/v1/ga/papers${search(scope)}`, { signal }),
  })

export const paperQuery = (documentId: string) =>
  queryOptions({
    queryKey: gaRecordKeys.paper(documentId),
    queryFn: ({ signal }) =>
      node.get<GaPaper>(`/api/v1/ga/papers/${id(documentId)}`, { signal }),
  })

export const originalsQuery = (scope: { asset?: string; status?: string }) =>
  queryOptions({
    queryKey: gaRecordKeys.originals(scope),
    queryFn: ({ signal }) =>
      node.get<GaOriginalRow[]>(`/api/v1/ga/originals${search(scope)}`, {
        signal,
      }),
  })

export const originalQuery = (originalId: string) =>
  queryOptions({
    queryKey: gaRecordKeys.original(originalId),
    queryFn: ({ signal }) =>
      node.get<GaOriginalHub>(`/api/v1/ga/originals/${id(originalId)}`, {
        signal,
      }),
  })

export function recordPaper(request: RecordGaPaperRequest): Promise<GaPaper> {
  return node.post<GaPaper>("/api/v1/ga/papers", request)
}

export function attachScan(
  documentId: string,
  fileId: string
): Promise<GaPaper> {
  return node.post<GaPaper>(`/api/v1/ga/papers/${id(documentId)}/scan`, {
    file_id: fileId,
  })
}

export function registerOriginal(
  documentId: string,
  request: RegisterGaOriginalRequest
): Promise<GaOriginalHub> {
  return node.post<GaOriginalHub>(
    `/api/v1/ga/papers/${id(documentId)}/originals`,
    request
  )
}

export function releaseOriginal(
  originalId: string,
  request: ReleaseGaOriginalRequest
): Promise<GaOriginalHub> {
  return node.post<GaOriginalHub>(
    `/api/v1/ga/originals/${id(originalId)}/release`,
    request
  )
}

export function returnOriginal(
  originalId: string,
  request: ReturnGaOriginalRequest
): Promise<GaOriginalHub> {
  return node.post<GaOriginalHub>(
    `/api/v1/ga/originals/${id(originalId)}/return`,
    request
  )
}

// ── operating expenses ─────────────────────────────────────────────────

export const operatingExpensesQuery = (scope: {
  asset?: string
  site?: string
}) =>
  queryOptions({
    queryKey: gaRecordKeys.expenses(scope),
    queryFn: ({ signal }) =>
      node.get<GaOperatingExpensePage>(
        `/api/v1/ga/operating-expenses${search({ ...scope, limit: 200 })}`,
        { signal }
      ),
  })

export function recordOperatingExpense(
  request: RecordGaOperatingExpenseRequest
): Promise<GaOperatingExpenseRow> {
  return node.post<GaOperatingExpenseRow>(
    "/api/v1/ga/operating-expenses",
    request
  )
}

/// Hand the expense to Finance as a DRAFT bill (the same writer every GA bill
/// request uses). Refused once it is with Finance.
export function submitOperatingExpense(
  expenseId: string,
  request: {
    invoice_number?: string | null
    due_date?: string | null
    /// For an expense recorded without a seller; kept on the expense.
    supplier_id?: string | null
  } = {}
): Promise<GaOperatingExpenseRow> {
  return node.post<GaOperatingExpenseRow>(
    `/api/v1/ga/operating-expenses/${id(expenseId)}/submit`,
    request
  )
}

/// Point the expense at the bill or BKK Finance already made, instead of a
/// second draft. Exactly one of the two.
export function linkOperatingExpense(
  expenseId: string,
  request: { invoice_id?: string | null; cash_document_id?: string | null }
): Promise<GaOperatingExpenseRow> {
  return node.post<GaOperatingExpenseRow>(
    `/api/v1/ga/operating-expenses/${id(expenseId)}/link`,
    request
  )
}

export function cancelOperatingExpense(
  expenseId: string,
  reason: string
): Promise<GaOperatingExpenseRow> {
  return node.post<GaOperatingExpenseRow>(
    `/api/v1/ga/operating-expenses/${id(expenseId)}/cancel`,
    { reason }
  )
}

// ── the assets a contract covers (0975) ────────────────────────────────

/// Put one more asset on a contract's roster, from a day. Answers with the
/// contract's hub, roster included.
export function addContractCover(
  contractId: string,
  request: AddGaContractCoverRequest
): Promise<GaContractHub> {
  return node.post<GaContractHub>(
    `/api/v1/ga/contracts/${id(contractId)}/assets`,
    request
  )
}

/// Take an asset off the roster. Its stay is kept, closed on the day given.
export function removeContractCover(
  contractId: string,
  assetId: string,
  request: RemoveGaContractCoverRequest = {}
): Promise<GaContractHub> {
  return node.post<GaContractHub>(
    `/api/v1/ga/contracts/${id(contractId)}/assets/${id(assetId)}/remove`,
    request
  )
}

// ── insurance claims (0975) ────────────────────────────────────────────

/// The claims about one asset, or under one policy, the latest damage first.
export const claimsQuery = (scope: { asset?: string; contract?: string }) =>
  queryOptions({
    queryKey: gaRecordKeys.claims(scope),
    queryFn: ({ signal }) =>
      node.get<GaInsuranceClaimRow[]>(
        `/api/v1/ga/claims${search({ ...scope, limit: 200 })}`,
        { signal }
      ),
  })

export const claimQuery = (claimId: string) =>
  queryOptions({
    queryKey: gaRecordKeys.claim(claimId),
    queryFn: ({ signal }) =>
      node.get<GaInsuranceClaimRow>(`/api/v1/ga/claims/${id(claimId)}`, {
        signal,
      }),
  })

export function recordClaim(
  request: RecordGaInsuranceClaimRequest
): Promise<GaInsuranceClaimRow> {
  return node.post<GaInsuranceClaimRow>("/api/v1/ga/claims", request)
}

export function submitClaim(
  claimId: string,
  request: SubmitGaInsuranceClaimRequest
): Promise<GaInsuranceClaimRow> {
  return node.post<GaInsuranceClaimRow>(
    `/api/v1/ga/claims/${id(claimId)}/submit`,
    request
  )
}

export function surveyClaim(
  claimId: string,
  request: SurveyGaInsuranceClaimRequest
): Promise<GaInsuranceClaimRow> {
  return node.post<GaInsuranceClaimRow>(
    `/api/v1/ga/claims/${id(claimId)}/survey`,
    request
  )
}

/// The insurer's approval: what it pays, what we pay, and the repair it pays
/// for — named, or opened at the insurer's workshop in the same write.
export function approveClaim(
  claimId: string,
  request: ApproveGaInsuranceClaimRequest
): Promise<GaInsuranceClaimRow> {
  return node.post<GaInsuranceClaimRow>(
    `/api/v1/ga/claims/${id(claimId)}/approve`,
    request
  )
}

export function rejectClaim(
  claimId: string,
  request: RejectGaInsuranceClaimRequest
): Promise<GaInsuranceClaimRow> {
  return node.post<GaInsuranceClaimRow>(
    `/api/v1/ga/claims/${id(claimId)}/reject`,
    request
  )
}

export function payClaim(
  claimId: string,
  request: PayGaInsuranceClaimRequest
): Promise<GaInsuranceClaimRow> {
  return node.post<GaInsuranceClaimRow>(
    `/api/v1/ga/claims/${id(claimId)}/pay`,
    request
  )
}

export function linkClaimRepair(
  claimId: string,
  request: LinkGaClaimRepairRequest
): Promise<GaInsuranceClaimRow> {
  return node.post<GaInsuranceClaimRow>(
    `/api/v1/ga/claims/${id(claimId)}/repair`,
    request
  )
}

// ── odometer readings (0975) ───────────────────────────────────────────

/// A vehicle's readings, newest first: typed, from a receipt, or read at a
/// service.
export const odometerQuery = (assetId: string) =>
  queryOptions({
    queryKey: gaRecordKeys.odometer(assetId),
    queryFn: ({ signal }) =>
      node.get<GaOdometerReading[]>(
        `/api/v1/ga/assets/${id(assetId)}/odometer`,
        { signal }
      ),
  })

export function recordOdometer(
  assetId: string,
  request: RecordGaOdometerReadingRequest
): Promise<GaOdometerReading[]> {
  return node.post<GaOdometerReading[]>(
    `/api/v1/ga/assets/${id(assetId)}/odometer`,
    request
  )
}

/// Remove a reading typed by mistake. One that came with a receipt goes with
/// the receipt instead.
export function removeOdometer(
  readingId: string
): Promise<GaOdometerReading[]> {
  return node.delete<GaOdometerReading[]>(
    `/api/v1/ga/odometer-readings/${id(readingId)}`
  )
}
