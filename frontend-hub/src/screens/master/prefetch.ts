import {
  warmInfinite,
  warmQuery,
  type PrefetchContext,
  type PrefetchMap,
  type Prefetcher,
} from "@/lib/prefetch"
import { ACTIVE_ARTICLES, articlePagesQuery } from "@/lib/queries/articles"
import { colourLabelsQuery, coloursQuery } from "@/lib/queries/colours"
import { masterNamesQuery } from "@/lib/queries/name-suggestions"
import { paymentTermsQuery } from "@/lib/queries/payment-terms"
import {
  catalogueVocabularyQuery,
  orderListQuery,
  purchaseDestinationsQuery,
  supplierBookQuery,
} from "@/lib/queries/procurement"
import { storesListQuery } from "@/lib/queries/stores"
import { unitsBookQuery } from "@/lib/queries/units"
import { termsQuery, type VocabularyKind } from "@/lib/queries/vocabulary"

/// What Articles (the `master` folder) asks first, before the screen is open
/// (`lib/prefetch.ts`). Every screen here reads its answer with
/// `useSuspense…` inside a `<Suspense>`, so the server starts these reads too
/// and streams the real page. The options are the screens' own: the catalogue
/// goes through the factory its screen uses (`lib/queries/articles.ts`), the
/// small masters through the `…Query` functions beside their fetchers.
///
/// The Merchandise menu shows the same screens under other paths; its
/// prefetcher (`screens/merchandise/prefetch.ts`) uses the ones exported here.

/// The view lives in the address bar (`q`, `f`, `articleOrder`): a link that
/// carries one asks for exactly that, and the screen does so itself.
const carriesView = (search: PrefetchContext["search"]) =>
  search.q !== undefined ||
  search.f !== undefined ||
  search.articleOrder !== undefined

/// Articles opens on its Active tab (no search, no facet, newest first) and
/// reads the words and the colour names its facets and rows are drawn with.
/// Mirrors `ArticleCatalogue` in `articles.tsx`. The first page of a catalogue
/// of twelve thousand is the heavy read here, so a hover or a visit only, never
/// idle.
export const articles: Prefetcher = async (client, { search }) => {
  if (carriesView(search)) return
  await Promise.all([
    warmInfinite(client, articlePagesQuery(ACTIVE_ARTICLES)),
    warmQuery(client, catalogueVocabularyQuery()),
    warmQuery(client, colourLabelsQuery()),
  ])
}

/// The four words an article is described with: one whole list each.
/// Mirrors `VocabularyList` in `vocabulary.tsx`.
export const terms =
  (kind: VocabularyKind): Prefetcher =>
  (client) =>
    warmQuery(client, termsQuery(kind))

/// Mirrors `ColourList` in `colours.tsx`.
export const colours: Prefetcher = (client) => warmQuery(client, coloursQuery())

/// Mirrors `NameList` in `name-suggestions.tsx`.
export const names: Prefetcher = (client) =>
  warmQuery(client, masterNamesQuery())

/// Units & Conversions: the whole book, a few dozen rows. Mirrors `UnitBook`
/// in `inventory/units.tsx`.
export const units: Prefetcher = (client) => warmQuery(client, unitsBookQuery())

export const prefetch: PrefetchMap = {
  "/master": articles,

  // The Supplier book under the Master menu is the Procurement screen under
  // another path (`SuppliersGate` → `Suppliers`): the same first page.
  // Mirrors `SupplierBook` in `procurement/suppliers.tsx` and
  // `procurement/prefetch.ts`.
  "/master/suppliers": async (client, { search }) => {
    if (search.q !== undefined) return
    await warmInfinite(
      client,
      supplierBookQuery({ category: "MERCHANDISE", status: "ACTIVE" })
    )
  },

  // Where a delivery can go, and the order book to count what is on its way to
  // each. Mirrors `DestinationBook` in `procurement/destinations.tsx`.
  "/master/destinations": async (client) => {
    await Promise.all([
      warmQuery(client, purchaseDestinationsQuery()),
      warmQuery(client, orderListQuery()),
    ])
  },

  // Every store. Mirrors `StoreBook` in `stores/list.tsx`.
  "/master/stores": (client) => warmQuery(client, storesListQuery()),

  "/master/units": units,
  "/master/divisions": terms("divisions"),
  "/master/tags": terms("tags"),
  "/master/sizes": terms("sizes"),
  "/master/colours": colours,
  "/master/name-suggestions": names,

  // Mirrors `Book` in `payment-templates.tsx`: the terms and the templates,
  // one book (Procurement's own read, one cache entry).
  "/master/payment-templates": (client) =>
    warmQuery(client, paymentTermsQuery()),
}

/// Idle warm-up: none yet. The catalogue's first page is the screen people
/// open here, and it is heavy (see `articles` above) — hover or visit only.
/// The small masters are opened too rarely to be worth an idle request.
export const warm: Record<string, number> = {}
