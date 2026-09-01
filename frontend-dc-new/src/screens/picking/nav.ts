import { ListChecks, MapPin, Route } from "lucide-react"

import type { Station } from "@/lib/navigation"

/// **Picking** — a SKU and a number, off a rack.
///
/// There is no destination anywhere in this station, and that is the whole
/// design. Which shop each piece serves is settled at the box, so a picker
/// walks the aisles with a sheet and a quantity and has nothing else to get
/// wrong. A "pick for store 3" control would be asserting a decision nobody
/// has made yet.
export const pickingNav: Station = {
  id: "picking",
  label: "Picking",
  does: "Fetch what is owed, for nobody in particular",
  icon: ListChecks,
  mesh: { c1: "#d9ccff", c2: "#bcd4ff", c3: "#7a5cf0", base: "#8a6cf0" },
  home: "/picking",
  waiting: (w) => w.pickLines,
  sections: [
    {
      items: [
        {
          path: "/picking",
          label: "Picklist",
          icon: ListChecks,
          waiting: (w) => w.pickLines,
          tone: "warn",
        },
        { path: "/picking/rounds", label: "Rounds", icon: Route },
        { path: "/picking/lines", label: "Line position", icon: MapPin },
      ],
    },
  ],
}
