import { queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"

/// The names New articles suggests as a name is typed — a master of its own
/// (`/api/v1/name-suggestions`, migration 0916), not the articles that already
/// exist. Nothing references a row, so a suggestion is renamed, retired or
/// deleted freely.
export interface NameSuggestion {
  readonly suggestion_id: string
  readonly name: string
  readonly active: boolean
}

export const nameSuggestionKeys = {
  all: ["name-suggestions"] as const,
  /// What the Name box asks for, by what has been typed.
  typed: (q: string) => ["name-suggestions", "typed", q] as const,
  /// Every one, retired included, for the master screen.
  master: () => ["name-suggestions", "master"] as const,
}

/// The active names containing `q`, alphabetically.
export function suggestNames(q: string, signal?: AbortSignal) {
  return node.get<readonly NameSuggestion[]>(
    `/api/v1/name-suggestions?q=${encodeURIComponent(q)}`,
    { signal }
  )
}

/// Every name, retired ones too.
export function listNameSuggestions(signal?: AbortSignal) {
  return node.get<readonly NameSuggestion[]>(
    "/api/v1/name-suggestions?all=true",
    { signal }
  )
}

export function createNameSuggestion(name: string) {
  return node.post<NameSuggestion>("/api/v1/name-suggestions", { name })
}

export function updateNameSuggestion(
  id: string,
  change: { readonly name?: string; readonly active?: boolean }
) {
  return node.patch<NameSuggestion>(`/api/v1/name-suggestions/${id}`, change)
}

export function deleteNameSuggestion(id: string) {
  return node.delete<void>(`/api/v1/name-suggestions/${id}`)
}

/// The master screen's whole list, for that screen and for the prefetcher
/// (`screens/master/prefetch.ts`).
export const masterNamesQuery = () =>
  queryOptions({
    queryKey: nameSuggestionKeys.master(),
    queryFn: ({ signal }) => listNameSuggestions(signal),
  })
