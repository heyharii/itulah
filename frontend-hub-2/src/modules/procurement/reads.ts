import { useBoundedList, useReport } from "@/lib/list"
import type {
  BasketLine,
  CatalogueVocabulary,
  PurchaseDestination,
  Supplier,
} from "@itulah/contract"

import {
  keys,
  type ColourVocabulary,
  type Identity,
  type PurchaseOrderDetail,
  type PurchaseOrderPage,
} from "@/modules/procurement/wire"

/// The reads more than one screen in this module makes.
///
/// Not an abstraction layer over `lib/list.ts` — each of these is one call to
/// one of its three hooks, with the endpoint's own behaviour written down
/// beside it. The reason they are here rather than repeated in six screens is
/// that the CACHE KEY has to be identical everywhere, or the order book the
/// composer reads for its next PO number is a second copy of the one the order
/// book screen is showing, and invalidating after a write settles only one.

/// How much of the order book one request carries.
///
/// `GET /api/v1/purchase-orders` pages by cursor and reports a `total` over
/// everything the filters match, so this is a page size rather than a ceiling
/// on what can be known: a screen showing 200 of 1,284 is stating a fact, not
/// admitting a limit. The server clamps anything larger than a thousand.
export const BOOK_CAP = 200

/// Who is signed in.
///
/// Four purchasing writes name their actor in the body, so the buttons that
/// send them are disabled until this has answered — see `Identity` in
/// `wire.ts`. Kept for the session: it changes when somebody signs in again,
/// which is not something that happens between two clicks.
export function useIdentity() {
  return useReport<Identity>({ key: keys.identity, path: "/api/v1/auth/me" })
}

/// The signed-in username, or the empty string while the answer is in flight.
///
/// Empty rather than a guess, and every write that needs it refuses to send
/// while it is empty. An actor field filled in with "unknown" is an audit trail
/// that says a decision was made by nobody.
export function useActor(): string {
  return useIdentity().data?.username ?? ""
}

/// The words a catalogue may be described with: divisions, tags and sizes.
///
/// One request rather than three, because a screen that filters by all of them
/// needs all of them before it can draw any. Colours are deliberately NOT in
/// here — see `useColours`.
export function useVocabulary() {
  return useReport<CatalogueVocabulary>({
    key: keys.vocabulary,
    path: "/api/v1/catalogue/vocabulary",
  })
}

/// The colour master.
///
/// Its own endpoint and its own read, for the reason the contract gives on
/// `CatalogueVocabulary`: colour is an editable master with a screen of its
/// own, and a second half-copy of it travelling on the vocabulary route is the
/// exact split the master was created to prevent.
///
/// Only the FILTERS and the item form need this. A card draws its swatches from
/// the item it was handed, which already carries each colour's label and hex.
export function useColours() {
  return useReport<ColourVocabulary>({
    key: keys.colours,
    path: "/api/v1/colours",
  })
}

/// Every supplier.
///
/// `GET /api/v1/suppliers` takes exactly one parameter — `status` — and answers
/// a bare array with **no cap at all**: not a cursor, not a `limit` the handler
/// reads, not a total. So the answer is the whole list, which is the one
/// circumstance in which narrowing it in the browser is not a lie: there is no
/// page to mistake for the set.
///
/// `useBoundedList` is still the honest hook for it. Its `truncated` is derived
/// from the row count against the limit asked for, so with a limit far above
/// the number of suppliers it reads false — which is correct here and would
/// stop being correct the day somebody puts a cap on the handler. That is the
/// right way round: the hook would start warning rather than start lying.
export function useSuppliers() {
  return useBoundedList<Supplier>({
    key: keys.suppliers,
    path: "/api/v1/suppliers",
    params: {},
    limit: 2000,
  })
}

/// Where a delivery can go.
///
/// Deliberately not `GET /api/v1/sync/origins`, which is Admin-only because
/// knowing which nodes exist is administration — a Supervisor raising an order
/// was getting a 403 on a list of site names. And not `/sync/fleet`, which
/// everybody can read but carries `origin_id` rather than `site_id`; an order
/// routed by origin id would name a site that does not exist.
export function useDestinations() {
  return useBoundedList<PurchaseDestination>({
    key: keys.destinations,
    path: "/api/v1/purchase-destinations",
    params: {},
    limit: 500,
  })
}

/// The order book, narrowed on the server.
///
/// ## Why this is a report and not one of the list hooks
///
/// `useCursorList` is out because there is no cursor. `useBoundedList` is the
/// near miss: the endpoint IS capped and the cap does need reporting — but the
/// hook hands back rows and drops the envelope, and the envelope is where the
/// FACET COUNTS are. Those counts are the whole affordance of the status and
/// supplier filters: counted over the entire book rather than over what the
/// current filters left behind, they are how somebody decides whether a filter
/// is worth pressing before they press it.
///
/// So the whole answer is read as a report and the screen derives the cap
/// itself, which it can do exactly: the server returns everything that matched,
/// up to `limit`, so `items.length === limit` means "there may be more and this
/// endpoint cannot say".
export function useOrderBook(params: {
  q?: string
  status?: string
  supplier?: string
  issued_from?: string
  issued_to?: string
}) {
  return useReport<PurchaseOrderPage>({
    key: keys.orders,
    path: "/api/v1/purchase-orders",
    params: {
      q: params.q || null,
      // Comma-separated, which is what `comma_list` on the handler reads. An
      // empty string is not sent at all: `?status=` reaches the server as one
      // blank code, matches nothing, and empties the screen on a filter nobody
      // set.
      status: params.status || null,
      supplier: params.supplier || null,
      issued_from: params.issued_from || null,
      issued_to: params.issued_to || null,
      limit: BOOK_CAP,
    },
  })
}

/// One order, whole, with what has actually arrived against it.
///
/// The received figure is summed from the DC's goods receipts on every read and
/// is never stored, which is why a sheet re-reads rather than being handed the
/// row behind it: the list carries a summary, and a URL naming an order the
/// list is not holding still opens the record.
export function useOrder(id: string) {
  return useReport<PurchaseOrderDetail>({
    key: keys.order(id),
    path: `/api/v1/purchase-orders/${encodeURIComponent(id)}`,
    enabled: id !== "",
  })
}

/// What has been picked out and not yet ordered.
///
/// Kept by the SERVER rather than in `localStorage`, which is the reason this
/// module has a basket screen at all: a basket in a browser is a property of a
/// machine, does not follow anybody to a second desk, and cannot be seen by the
/// person asked to approve it.
///
/// Every route under `/sourcing-basket` is scoped to the caller by the session
/// and none of them names a user, so there is no shape of request that reads or
/// empties somebody else's.
///
/// It is also this module's DRAFT STORE. The composer's lines are these lines —
/// see `compose.tsx` — which is what makes a half-written order survive a
/// reload, a second desk and a closed tab.
export function useBasket() {
  return useBoundedList<BasketLine>({
    key: keys.basket,
    path: "/api/v1/sourcing-basket",
    params: {},
    limit: 500,
  })
}
