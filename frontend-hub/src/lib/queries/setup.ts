import { useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type {
  NewStore,
  OpenStoresAnswer,
  SaveSetupCompanyRequest,
  SetupBooks,
  SetupCompany,
  SetupStatus,
  StartBooksRequest,
  StoredFile,
} from "@itulah/contract"

export type {
  NewStore,
  SetupBooks,
  SetupCompany,
  SetupStatus,
  SetupStore,
  SetupTask,
} from "@itulah/contract"

/// Setup — the first minutes of a company that has nothing yet.
///
/// # What the wizard asks, and what it does not
///
/// Three questions: the company, its stores, and how the books start. Every
/// other fact a store needs before it trades — the team, the store servers,
/// QRIS and EDC, bank accounts, street addresses, the NPWP — is asked for when
/// it is needed, from the tasks on the home screen. Payment methods are not a
/// question at all: cash always works, and QRIS or debit only work once a
/// merchant id or a terminal exists for that store.
///
/// The server side is `backend/src/cloud/http/setup.rs`; the shapes are the
/// generated contract. The two narrower types below are this app's reading of
/// strings the wire leaves open.

export type LegalForm = "PT" | "CV" | "UD" | "PERORANGAN"

export type Timezone = "WIB" | "WITA" | "WIT"

/// The legal form the server holds, or none — a company that existed before
/// the wizard has not been asked.
export function legalFormOf(
  value: string | null | undefined
): LegalForm | null {
  return value === "PT" ||
    value === "CV" ||
    value === "UD" ||
    value === "PERORANGAN"
    ? value
    : null
}

/// The things still to do that this app has words for. A task id the server
/// adds later is not drawn until it does.
export type SetupTaskId =
  | "team"
  | "store_nodes"
  | "payments"
  | "store_addresses"
  | "bank_accounts"
  | "tax_id"
  | "opening_balances"

export const setupKeys = {
  all: ["setup"] as const,
  status: () => ["setup", "status"] as const,
}

export function setupStatus(signal?: AbortSignal): Promise<SetupStatus> {
  return node.get<SetupStatus>("/api/v1/setup", { signal })
}

export function useSetupStatus(enabled = true) {
  return useQuery({
    queryKey: setupKeys.status(),
    queryFn: ({ signal }) => setupStatus(signal),
    enabled,
    // A server without the endpoint answers 404, and that is an answer: the
    // app goes on without the wizard rather than retrying into a blank
    // screen.
    retry: false,
  })
}

/// Creates the head-office unit with its office site and, when asked, the
/// warehouse site and its pools. A PUT because pressing Back and changing the
/// name is the same question answered again, not a second company.
export function saveCompany(
  company: SaveSetupCompanyRequest
): Promise<SetupCompany> {
  return node.put<SetupCompany>("/api/v1/setup/company", company)
}

/// One store or thirty, in one transaction: per store a unit, a shop site,
/// its floor, back-room and reject pools, its return pool at the warehouse,
/// and a pairing code for its node. No accounts — the chart is per company
/// and a store is a dimension on the journal, so the store inherits every
/// account link scoped to all stores.
export function openStores(
  stores: readonly NewStore[],
  idempotencyKey: string
): Promise<OpenStoresAnswer> {
  return node.post<OpenStoresAnswer>(
    "/api/v1/setup/stores",
    { stores },
    { headers: { "Idempotency-Key": idempotencyKey } }
  )
}

/// Installs the chart (standard or imported) with its default account links,
/// and opens the first month.
export function startBooks(request: StartBooksRequest): Promise<SetupBooks> {
  return node.post<SetupBooks>("/api/v1/setup/books", request)
}

/// The old software's chart, uploaded before the books are started — the
/// same two-step upload the rest of the app uses (`cloud/http/files.rs`).
export function uploadChart(file: File): Promise<StoredFile> {
  const params = new URLSearchParams({ name: file.name })
  if (file.type !== "") params.set("type", file.type)
  return node.upload<StoredFile>(`/api/v1/files?${params.toString()}`, file)
}
