import {
  Building2,
  ClipboardList,
  FilePlus2,
  Hourglass,
  Package,
  PackageSearch,
  Percent,
  ShoppingBasket,
  ShoppingCart,
  Warehouse,
} from "lucide-react"

import { lazy } from "react"

import type { Module } from "@/lib/nav"
import { date, list, oneOf, str } from "@/lib/search-schema"

/// Procurement — what we buy, who we buy it from, and what has not turned up.
///
/// ## The order book is the module's own screen
///
/// It is what a buyer opens the app for, and it is the record everything else
/// in the module is a view of: Outstanding is the same book with the settled
/// rows taken out, Destinations is the same book folded by where it is going.
/// So `/procurement` IS the order book rather than a landing page above one.
///
/// ## The sections, and why Sourcing is not a detour any more
///
/// `frontend-hub` filed this module as a single row and hid everything else,
/// on the reasoning that Sourcing is "a question asked while raising an order,
/// not instead of one". That was true of its Sourcing, which was reached from a
/// button in the order book's header — and it cost the module its shape: eight
/// screens existed, one was navigable, and the other seven were reachable only
/// if you already knew they were there.
///
/// Here the three sections say what the work actually is:
///
///   **Buying** — choosing goods and turning them into an order. Sourcing is
///     the shelf, the Basket is what has been taken off it, and New order is
///     the document. They are one flow and they read as one.
///   **Waiting on** — the two queues. Something has not arrived, or something
///     was billed at a price nobody agreed. Both are exception lists: they are
///     empty when the business is behaving, which is what makes a row in them
///     worth reading.
///   **Master data** — the records the buying rests on. Read once a month, and
///     filed last for exactly that reason.
///
/// ## One hidden row, and what `hidden` means here
///
/// New order is routed, linkable and findable, and is not a sidebar row,
/// because it is a document somebody arrives at from the basket or from the
/// order book rather than a place they set out for. It still has to survive
/// being opened cold with nothing but its URL — which it does: with no supplier
/// chosen it asks which one, from the baskets that exist.
///
/// ## What is NOT here
///
/// **Article setups.** `frontend-hub` reaches `/api/v1/article-setups` from
/// this module, and it is not purchasing: it is the step where a delivery that
/// has already been counted is given an identity of ours, which mints an
/// article code, its SKUs and their EPCs. That belongs with Articles and
/// Inventory, and porting it here would put the one write that draws from the
/// serial sequence in the module least likely to own it.
///
/// **Photograph upload.** See the note in `item-form.tsx`.

const OrdersScreen = lazy(() =>
  import("@/modules/procurement/orders").then((m) => ({
    default: m.OrdersScreen,
  })),
)
const SourcingScreen = lazy(() =>
  import("@/modules/procurement/sourcing").then((m) => ({
    default: m.SourcingScreen,
  })),
)
const BasketScreen = lazy(() =>
  import("@/modules/procurement/basket").then((m) => ({
    default: m.BasketScreen,
  })),
)
const ComposeScreen = lazy(() =>
  import("@/modules/procurement/compose").then((m) => ({
    default: m.ComposeScreen,
  })),
)
const OutstandingScreen = lazy(() =>
  import("@/modules/procurement/outstanding").then((m) => ({
    default: m.OutstandingScreen,
  })),
)
const AmendmentsScreen = lazy(() =>
  import("@/modules/procurement/amendments").then((m) => ({
    default: m.AmendmentsScreen,
  })),
)
const SuppliersScreen = lazy(() =>
  import("@/modules/procurement/suppliers").then((m) => ({
    default: m.SuppliersScreen,
  })),
)
const CatalogueScreen = lazy(() =>
  import("@/modules/procurement/catalogue").then((m) => ({
    default: m.CatalogueScreen,
  })),
)
const DestinationsScreen = lazy(() =>
  import("@/modules/procurement/destinations").then((m) => ({
    default: m.DestinationsScreen,
  })),
)

/// Today, as the server spells a date — for a date field that has no default.
///
/// `date()` in `lib/search-schema.ts` takes a fallback factory because a
/// reporting date usually has one. These two do not: an unset promised date
/// means "nobody said", and an unset issued-from means "the whole book". The
/// empty string is that answer, and it is stripped from the URL by
/// `defaultsOf` like every other default.
const unset = () => ""

