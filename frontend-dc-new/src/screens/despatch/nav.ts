import { FileText, Store, Truck } from "lucide-react"

import type { Station } from "@/lib/navigation"

/// **Despatch** — boxes gather into a consignment, consignments onto a truck.
///
/// Two things happen at every step here and they are genuinely separate in the
/// server. The shipment and dispatch documents say *who is carrying what* and
/// touch no stock at all; the stock moves a carton at a time, and each of
/// those writes a movement group. A warehouse that only files the paperwork
/// leaves its goods sitting in `outbound.packed` while the consignment note
/// claims they are on the road — so every action on these screens does both,
/// and reports honestly when a carton did not follow.
export const despatchNav: Station = {
  id: "despatch",
  label: "Despatch",
  does: "Consignments, trucks, and the gate",
  icon: Truck,
  mesh: { c1: "#bfe4ff", c2: "#c9d9ff", c3: "#2f86d8", base: "#4a9ae0" },
  home: "/despatch",
  waiting: (w) => w.looseBoxes + w.onYard,
  sections: [
    {
      items: [
        {
          path: "/despatch",
          label: "Consignments",
          icon: FileText,
          waiting: (w) => w.looseBoxes,
          tone: "warn",
        },
        {
          path: "/despatch/trucks",
          label: "Trucks",
          icon: Truck,
          waiting: (w) => w.onYard,
          tone: "info",
        },
        { path: "/despatch/destinations", label: "Destinations", icon: Store },
      ],
    },
  ],
}
