import { queryOptions } from "@tanstack/react-query"

import {
  warmInfinite,
  warmQuery,
  type PrefetchContext,
  type PrefetchMap,
} from "@/lib/prefetch"
import { articlePagesQuery } from "@/lib/queries/articles"
import { colourKeys, listColours } from "@/lib/queries/colours"
import {
  listNameSuggestions,
  nameSuggestionKeys,
} from "@/lib/queries/name-suggestions"
import { paymentTermsBook, paymentTermsKeys } from "@/lib/queries/payment-terms"
import {
  catalogueVocabulary,
  procurementKeys,
  supplierBookQuery,
} from "@/lib/queries/procurement"
import {
  listTerms,
  vocabularyKeys,
  type VocabularyKind,
} from "@/lib/queries/vocabulary"

/// What Articles (the `master` folder) asks first, before the screen is open
/// (`lib/prefetch.ts`). The catalogue goes through the factory its screen uses
/// (`lib/queries/articles.ts`); the small masters are one read each, built here
/// from the same key helpers and fetch functions the screens use, and name the
/// screen they mirror.

/// The view lives in the address bar (`q`, `f`, `articleOrder`): a link that
/// carries one asks for exactly that, and the screen does so itself.
const carriesView = (search: PrefetchContext["search"]) =>
  search.q !== undefined ||
  search.f !== undefined ||
  search.articleOrder !== undefined

/// One vocabulary list (Divisions, Tags, Sizes). Mirrors `VocabularyScreen`
/// in `vocabulary.tsx` (default options).
const termsQuery = (kind: VocabularyKind) =>
  queryOptions({
    queryKey: vocabularyKeys.list(kind),
    queryFn: ({ signal }) => listTerms(kind, signal),
  })

export const prefetch: PrefetchMap = {
  // Articles opens on the plain catalogue (no search, no facet, newest
  // first) and reads the words and the colour names its facets and rows are
  // drawn with, for half an hour. Mirrors `scope` and the two reads in
  // `articles.tsx`. The first page of a catalogue of twelve thousand is the
  // heavy read here, so a hover or a visit only, never idle.
  "/master": async (client, { search }) => {
    if (carriesView(search)) return
    await Promise.all([
      warmInfinite(client, articlePagesQuery({})),
      warmQuery(
        client,
        queryOptions({
          queryKey: procurementKeys.vocabulary(),
          queryFn: ({ signal }) => catalogueVocabulary(signal),
          staleTime: 30 * 60 * 1000,
        })
      ),
      warmQuery(
        client,
        queryOptions({
          queryKey: colourKeys.list(),
          queryFn: ({ signal }) => listColours(signal),
          staleTime: 30 * 60 * 1000,
        })
      ),
    ])
  },

  // The Supplier book under the Master menu is the Procurement screen under
  // another path (`SuppliersGate` → `Suppliers`): the same first page.
  // Mirrors `scope` in `procurement/suppliers.tsx` and
  // `procurement/prefetch.ts`.
  "/master/suppliers": async (client, { search }) => {
    if (search.q !== undefined) return
    await warmInfinite(
      client,
      supplierBookQuery({ category: "MERCHANDISE", status: "ACTIVE" })
    )
  },

  // The four words an article is described with: one whole list each.
  "/master/divisions": (client) => warmQuery(client, termsQuery("divisions")),
  "/master/tags": (client) => warmQuery(client, termsQuery("tags")),
  "/master/sizes": (client) => warmQuery(client, termsQuery("sizes")),
  // Mirrors `Colours` in `colours.tsx` (default options).
  "/master/colours": (client) =>
    warmQuery(
      client,
      queryOptions({
        queryKey: colourKeys.list(),
        queryFn: ({ signal }) => listColours(signal),
      })
    ),

  // Mirrors `NameSuggestions` in `name-suggestions.tsx`.
  "/master/name-suggestions": (client) =>
    warmQuery(
      client,
      queryOptions({
        queryKey: nameSuggestionKeys.master(),
        queryFn: ({ signal }) => listNameSuggestions(signal),
      })
    ),

  // Mirrors `PaymentTemplates` in `payment-templates.tsx`: the terms and the
  // templates, one book (Procurement's own read, one cache entry).
  "/master/payment-templates": (client) =>
    warmQuery(
      client,
      queryOptions({
        queryKey: paymentTermsKeys.book(),
        queryFn: ({ signal }) => paymentTermsBook(signal),
      })
    ),
}

/// Idle warm-up: none yet. The catalogue's first page is the screen people
/// open here, and it is heavy (see `/master` above) — hover or visit only.
/// The small masters are opened too rarely to be worth an idle request.
export const warm: Record<string, number> = {}
