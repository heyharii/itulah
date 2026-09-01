import { Boxes, PackageCheck, Radar, Route } from "lucide-react"

import type { Station } from "@/lib/navigation"

/// **Packing** — the box, which is where the outbound flow decides something.
///
/// Picking fetched a SKU for nobody in particular. Putting a piece in a box
/// for a store is what fulfils an allotment line — the oldest one still
/// wanting that SKU for that store, chosen by the server, not by the packer.
/// Until the lid closes nothing in this warehouse belongs to any shop.
export const packingNav: Station = {
  id: "packing",
  label: "Packing",
  does: "Choose the store, fill the box, seal it",
  icon: PackageCheck,
  mesh: { c1: "#ffd3e4", c2: "#e2c9ff", c3: "#d65b95", base: "#e076a8" },
  home: "/packing",
  waiting: (w) => w.openBoxes,
  sections: [
    {
      items: [
        {
          path: "/packing",
          label: "Boxes",
          icon: Boxes,
          waiting: (w) => w.openBoxes,
          tone: "warn",
        },
        { path: "/packing/fill", label: "Fill a box", icon: PackageCheck },
        { path: "/packing/sweep", label: "Target & sweep", icon: Radar },
        { path: "/packing/rounds", label: "Rounds", icon: Route },
      ],
    },
  ],
}
