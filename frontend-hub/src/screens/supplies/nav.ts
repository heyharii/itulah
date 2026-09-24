import { Package } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Supplies — what a place runs out of.
///
/// # What this is not
///
/// Not customer supplies, which Commercial spends on the shopper's behalf, and
/// not shopping bags, which Inventory holds as stock. Both have their own
/// category and their own owner, and a GA request that could name either would
/// be the department booking somebody else's cost. The categories this screen
/// offers are the seven the client's own chart gives GA.
///
/// # Why the stages are the screen
///
/// A request is asked for, approved, ordered, received and billed, and each
/// stage has a different owner: GA approves, Procurement orders and receives,
/// Finance records the bill. The screen shows the stage rather than a status,
/// because "where is it" is the question somebody asks, and the answer names
/// who has it now.
///
/// # Why there is no purchase order here
///
/// Because there is no non-merchandise purchase order in this estate yet. The
/// request carries a `po_id` when one exists and the stage moves without one,
/// which is honest about the gap rather than a second Procurement built in GA.
/// See the stage report for what is still open.
export const gaSuppliesNav: AppModule = {
  id: "ga-supplies",
  label: "Supplies",
  icon: Package,
  home: "/supplies",
  // Declared now, inert, so the GA column reads whole before the screen lands.
  soon: true,
  sections: [{ items: [{ path: "/supplies", label: "Supplies", icon: Package }] }],
}
