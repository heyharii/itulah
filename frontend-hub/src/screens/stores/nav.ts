import { AlertTriangle, Store } from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import { useStoresWaitingCount } from "@/lib/queries/stores"

/// **Stores** — the owner's own menu to add a shop, open it and watch it once
/// it is trading (owner, 2026-10-24: `store-opening-prototype.html`).
///
/// Its own department on the rail since that day; it was a module of Sales
/// before, and under Master as well. Selecting it opens on All stores, and the
/// panel beside the rail is the module's own (`sidebar`): Add store, a search,
/// All stores with its count, then every store under Getting ready, Open,
/// Stopped and Removed, each with a blue count while something waits for head
/// office (`stores-panel.tsx`). A store opens in the page beside it, on its own
/// tabs — Overview, People, POS, Devices, Server, Status — so the shops are
/// managed one by one.
///
/// One visible row, `/stores`: the panel draws the rest. `/stores/$unit` is
/// the second path this module answers at — every row of the panel and the
/// list opens it, and a pasted link to one store still lands on it — and
/// `/stores/exceptions` stays routed, in ⌘K and one click from the notices
/// that name it, but is not a row of its own. Master › Stores
/// (`/master/stores`) keeps answering with the same screens for the links
/// that name it; nothing links to it any more.
export const storesNav: AppModule = {
  id: "stores",
  label: "Stores",
  icon: Store,
  home: "/stores",
  sidebar: true,
  sections: [
    {
      items: [
        {
          path: "/stores",
          label: "Stores",
          icon: Store,
          // What waits for head office, at every store: new POS asking to
          // join and fingers recorded at the store's POS. The rail wears it
          // as its mark while you are somewhere else.
          badge: "warn",
          useCount: useStoresWaitingCount,
        },
        {
          path: "/stores/exceptions",
          label: "Exceptions",
          icon: AlertTriangle,
          hidden: true,
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
