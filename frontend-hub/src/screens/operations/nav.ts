import {
  Boxes,
  FileText,
  ListChecks,
  RefreshCw,
  Tags,
  Truck,
  UserCog,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import { useWaiting } from "@/lib/operations/waiting"

/// **Operations** — the warehouse console, folded into the hub.
///
/// Every other module here is a family of endpoints on the cloud node. This
/// one is not: its screens read a DC edge node, over a second client (see
/// `lib/api.ts`). That is the only thing about it that is unusual, and it is
/// worth knowing before reading the sections below, because it is why signing
/// in to the hub does not sign you in to these screens.
///
/// ## The sections are stations, in the order goods move
///
/// The module list is a reading order of the business — what is bought, held,
/// sold, what it cost, who did it. Inside this module the order is a different
/// kind of sequence: **the order a carton moves through the building**.
/// Receiving → tagging → picking → packing → despatch, and then the node the
/// whole thing runs on. Somebody who has never used the app can read the
/// sub-list top to bottom and have described the warehouse.
///
/// The stations arrived here from a standalone DC app whose rail carried them
/// as seven top-level tiles. Seven tiles beside ten business modules would
/// have said the warehouse is seven-tenths of the company; one module with
/// its stations listed inside it says what is true — it is one place, with
/// stations in it.
///
/// ## Badges are counts, not tones
///
/// A hub badge says *there is something*. On a floor that is not enough: the
/// question is always "how many are waiting for me", and a station with
/// nothing waiting should look finished rather than merely quiet. So the
/// numbers come from `useWaiting()`, which counts what is actually queued.

/// The counts, read once per render of whichever row asks.
///
/// `useWaiting` runs eight queries; these wrappers all read the same Query
/// cache, so twenty sidebar rows calling them is still nine requests. It polls
/// only for somebody signed in to the node — see the hook.
/// The counts, one hook each.
///
/// Named `use…` and declared at module scope because they are hooks: the
/// sidebar calls them like any other, and an arrow property on an object
/// literal is invisible to the rules-of-hooks lint that keeps that promise
/// honest. `useWaiting` runs eight queries; these all read the same Query
/// cache, so twenty sidebar rows asking is still nine requests, and it polls
/// only for somebody signed in to the node — see the hook.
/// Receiving is one row now, so its badge is the whole station: orders still
/// owed, plus counts waiting for a second person. Two numbers on one row would
/// be a row nobody can read at a glance.
const useReceiving = () => {
  const w = useWaiting()
  return w.owed + w.toVerify
}
const useTagging = () => useWaiting().tagging
const usePickLines = () => useWaiting().pickLines
const useOpenBoxes = () => useWaiting().openBoxes
const useLooseBoxes = () => useWaiting().looseBoxes
const useOnYard = () => useWaiting().onYard

/// The module's own row: everything queued anywhere in the building. One hook,
/// called unconditionally by one row — see `AppModule.useCount` for why this
/// is declared here rather than summed from the items.
const useEverythingWaiting = () => {
  const w = useWaiting()
  return (
    w.owed +
    w.toVerify +
    w.tagging +
    w.pickLines +
    w.openBoxes +
    w.looseBoxes +
    w.onYard
  )
}

export const operationsNav: AppModule = {
  id: "operations",
  label: "Operations",
  icon: Truck,
  home: "/operations/intake",
  /// The row lands on Intake — goods arrive before anything else can happen to
  /// them — but the module owns everything under `/operations`. Without this
  /// the sidebar folded the module away the moment somebody walked from the
  /// bay to the packing bench, because no other station's path begins with
  /// `home`. See `AppModule.base`.
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
  ],
  useCount: useEverythingWaiting,
  badge: "warn",
  sections: [
    {
      /// **The two stations goods pass through before they are stock**, and
      /// the only group here with no heading over it — two rows do not need a
      /// table of contents, and the heading would only say what the rows say.
      ///
      /// **Receiving** — the loading bay. The ceremony is unchanged: a
      /// delivery is *counted* by somebody who is not shown what was ordered,
      /// then *verified* by somebody else who is shown everything, and only
      /// that last step turns goods into stock. But it is a sequence a person
      /// walks through against one order, not four places to be, so it is one
      /// screen with the verb on the row of the order it belongs to.
      items: [
        {
          path: "/operations/intake",
          label: "Receiving",
          icon: Truck,
          useCount: useReceiving,
          badge: "warn",
        },
        /// **Tagging** — where a counted quantity becomes that many tracked
        /// pieces. The EPCs arrive as finished strings from the centre: the DC
        /// prints them and never computes one. Confirming a job is what
        /// actually puts the units into the warehouse.
        ///
        /// One row, like receiving. The print bench was a screen of its own
        /// and is a dialog now: printing is something you do to an article on
        /// the list in front of you, not a place to navigate to and then
        /// re-choose the article you were already looking at.
        {
          path: "/operations/tagging",
          label: "Tagging",
          icon: Tags,
          useCount: useTagging,
          badge: "warn",
        },
      ],
    },
    {
      /// **Outbound: four documents, in the order the goods make them.**
      ///
      /// A picklist fetches garments off the racks for nobody in particular. A
      /// pack puts some of them in a carton for one shop — which is the moment
      /// the flow decides something, and the reason a pack has a destination
      /// and a picklist does not. Cartons gather into a shipment, shipments
      /// onto a dispatch, and the dispatch leaves.
      ///
      /// It was ten rows. Three of them were picking (a list, the round the
      /// picks landed in, and a lookup nobody asked for), four were packing
      /// (a carton opened against a target, filled by scanning, swept under an
      /// RFID arch, and gathered into a round) — one act each, described by the
      /// equipment rather than by the work, and a bench with no reader could
      /// not use most of them. Each station is now the list of what it has
      /// made plus the sheet that makes the next one, which is what a person
      /// standing at it actually does.
      label: "Outbound",
      items: [
        {
          path: "/operations/picking",
          label: "Picking",
          icon: ListChecks,
          useCount: usePickLines,
          badge: "warn",
        },
        {
          path: "/operations/packing",
          label: "Packing",
          icon: Boxes,
          useCount: useOpenBoxes,
          badge: "warn",
        },
        {
          path: "/operations/despatch",
          label: "Shipments",
          icon: FileText,
          useCount: useLooseBoxes,
          badge: "warn",
        },
        /// Dispatch and in transit are one row because they are one record:
        /// a run is loaded, and then the gate opens on the same run. Two rows
        /// would be asking somebody to navigate between two halves of a truck.
        {
          path: "/operations/despatch/trucks",
          label: "Dispatch",
          icon: Truck,
          useCount: useOnYard,
        },
      ],
    },
    {
      /// **Node** — the machine the warehouse is standing on, and the session
      /// this app holds there. An edge node runs whether or not it can reach
      /// the centre, so whether today's work has actually arrived is said here
      /// rather than left to be inferred from a screen that looks the same
      /// either way.
      label: "Node",
      items: [
        { path: "/operations/node", label: "Sync", icon: RefreshCw },
        { path: "/operations/node/account", label: "Account", icon: UserCog },
      ],
    },
  ],
}
