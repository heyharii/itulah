import {
  ArrowLeftRight,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  History,
  PackageSearch,
  PackageX,
  Radar,
  Ruler,
  Scale,
  ShieldCheck,
  Workflow,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's row in the sidebar and the sub-items under it.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// # Four rows, and why not eleven
///
/// This was eleven screens in four groups, then one, and is now four. The
/// collapse to one was right about the readings and wrong about the records:
/// Overview, Pools and Sightings *were* three readings of the same fleet, and
/// As of, Control and Time machine three ways of doubting it — none of those
/// is a destination somebody sets out for, and all of them are still routed,
/// still linkable and still in ⌘K, because `hidden` only means "not a
/// sub-item".
///
/// What the collapse also buried were the three surfaces that are not readings
/// of stock at all:
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
          path: "/inventory/availability",
          label: "Availability",
          icon: PackageSearch,
          hidden: true,
        },
        { path: "/inventory/pools", label: "Pools", icon: Boxes, hidden: true },
        { path: "/inventory/counts", label: "Counts", icon: ClipboardCheck },
        {
          path: "/inventory/movements",
          label: "Movements",
          icon: ArrowLeftRight,
        },
        { path: "/inventory/observations", label: "Sightings", icon: Radar },
        // Master data rather than a reading: the units an order may be
        // typed in, and how many pieces each is. Sought by name — a buyer
        // setting up KODI goes looking for it — so it is a sub-item.
        {
          path: "/inventory/units",
          label: "Units & conversions",
          icon: Ruler,
        },
        // Flow templates (0615-0619): the order of stages each route of goods
        // runs, who raises its plan and who does each stage. Sought by name —
        // an Admin setting up a new route goes looking for it — so it is a
        // sub-item. The owner's "Alur barang", in English with the rest of
        // the hub (27 Sep).
        {
          path: "/inventory/flows",
          label: "Goods flows",
          icon: Workflow,
        },
        {
          path: "/inventory/missing",
          label: "Missing",
          icon: PackageX,
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
          label: "Time machine",
          icon: History,
          hidden: true,
        },
      ],
    },
  ],
}
