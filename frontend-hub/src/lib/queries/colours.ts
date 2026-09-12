import { node } from "@/lib/api"
import type { TermUsage } from "@/lib/queries/vocabulary"

/// The colour master, and the reason it exists.
///
/// Colour used to be free text written per article. It was unique only *within*
/// one article, so the catalogue could hold "Navy", "navy" and "Biru Navy" as
/// three unrelated things, and every report that grouped by colour silently
/// split three ways. That is the same failure the `tag` table was created to
/// prevent, arriving by the same route: a free-text label does not fail when it
/// is misspelt.
///
/// So colours are a company-wide list now and are PICKED, never typed. An
/// article maps at most ten of them onto its ten SKU digits — ten being a
/// permanent ceiling, since the colour is one character of an eleven-digit SKU.
///
/// These interfaces are transcribed from `cloud/postgres/colours.rs` and are
/// replaced by the generated `@itulah/contract` types once `make contract` has
/// run. Until then this file is where the two can drift.

/// One colour in the master list.
export interface ColourTerm {
  readonly code: string
  readonly label: string
  /// For the swatch. Optional: a colour can be named before anybody has
  /// decided which pixel value stands for it, and a wrong swatch is worse than
  /// no swatch.
  readonly hex_code: string | null
  /// The sequence the picker draws in, and the one this screen edits. Not
  /// alphabetical: a merchandiser thinks neutrals first, then the season.
  readonly display_order: number
  /// Still offered when somebody maps a colourway. Retiring a colour never
  /// removes it from the articles already wearing it.
  readonly active: boolean
  /// Guards the edit. Renaming a colour renames it on every article wearing
  /// it, so two people renaming one row in two tabs must not both succeed.
  readonly version: number
  /// How many articles currently wear it.
  readonly in_use: number
  /// Whether anything has EVER worn it — not whether anything does now.
  /// Stamped by the triggers in migration `0167` and never cleared: a colour
  /// that reached a garment is on a printed label somewhere, so it may only be
  /// retired. See `TermUsage` in `queries/vocabulary`.
  readonly ever_used: boolean
}

export interface ColourVocabulary {
  readonly colours: readonly ColourTerm[]
}

export interface CreateColourRequest {
  readonly code: string
  readonly label: string
  readonly hex_code?: string | null
  readonly display_order?: number
}

export interface UpdateColourRequest {
  readonly label?: string
  readonly hex_code?: string | null
  readonly display_order?: number
  readonly active?: boolean
}

export const colourKeys = {
  all: ["colours"] as const,
  list: () => ["colours", "list"] as const,
  usage: (code: string) => ["colours", code, "usage"] as const,
}

/// The whole master list. Small enough to hold — a company has a hundred
/// colours, not a hundred thousand — which is what lets the picker filter
/// locally and answer instantly while somebody is typing.
export function listColours(signal?: AbortSignal) {
  return node.get<ColourVocabulary>("/api/v1/colours", { signal })
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

export function createColour(
  request: CreateColourRequest,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<ColourTerm>("/api/v1/colours", request, {
    signal,
    headers: guarded(idempotencyKey),
  })
}

/// The version is required, not optional. The handler reads `If-Match` before
/// it reads anything else and refuses the request outright when it is missing,
/// so a call that omitted it would fail every time rather than merely losing a
/// race — which is why it is a parameter here and not a defaulted one.
export function updateColour(
  code: string,
  request: UpdateColourRequest,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.request<ColourTerm>(
    "PATCH",
    `/api/v1/colours/${encodeURIComponent(code)}`,
    request,
    { signal, headers: guarded(idempotencyKey, version) }
  )
}

/// What speaks for one colour, and whether it may be deleted.
///
/// The same shape the three word-lists answer with, because it is the same
/// question and the sheets that ask it are two spellings of one screen.
export function colourUsage(code: string, signal?: AbortSignal) {
  return node.get<TermUsage>(
    `/api/v1/colours/${encodeURIComponent(code)}/usage`,
    { signal }
  )
}

/// Remove a colour that has never been worn. See `deleteTerm`.
export function deleteColour(
  code: string,
  version: number,
  signal?: AbortSignal
) {
  return node.request<void>(
    "DELETE",
    `/api/v1/colours/${encodeURIComponent(code)}`,
    undefined,
    { signal, headers: { "If-Match": `"${version}"` } }
  )
}
