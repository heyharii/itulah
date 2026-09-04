import { Truck } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Goods promised out of a pool, and where they are promised to.
///
/// # Why this is a row of its own
///
/// It left Inventory because it is not a reading of stock — it is an
/// instruction to move some. Inventory answers *what is held and can the
/// number be trusted*; an allotment answers *what leaves, for whom*. Filing a
/// verb under a module named after a noun is how that sidebar reached eleven
/// rows.
///
/// **And it did not go into Operations, though the picking it creates lives
/// there.** Every screen in that module is wrapped in `OperationsGate` — the
/// DC node's own sign-in — because every one of them reads an edge. An
/// allotment is raised at the centre against the cloud ledger, so filing it
/// there would demand a warehouse login before anybody could read a cloud
/// list. The module's own comment calls the gate "one decision about a whole
/// module", and breaking that to save a sidebar row is the wrong trade.
///
/// One screen, so the row does not unfold: the shell opens a module only when
/// it has more than one visible item, the same rule that keeps Home from
/// growing a chevron over a single "Brief".
export const distributionNav: AppModule = {
  id: "distribution",
  label: "Distribution",
  icon: Truck,
  home: "/distribution",
  sections: [
    {
      items: [{ path: "/distribution", label: "Allotments", icon: Truck }],
    },
  ],
}
