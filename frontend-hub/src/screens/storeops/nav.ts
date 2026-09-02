import { Gauge, Receipt, RotateCcw, Store, UserRound } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's place in the rail and everything under it in the sidebar.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// Returns and Member are listed separately from Sales rather than folded into
/// it. They are different documents against the same trade — a refund is its
/// own record and never an edit of a sale — and a member's history is asked by
/// a different person for a different reason.
export const storeopsNav: AppModule = {
  id: "storeops",
  label: "Store ops",
  icon: Store,
  tint: { top: "#ffc65c", bottom: "#f58600" },
  home: "/storeops",
  sections: [
    {
      items: [
        { path: "/storeops", label: "Overview", icon: Gauge },
        { path: "/storeops/sales", label: "Sales", icon: Receipt },
        { path: "/storeops/returns", label: "Returns", icon: RotateCcw },
        { path: "/storeops/stores", label: "Stores", icon: Store },
        { path: "/storeops/customer", label: "Member", icon: UserRound },
      ],
    },
  ],
}
