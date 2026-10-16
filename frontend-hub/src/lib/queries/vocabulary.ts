import { queryOptions } from "@tanstack/react-query"

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
  /// Articles filed under it. One of the several things that can name a term,
  /// and the one worth a column: it is what a merchandiser is deciding about.
  readonly in_use: number
  /// Whether anything has EVER named it — not whether anything does now.
  /// Stamped by the triggers in migration `0167` and never cleared. A term
  /// that has ever meant something may only be retired; see `TermUsage`.
  readonly ever_used: boolean
}

/// One place a term can be spoken for, and how loudly.
export interface MasterReference {
  readonly key: string
  readonly label: string
  readonly count: number
}

/// Everything that speaks for one term, and what may therefore be done to it.
///
/// Read before the sheet decides which buttons to draw, and computed by the
/// same function the DELETE enforces — so a Delete button is never offered for
/// something the server will refuse.
///
/// **`in_use` is not this question.** Articles are one of five tables that can
/// name a tag, and a promotion can select on one from inside a jsonb rule
/// document with no foreign key at all. "Articles: 0" has never been a licence
/// to delete.
export interface TermUsage {
  readonly code: string
  /// Every place, including the ones counting zero.
  readonly references: readonly MasterReference[]
  readonly total: number
  readonly ever_used: boolean
  readonly can_delete: boolean
  /// Why not, in a sentence somebody can act on. Null when it can.
  readonly blocked: string | null
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
  usage: (kind: VocabularyKind, code: string) =>
    ["vocabulary", kind, code, "usage"] as const,
}

/// One whole list. Small enough to hold: a company has five divisions, a dozen
/// sizes and a few dozen tags, which is what lets the screen sort and filter
/// locally and answer while somebody is still typing.
export function listTerms(kind: VocabularyKind, signal?: AbortSignal) {
  return node.get<MasterVocabulary>(`/api/v1/vocabulary/${kind}`, { signal })
}

/// The one whole list as a query: the vocabulary screens read it and the
/// prefetcher (`screens/master/prefetch.ts`) asks for it, with these options.
export const termsQuery = (kind: VocabularyKind) =>
  queryOptions({
    queryKey: vocabularyKeys.list(kind),
    queryFn: ({ signal }) => listTerms(kind, signal),
  })

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

/// What speaks for one term, and whether it may be deleted.
///
/// Asked when the sheet opens rather than carried on every row: it is three to
/// six counting queries, and the list is forty rows nobody is asking this of.
export function termUsage(
  kind: VocabularyKind,
  code: string,
  signal?: AbortSignal
) {
  return node.get<TermUsage>(
    `/api/v1/vocabulary/${kind}/${encodeURIComponent(code)}/usage`,
    { signal }
  )
}

/// Remove a term that has never meant anything.
///
/// The version is required for the same reason it is on a rename: the row the
/// caller saw is the row being deleted, and a term used between the screen
/// drawing its button and the click arriving must not vanish underneath the
/// article that just took it. The server re-runs the whole sweep regardless;
/// this call can be refused, and the refusal is a sentence worth showing.
export function deleteTerm(
  kind: VocabularyKind,
  code: string,
  version: number,
  signal?: AbortSignal
) {
  return node.request<void>(
    "DELETE",
    `/api/v1/vocabulary/${kind}/${encodeURIComponent(code)}`,
    undefined,
    { signal, headers: { "If-Match": `"${version}"` } }
  )
}
