import { AlertTriangle, Store } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Stores — the owner's own place to open a shop and watch it once it is
/// trading.
///
/// One visible row, `/stores`, the same shape System, Reports and every
/// single-screen module in `asides` takes. `/stores/$unit` is the second path
/// this module answers at: routed and findable — every row on the list opens
/// it, and a pasted link to one store still lands on it — but `hidden` so it
/// is not a second row repeating the module's own name fourteen times over.
export const storesNav: AppModule = {
  id: "stores",
  label: "Stores",
  icon: Store,
  home: "/stores",
  sections: [
    {
      // Both rows `more` since the owner's menu of 2026-09-28: Sales leads
      // the Sales domain now, and Stores sits under its More fold.
      items: [
        { path: "/stores", label: "Stores", icon: Store, more: true },
        {
          path: "/stores/exceptions",
          label: "Exceptions",
          icon: AlertTriangle,
          more: true,
        },
        {
          path: "/stores/$unit",
          label: "Store",
          icon: Store,
          hidden: true,
        },
      ],
    },
  ],
}
