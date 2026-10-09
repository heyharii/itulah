import { useQuery } from "@tanstack/react-query"
import {
  BookOpen,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Columns3,
  History,
  Layers,
  PackageSearch,
  PanelsTopLeft,
  ListChecks,
  Printer,
  Store,
  Truck,
  Undo2,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import { useWaiting } from "@/lib/operations/waiting"
import {
  listOpenQuantityChecks,
  quantityCheckKeys,
} from "@/lib/queries/quantity-checks"
import { useFlowCounts } from "@/screens/operations/workload/use-flow-counts"

/// **Operations** — the warehouse console, folded into the hub.
///
/// Every other module here is a family of endpoints on the cloud node. This
/// one is not: its screens read a DC edge node, over a second client (see
/// `lib/api.ts`). That is the only thing about it that is unusual, and it is
/// worth knowing before reading the sections below, because it is why signing
/// in to the hub does not sign you in to these screens.
///
/// ## The menu is six flows; the stations live under the fold
///
/// The module list is a reading order of the business — what is bought, held,
/// sold, what it cost, who did it. Inside this module the first section is
/// the owner's six-row menu (4 Oct 2026): **the flows work is read through** —
/// Workload (the landing that counts every flow at once), PO receiving,
/// Allotment, Return from store, Return to supplier, Activity log. Each flow
/// row opens a board whose lanes are the stages goods move through.
///
/// The stations themselves — Receiving, Printing, Packing lists, Stock,
/// Count, the ledger — did not stop existing: they sit under the department's
/// **More** fold (`more: true` below), one click down, exactly as routed and
/// counted as before. They arrived here from a standalone DC app whose rail
/// carried them as seven top-level tiles; seven tiles beside ten business
/// modules said the warehouse is seven-tenths of the company, and six flows
/// say what is true — it is one place, read through its flows.
///
/// ## Badges are counts, not tones
///
/// A hub badge says *there is something*. On a floor that is not enough: the
/// question is always "how many are waiting for me", and a row with nothing
/// waiting should look finished rather than merely quiet. So the numbers come
/// from `useWaiting()` — and, for the two return flows, from
/// `useFlowCounts()` — which count what is actually queued.

/// The counts, read once per render of whichever row asks.
///
/// `useWaiting` runs nine queries; these wrappers all read the same Query
/// cache, so twenty sidebar rows calling them is still ten requests. It polls
/// only for somebody signed in to the node — see the hook.
/// The counts, one hook each.
///
/// Named `use…` and declared at module scope because they are hooks: the
/// sidebar calls them like any other, and an arrow property on an object
/// literal is invisible to the rules-of-hooks lint that keeps that promise
/// honest. `useWaiting` runs nine queries; these all read the same Query
/// cache, so twenty sidebar rows asking is still ten requests, and it polls
/// only for somebody signed in to the node — see the hook.
/// Receiving's badge is the orders still owed a count. A count waiting for
/// review is the buyer's (Procurement › Purchase orders), not the bay's, so it is
/// not counted here.
const useReceiving = () => useWaiting().owed
const useTagging = () => useWaiting().tagging
/// Counts head office asked for by colour and size, still unanswered.
const useQuantityChecks = () =>
  useQuery({
    queryKey: quantityCheckKeys.open(),
    queryFn: ({ signal }) => listOpenQuantityChecks(signal),
    refetchInterval: 30_000,
  }).data?.length ?? null
/// Picklists still to pick — one per allotment × shop, nobody composes one
/// (owner, 29 Sep 2026): it exists as soon as the allotment is here.
const useToPick = () => useWaiting().toPick
/// Shops with something picked and still standing in the pick area —
/// Packing's own queue, now that a packer opens a shop and gathers its
/// picklists rather than one picklist at a time.
const useToPack = () => useWaiting().toPack
/// Sealed cartons a trip can still tick, plus trucks loaded the old way and
/// never departed — so none of either kind is stranded off the badge.
const useToDispatch = () => {
  const w = useWaiting()
  return w.toDispatch + w.onYard
}

/// The module's own row: everything queued anywhere in the building. One hook,
/// called unconditionally by one row — see `AppModule.useCount` for why this
/// is declared here rather than summed from the items.
const useEverythingWaiting = () => {
  const w = useWaiting()
  return w.owed + w.tagging + w.toPick + w.toPack + w.toDispatch + w.onYard
}

/// The Allotment board's own badge: everything a carton can still be moved
/// through — picked up, packed away, or put on a truck.
const useAllotment = () => {
  const w = useWaiting()
  return w.toPick + w.toPack + w.toDispatch
}

/// Return-from-store rows that are not finished: on the road, just counted,
/// or sitting in the return pool waiting for an inspector.
const useFromStore = () => {
  const counts = useFlowCounts()
  const store = counts?.store
  if (!store) return null
  return store.transit + store.count + store.review
}

/// Return-to-supplier rows still open: listed, on the road, or mid-settlement.
const useToSuppliers = () => {
  const counts = useFlowCounts()
  const rts = counts?.rts
  if (!rts) return null
  return rts.list + rts.dispatch + rts.resolution
}

export const operationsNav: AppModule = {
  id: "operations",
  label: "Operations",
  icon: Truck,
  /// The six-row menu (owner, 4 Oct 2026) opens on the Workload board — the
  /// one screen that reads every flow at once — and the module owns
  /// everything under `/operations`. Without `base` the sidebar would fold
  /// the module away the moment somebody walked from the workload to a
  /// station, because no other row's path begins with `home`. See
  /// `AppModule.base`.
  home: "/operations/workload",
  base: "/operations",
  /// The stations that were folded into the two above them. Every one of these
  /// was a bookmark on somebody's bay tablet — Count, Verify and Direct intake
  /// became one Receiving screen, the print bench became a dialog on Tagging,
  /// and Counting went entirely (pools and the ledger are read in Inventory).
  /// A redirect to the module's home is a worse answer than the screen they
  /// wanted, and a much better one than a 404.
  moved: [
    "/operations/intake/count",
    "/operations/intake/verify",
    "/operations/intake/direct",
    "/operations/tagging/bench",
    "/operations/counting",
    "/operations/counting/sheet",
    "/operations/counting/stock",
    "/operations/counting/ledger",
    /// The seven outbound screens that became four. Rounds are the documents
    /// now, so there is nothing left for a round screen to gather; the RFID
    /// box and its sweep are the same act the pack sheet performs, described
    /// by a reader; line position answered a question about an allotment that
    /// nothing in the warehouse was asking; and destinations is the queue at
    /// the top of Packing.
    "/operations/picking/rounds",
    "/operations/picking/lines",
    "/operations/packing/fill",
    "/operations/packing/sweep",
    "/operations/packing/rounds",
    "/operations/despatch/destinations",
    /// Inspect went with the 1 Oct goods-flow rulings: nothing inspects a
    /// delivery on arrival. The returns BOARD came back on 4 Oct 2026 as its
    /// own row (below), so its old path answers the board again.
    "/operations/intake/inspect",
    /// The PO receiving board, gone on 4 Oct 2026 — Receiving is the table.
    "/operations/po-receiving",
  ],
  useCount: useEverythingWaiting,
  badge: "warn",
  sections: [
    {
      items: [
        {
          path: "/operations/workload",
          label: "Workload",
          icon: PanelsTopLeft,
        },
        /// Receiving is the table again (owner, 4 Oct 2026: "balikin ke
        /// receiving table"): the board that stood here as PO receiving is
        /// gone, and its old path lands on the module's home.
        {
          path: "/operations/intake",
          label: "Receiving",
          icon: Truck,
          useCount: useReceiving,
          badge: "warn",
        },
        /// Asked from New articles; answered here with colour, size and
        /// quantity. Under Receiving, out of the More fold (owner, 10 Oct 2026).
        {
          path: "/operations/quantity-checks",
          label: "Quantity Checks",
          icon: ClipboardCheck,
          useCount: useQuantityChecks,
          badge: "warn",
        },
        /// Allotment is the board (what the DC is sending to the shops) —
        /// the name stands (owner, 4 Oct 2026). Its lanes carry the flow
        /// names; Picking, Packing and Dispatch stay routable because its
        /// cards open them.
        {
          path: "/operations/board",
          label: "Allotment",
          icon: Columns3,
          useCount: useAllotment,
          badge: "warn",
        },
        /// A store's return, from the road to the return pool.
        {
          path: "/operations/board/returns",
          label: "Return from Store",
          icon: Store,
          useCount: useFromStore,
          badge: "warn",
        },
        /// What is going back to a supplier — its own menu since 2 Oct 2026,
        /// no longer a tab of the board.
        {
          path: "/operations/board/suppliers",
          label: "Return PO",
          icon: Undo2,
          useCount: useToSuppliers,
          badge: "warn",
        },
        {
          path: "/operations/activity",
          label: "Activity Log",
          icon: History,
        },
      ],
    },
    {
      /// The stations, one click under the six. Everything here is routed,
      /// reachable and counted as before — the fold only moves where the
      /// sidebar draws the row (owner's six-row menu, 4 Oct 2026).
      label: "Stations",
      items: [
        /// Store returns is a tab of Receiving, not a screen of its own.
        {
          path: "/operations/intake/returns",
          label: "Receiving",
          icon: Truck,
          hidden: true,
        },
        {
          path: "/operations/tagging",
          label: "Printing",
          icon: Printer,
          useCount: useTagging,
          badge: "warn",
          more: true,
        },
        /// One per sealed carton — the paper that prints when it is sealed.
        {
          path: "/operations/packing-lists",
          label: "Packing Lists",
          icon: ClipboardList,
          more: true,
        },
        {
          path: "/operations/picking",
          label: "Picking",
          icon: ListChecks,
          useCount: useToPick,
          hidden: true,
        },
        {
          path: "/operations/packing",
          label: "Packing",
          icon: Boxes,
          useCount: useToPack,
          hidden: true,
        },
        {
          path: "/operations/despatch",
          label: "Dispatch",
          icon: Truck,
          useCount: useToDispatch,
          hidden: true,
        },
        /// The pre-29-Sep path, kept routable for old bookmarks.
        {
          path: "/operations/despatch/trucks",
          label: "Dispatch",
          icon: Truck,
          hidden: true,
        },
        {
          path: "/operations/stock",
          label: "Stock",
          icon: Layers,
          more: true,
        },
        {
          path: "/operations/stock/articles",
          label: "Stock by Article",
          icon: PackageSearch,
          more: true,
        },
        {
          path: "/operations/count",
          label: "Count",
          icon: ClipboardCheck,
          more: true,
        },
        {
          path: "/operations/ledger",
          label: "Stock Ledger",
          icon: BookOpen,
          more: true,
        },
      ],
    },
  ],
}
