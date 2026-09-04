import { node } from "@/lib/api"

/// Divisions, sizes and tags — the three lists nothing could edit.
///
/// All three have been controlled lists since `0022` and `0027`, for the reason
/// free text fails: a misspelt division does not error, it silently creates a
/// division of one and splits every report that groups by it. What none of them
/// had was a way in. Every term was a row somebody `INSERT`ed in a migration,
/// so adding a size meant shipping a release, and the app could only ever show
/// them as filter facets.
///
/// `0091` gave them the `version` column colours already had, and
/// `/api/v1/vocabulary/{kind}` gives all three the same three operations. One
/// endpoint for the three because they are one shape — code, label, order,
/// active — and one client, for the same reason.
///
/// These interfaces are transcribed from `cloud/postgres/vocabulary.rs` and are
/// replaced by the generated `@itulah/contract` types once those are exported
/// there. Until then this file is where the two can drift.

/// Which list. The path segment, and the only three values the server accepts.
export type VocabularyKind = "divisions" | "sizes" | "tags"

/// One term in one of the three lists.
export interface MasterTerm {
  readonly code: string
  readonly label: string
  /// The sequence pickers draw in, and the one the master screen edits. Not
  /// alphabetical: divisions are read in the order the business thinks — and
  /// sizes alphabetically would put L before M before S before XS.
  readonly display_order: number
  /// Still offered for new work. Retiring a term never unfiles what already
  /// points at it.
  readonly active: boolean
  /// Guards the edit. Renaming a term renames it on every article filed under
  /// it, so two people renaming one row in two tabs must not both succeed.
  readonly version: number
  /// Articles filed under it. What makes a "retire" control safe to offer at
  /// all: a term in use cannot be deleted, only deactivated.
  readonly in_use: number
}

export interface MasterVocabulary {
  readonly terms: readonly MasterTerm[]
}

export interface CreateTermRequest {
  readonly code: string
  readonly label: string
  readonly display_order?: number
}

export interface UpdateTermRequest {
  readonly label?: string
  readonly display_order?: number
  readonly active?: boolean
}

export const vocabularyKeys = {
  all: ["vocabulary"] as const,
  list: (kind: VocabularyKind) => ["vocabulary", kind] as const,
}

/// One whole list. Small enough to hold: a company has five divisions, a dozen
/// sizes and a few dozen tags, which is what lets the screen sort and filter
/// locally and answer while somebody is still typing.
export function listTerms(kind: VocabularyKind, signal?: AbortSignal) {
  return node.get<MasterVocabulary>(`/api/v1/vocabulary/${kind}`, { signal })
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

export function createTerm(
  kind: VocabularyKind,
  request: CreateTermRequest,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<MasterTerm>(`/api/v1/vocabulary/${kind}`, request, {
    signal,
    headers: guarded(idempotencyKey),
  })
}

/// The version is required, not optional. The handler reads `If-Match` before
/// anything else and refuses the request outright when it is missing, so a call
/// that omitted it would fail every time rather than merely losing a race.
export function updateTerm(
  kind: VocabularyKind,
  code: string,
  request: UpdateTermRequest,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.request<MasterTerm>(
    "PATCH",
    `/api/v1/vocabulary/${kind}/${encodeURIComponent(code)}`,
    request,
    { signal, headers: guarded(idempotencyKey, version) }
  )
}
