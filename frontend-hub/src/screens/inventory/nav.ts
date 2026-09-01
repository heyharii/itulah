import {
  Boxes,
  CalendarClock,
  ClipboardCheck,
  Gauge,
  History,
  PackageSearch,
  PackageX,
  Radar,
  Scale,
  ShieldCheck,
  Truck,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's place in the rail and everything under it in the sidebar.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// The four groups are the four questions asked of stock, in the order they
/// get asked: **what is there** (overview, availability, pools), **where is it
/// going** (allotments), **is it really there** (counts, sightings, missing,
/// transfer reconciliation) and **do the books add up** (as-of, control, the
/// time machine).
///
/// Two entries the first draft carried are gone on purpose. `Movements` had no
/// list of its own to stand on — `GET /inventory/movements` belongs to another
/// module's slice, and the movements this module can show are already inside
/// the pool it happened in. `Returns` was a nav entry with no endpoint at all:
/// a return here is an allotment of type `RETURN_TO_DC` or
/// `RETURN_TO_SUPPLIER`, and it is filtered for on the allotments screen
/// rather than pretending to be a separate book.
export const inventoryNav: AppModule = {
  id: "inventory",
  label: "Inventory",
  icon: Boxes,
  mesh: { c1: "#9cefd6", c2: "#a3d6ff", c3: "#34bd9d", base: "#45c9a8" },
  home: "/inventory",
  sections: [
    {
      items: [
        { path: "/inventory", label: "Overview", icon: Gauge },
        {
          path: "/inventory/availability",
          label: "Availability",
          icon: PackageSearch,
        },
        { path: "/inventory/pools", label: "Pools", icon: Boxes },
      ],
    },
    {
      label: "Distribution",
      items: [
        { path: "/inventory/allotments", label: "Allotments", icon: Truck },
      ],
    },
    {
      label: "Counting",
      items: [
        { path: "/inventory/counts", label: "Counts", icon: ClipboardCheck },
        { path: "/inventory/observations", label: "Sightings", icon: Radar },
        {
          path: "/inventory/missing",
          label: "Missing",
          icon: PackageX,
          badge: "warn",
        },
        {
          path: "/inventory/reconciliations",
          label: "Reconciliations",
          icon: Scale,
        },
      ],
    },
    {
      label: "Ledger",
      items: [
        { path: "/inventory/as-of", label: "As of", icon: CalendarClock },
        { path: "/inventory/control", label: "Control", icon: ShieldCheck },
        {
          path: "/inventory/time-machine",
          label: "Time machine",
          icon: History,
        },
      ],
    },
  ],
}