export const procurementNav: Module = {
  id: "procurement",
  label: "Procurement",
  icon: ShoppingCart,
  base: "/procurement",
  sections: [
    {
      items: [
        {
          path: "/procurement",
          label: "Purchase orders",
          icon: ClipboardList,
          screen: OrdersScreen,
          /// Five narrowings the SERVER answers and one piece of screen state.
          ///
          /// `status` and `supplier` are comma-separated lists on the wire — the
          /// handler reads them through `comma_list` — but they are ONE string
          /// here rather than a `list()`, because that is the shape the request
          /// takes and splitting then rejoining would be two spellings of one
          /// value in one file.
          ///
          /// No `sort` or `dir`. The endpoint has no ordering parameter, so a
          /// sortable header would be sorting whichever rows happen to have
          /// arrived and calling it the answer — see `lib/table.ts`.
          search: {
            q: str(),
            status: str(),
            supplier: str(),
            from: date(unset),
            to: date(unset),
            /// Which order's record is open. In the URL so it can be linked to,
            /// survives the reload a browser gets every morning, and is where a
            /// receipt from the composer sends somebody.
            order: str(),
            panel: str(),
          },
        },
      ],
    },
    {
      label: "Buying",
      items: [
        {
          path: "/procurement/sourcing",
          label: "Sourcing",
          icon: PackageSearch,
          screen: SourcingScreen,
          /// Every facet is a LIST, and that is the whole reason `list()`
          /// exists: a repeated key arrives as an array and a single one as a
          /// string, and a screen that forgot would filter on the four
          /// characters of `"KIDS".length`.
          search: {
            q: str(),
            sort: oneOf(
              ["relevance", "newest", "price_low", "price_high"] as const,
              "relevance",
            ),
            /// Standing in one supplier's shop. A single value, because it is
            /// the same parameter the facet filter would use and the server
            /// answers one question — two spellings of "whose catalogue" would
            /// make the facet counts disagree with the rows.
            shop: str(),
            division: list(),
            tag: list(),
            colour: list(),
            size: list(),
            item: str(),
            panel: str(),
          },
        },
        {
          path: "/procurement/basket",
          label: "Basket",
          icon: ShoppingBasket,
          screen: BasketScreen,
        },
        {
          path: "/procurement/compose",
          label: "New order",
          icon: FilePlus2,
          screen: ComposeScreen,
          hidden: true,
          /// The whole of the order that is not a line.
          ///
          /// In the URL rather than in component state, and that is the
          /// module's central decision: the LINES live on the server (they are
          /// basket lines) and everything else lives here, so a half-written
          /// order survives a reload, a closed tab and a second desk. A draft
          /// that silently loses a line is the defect this is shaped against,
          /// and neither half of it is in memory.
          search: {
            supplier: str(),
            step: oneOf(["lines", "review"] as const, "lines"),
            /// Where the goods land. The server REQUIRES one — an absent
            /// `destination_site_id` reaches `required_supplier_text` as an
            /// empty string and is refused — so "the node's default" is a
            /// validation error wearing the word "default". The screen picks a
            /// warehouse and lets it be changed.
            dest: str(),
            promised: date(unset),
            discount: str(),
            note: str(),
            /// The picker, open over the lines. A panel rather than a second
            /// route: what is being added to is on screen behind it, and
            /// navigating away from the document to add a line to it is how
            /// somebody loses their place.
            pick: str(),
            /// What was typed into the picker. Its own key, because the
            /// document's own screen has no search box and one shared `q`
            /// would mean closing the picker left a filter on nothing.
            pq: str(),
          },
        },
      ],
    },
    {
      label: "Waiting on",
      items: [
        {
          path: "/procurement/outstanding",
          label: "Outstanding",
          icon: Hourglass,
          screen: OutstandingScreen,
          /// `line` and `reason` are the close-short form, and they are in the
          /// URL for the same reason the composer's fields are: a sentence
          /// somebody is halfway through typing about why 200 pieces are not
          /// coming is work, and a reload that eats it is a reload that costs
          /// somebody the thought as well as the typing.
          search: {
            order: str(),
            site: str(),
            only: oneOf(["", "ISSUED"] as const, ""),
            line: str(),
            reason: str(),
          },
        },
        {
          path: "/procurement/amendments",
          label: "Price amendments",
          icon: Percent,
          screen: AmendmentsScreen,
          search: { amendment: str(), note: str() },
        },
      ],
    },
    {
      label: "Master data",
      items: [
        {
          path: "/procurement/suppliers",
          label: "Suppliers",
          icon: Building2,
          screen: SuppliersScreen,
          /// `supplier` holds a record id, or the word `new` for the blank
          /// form. Creating and reading a supplier are the same shape of thing
          /// and a second route for the create case would be a second place the
          /// field list has to be kept in step.
          search: {
            q: str(),
            status: oneOf(["", "ACTIVE", "INACTIVE"] as const, "ACTIVE"),
            supplier: str(),
            edit: str(),
          },
        },
        {
          path: "/procurement/catalogue",
          label: "Catalogue",
          icon: Package,
          screen: CatalogueScreen,
          search: {
            q: str(),
            status: oneOf(["", "ACTIVE", "INACTIVE"] as const, "ACTIVE"),
            /// Which stage of being finished. A declared set rather than the
            /// values present: "no unclassified items left" is the answer
            /// somebody wants, and a facet built from the data cannot give it
            /// because the option disappears with the last row.
            ready: oneOf(["", "0", "1", "2"] as const, ""),
            supplier: str(),
            item: str(),
            /// `new`, or the id of the item being corrected.
            form: str(),
          },
        },
        {
          path: "/procurement/destinations",
          label: "Destinations",
          icon: Warehouse,
          screen: DestinationsScreen,
        },
      ],
    },
  ],
}
