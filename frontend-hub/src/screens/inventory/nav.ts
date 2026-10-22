import {
  ArrowLeftRight,
  BookOpenCheck,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  History,
  PackageSearch,
  PackageX,
  Radar,
  Scale,
  ShieldCheck,
  Workflow,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import { useMissingCount } from "@/screens/inventory/missing-data"

/// This module's row in the sidebar and the sub-items under it.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// # Four rows
///
/// **Stock** — the store-cards board, one card per place the fleet stands in —
/// **Missing**, the pieces the readings cannot find (it replaced Exceptions, 19
/// Oct 2026), **Counts** and the **Stock card**. The other screens (Observations,
/// Movements, As of, Control, Time machine…) stay routed, linkable and in ⌘K,
/// because `hidden` only means "not a sub-item".
///
/// What the earlier collapse buried were the three surfaces that are not
/// readings of stock at all:
///
/// - **Counts** is the only thing in this app allowed to tell the ledger it is
///   wrong. It has a lifecycle, an approval and a history, and a person opens
///   one deliberately rather than arriving at it from a number.
/// - **Movements** is the ledger itself. Every other screen shows a balance;
///   this shows the postings the balance is made of, which is what somebody
///   needs when the balance is wrong and they do not yet know which shelf to
///   blame.
/// - **Sightings** is the evidence, from a machine rather than the ledger, and
///   it is *deliberately* not the same list as Movements: reading a tag has
///   never moved a piece and never will.
///
/// The test is not "is this about inventory" — everything here is. It is
/// whether somebody would go looking for it by name. A reading is arrived at;
/// a record is sought.
///
/// **Allotments left the module entirely**, for the same test read the other
/// way: it is not a reading of stock, it is an instruction to move some.
///
/// The work it creates is Picking, which lives in Operations, and it sits
/// there now in front of the picklist it fills.
///
/// The rest stay declared here, and that is what keeps them routed: each is a
/// place somebody *arrives at* from the one page — a pool sheet, a count, a
/// missing unit — rather than one they set out for. Deleting them is a decision
/// about capability, not about a sidebar, so it is not made here.
export const inventoryNav: AppModule = {
  id: "inventory",
  label: "Inventory",
  icon: Boxes,
  home: "/inventory",
  sections: [
    {
      items: [
        { path: "/inventory", label: "Stock", icon: Boxes },
        {
          path: "/inventory/missing",
          label: "Missing",
          icon: PackageX,
          useCount: useMissingCount,
          badge: "warn",
        },
        {
          path: "/inventory/availability",
          label: "On Hand & Shortfall",
          icon: PackageSearch,
          hidden: true,
        },
        { path: "/inventory/pools", label: "Pools", icon: Boxes, hidden: true },
        { path: "/inventory/counts", label: "Counts", icon: ClipboardCheck },
        // The stock card took Movements' row (owner, 16 Oct 2026): Inventory
        // reads the period's equation and the balance after every line; the
        // raw ledger stays routed and in ⌘K for whoever checks a posting.
        {
          path: "/inventory/stock-card",
          label: "Stock card",
          icon: BookOpenCheck,
        },
        {
          path: "/inventory/movements",
          label: "Movements",
          icon: ArrowLeftRight,
          hidden: true,
        },
        // Observations stays routed (a place's sheet links to it) and in ⌘K;
        // it is no longer a sidebar row.
        {
          path: "/inventory/observations",
          label: "Observations",
          icon: Radar,
          hidden: true,
        },
        // Flow templates (0615-0619): the order of stages each route of goods
        // runs, who raises its plan and who does each stage. Sought by name —
        // an Admin setting up a new route goes looking for it — so it is a
        // sub-item. The owner's "Alur barang", in English with the rest of
        // the hub (27 Sep). Relabelled "Flows" on the owner's menu of
        // 2026-09-28. Out of the sidebar on the owner's word (3 Oct 2026);
        // still routed and in ⌘K.
        {
          path: "/inventory/flows",
          label: "Flows",
          icon: Workflow,
          hidden: true,
        },
        {
          path: "/inventory/reconciliations",
          label: "Reconciliations",
          icon: Scale,
          hidden: true,
        },
        {
          path: "/inventory/as-of",
          label: "As of",
          icon: CalendarClock,
          hidden: true,
        },
        {
          path: "/inventory/control",
          label: "Control",
          icon: ShieldCheck,
          hidden: true,
        },
        {
          path: "/inventory/time-machine",
          label: "Time Machine",
          icon: History,
          hidden: true,
        },
      ],
    },
  ],
}
