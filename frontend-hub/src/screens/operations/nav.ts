import {
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileText,
  ListChecks,
  MapPin,
  PackageCheck,
  PackagePlus,
  Printer,
  Radar,
  RefreshCw,
  Route,
  ScanBarcode,
  ScanLine,
  ScrollText,
  Store,
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
/// kind of sequence: **the order a carton moves through the building**. Intake
/// → tagging → counting → picking → packing → despatch, and then the node the
/// whole thing runs on. Somebody who has never used the app can read the
/// sub-list top to bottom and have described the warehouse.
///
/// The stations arrived here from a standalone DC app whose rail carried them
/// as seven top-level tiles. Seven tiles beside ten business modules would
/// have said the warehouse is seven-tenths of the company; one module with
/// seven labelled sections says what is true — it is one place, with stations
/// in it.
///
/// ## Badges are counts, not tones
///
/// A hub badge says *there is something*. On a floor that is not enough: the
/// question is always "how many are waiting for me", and a station with
/// nothing waiting should look finished rather than merely quiet. So the
/// numbers come from `useWaiting()`, which counts what is actually queued.

/// The counts, read once per render of whichever row asks.
///
/// `useWaiting` runs nine queries; these wrappers all read the same Query
/// cache, so twenty sidebar rows calling them is still nine requests. It polls
/// only for somebody signed in to the node — see the hook.
/// The counts, one hook each.
///
/// Named `use…` and declared at module scope because they are hooks: the
/// sidebar calls them like any other, and an arrow property on an object
/// literal is invisible to the rules-of-hooks lint that keeps that promise
/// honest. `useWaiting` runs nine queries; these all read the same Query
/// cache, so twenty sidebar rows asking is still nine requests, and it polls
/// only for somebody signed in to the node — see the hook.
const useReceipts = () => useWaiting().receipts
const useToVerify = () => useWaiting().toVerify
const useTagging = () => useWaiting().tagging
const useCounts = () => useWaiting().counts
const useMissing = () => useWaiting().missing
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
    w.receipts +
    w.toVerify +
    w.tagging +
    w.counts +
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
  useCount: useEverythingWaiting,
  badge: "warn",
  sections: [
    {
      /// **Intake** — the loading bay, and the first station goods reach.
      ///
      /// The order of these three is the order the work happens in, and it is
      /// a control rather than a convenience: a delivery is *opened*, then
      /// *counted* by somebody who is not shown what was ordered, then
      /// *verified* by somebody else who is shown everything. Only that last
      /// step turns goods into stock. Two people is a database constraint, not
      /// a policy.
      label: "Intake",
      items: [
        {
          path: "/operations/intake",
          label: "Deliveries",
          icon: Truck,
          useCount: useReceipts,
        },
        { path: "/operations/intake/count", label: "Count", icon: ScanBarcode },
        {
          path: "/operations/intake/verify",
          label: "Verify",
          icon: ClipboardCheck,
          useCount: useToVerify,
          badge: "warn",
        },
        {
          path: "/operations/intake/direct",
          label: "Direct intake",
          icon: PackagePlus,
        },
      ],
    },
    {
      /// **Tagging** — where a counted quantity becomes that many tracked
      /// pieces. The EPCs arrive as finished strings from the centre: the DC
      /// prints them and never computes one. Confirming a job is what actually
      /// puts the units into the warehouse.
      label: "Tagging",
      items: [
        {
          path: "/operations/tagging",
          label: "Jobs",
          icon: Tags,
          useCount: useTagging,
          badge: "warn",
        },
        {
          path: "/operations/tagging/bench",
          label: "Print bench",
          icon: Printer,
        },
      ],
    },
    {
      /// **Counting** — the racks measured against what the ledger believes.
      /// A difference is not a fact until the count is submitted, and not an
      /// adjustment until the centre approves it.
      label: "Counting",
      items: [
        {
          path: "/operations/counting",
          label: "Counts",
          icon: ClipboardList,
          useCount: useCounts,
          badge: "warn",
        },
        {
          path: "/operations/counting/sheet",
          label: "Count sheet",
          icon: ScanLine,
        },
        {
          path: "/operations/counting/stock",
          label: "Pools",
          icon: Boxes,
          useCount: useMissing,
          badge: "bad",
        },
        {
          path: "/operations/counting/ledger",
          label: "Ledger",
          icon: ScrollText,
        },
      ],
    },
    {
      /// **Picking** — a SKU and a number, off a rack. There is no destination
      /// anywhere in this station, and that is the design: which shop each
      /// piece serves is settled at the box.
      label: "Picking",
      items: [
        {
          path: "/operations/picking",
          label: "Picklist",
          icon: ListChecks,
          useCount: usePickLines,
          badge: "warn",
        },
        { path: "/operations/picking/rounds", label: "Rounds", icon: Route },
        {
          path: "/operations/picking/lines",
          label: "Line position",
          icon: MapPin,
        },
      ],
    },
    {
      /// **Packing** — the box, which is where the outbound flow decides
      /// something. Putting a piece in a box for a store is what fulfils an
      /// allotment line; until the lid closes nothing here belongs to any shop.
      label: "Packing",
      items: [
        {
          path: "/operations/packing",
          label: "Boxes",
          icon: Boxes,
          useCount: useOpenBoxes,
          badge: "warn",
        },
        {
          path: "/operations/packing/fill",
          label: "Fill a box",
          icon: PackageCheck,
        },
        {
          path: "/operations/packing/sweep",
          label: "Target & sweep",
          icon: Radar,
        },
        { path: "/operations/packing/rounds", label: "Rounds", icon: Route },
      ],
    },
    {
      /// **Despatch** — boxes gather into a consignment, consignments onto a
      /// truck. The documents say who is carrying what and touch no stock; the
      /// stock moves a carton at a time. Every action here does both.
      label: "Despatch",
      items: [
        {
          path: "/operations/despatch",
          label: "Consignments",
          icon: FileText,
          useCount: useLooseBoxes,
          badge: "warn",
        },
        {
          path: "/operations/despatch/trucks",
          label: "Trucks",
          icon: Truck,
          useCount: useOnYard,
        },
        {
          path: "/operations/despatch/destinations",
          label: "Destinations",
          icon: Store,
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
