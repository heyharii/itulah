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
      items: [
        { path: "/stores", label: "Stores", icon: Store },
        {
          path: "/stores/exceptions",
          label: "Exceptions",
          icon: AlertTriangle,
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
