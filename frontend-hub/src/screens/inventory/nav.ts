import {
  Boxes,
  CalendarClock,
  ClipboardCheck,
  History,
  PackageSearch,
  PackageX,
  Radar,
  Scale,
  ShieldCheck,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's row in the sidebar and the sub-items under it.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// # One row, and why
///
/// This was eleven screens in four groups. It is now one, and the ten that
/// went are still routed, still linkable and still in ⌘K — `hidden` only means
/// "not a sub-item". The module does not unfold at all, because the shell
/// unfolds a module only when it has more than one visible item, which is the
/// same rule that keeps Home from growing a chevron over a single "Brief".
///
/// The argument is not that ten screens were wrong. It is that they were ten
/// answers to one question — *where is the stock and can I trust the number* —
/// and asking somebody to pick which of ten screens holds this morning's
/// version of that question is asking them to know the answer first. Overview,
/// Pools and Sightings were three readings of the same fleet; As of, Control
/// and Time machine were three ways of doubting it. `/inventory` now carries
/// the whole of it: what is held, what stops anybody being sure of it, and
/// every pool it is standing in.
///
/// **Allotments left the module entirely.** It is not a reading of stock, it
/// is an instruction to move some — and the work it creates is Picking, which
/// lives in Operations. It sits there now, in front of the picklist it fills.
/// Filing a verb under a module named after a noun is what made this sidebar
/// eleven rows deep in the first place.
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
        {
          path: "/inventory/counts",
          label: "Counts",
          icon: ClipboardCheck,
          hidden: true,
        },
        {
          path: "/inventory/observations",
          label: "Sightings",
          icon: Radar,
          hidden: true,
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
