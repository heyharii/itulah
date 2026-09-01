import { Boxes, ClipboardList, ScanLine, ScrollText } from "lucide-react"

import type { Station } from "@/lib/navigation"

/// **Counting** — the racks measured against what the ledger believes.
///
/// Official counts are authored and activated at the centre and executed
/// here. A difference is not a fact until the count is submitted, and it does
/// not become an adjustment until the centre approves it — so nothing on
/// these screens writes stock except the two corrections that say plainly
/// that they are corrections.
export const countingNav: Station = {
  id: "counting",
  label: "Counting",
  does: "Count the racks, and read the ledger",
  icon: ClipboardList,
  mesh: { c1: "#c6ecd4", c2: "#b8e2ff", c3: "#46a06a", base: "#5cb37f" },
  home: "/counting",
  waiting: (w) => w.counts,
  sections: [
    {
      items: [
        {
          path: "/counting",
          label: "Counts",
          icon: ClipboardList,
          waiting: (w) => w.counts,
          tone: "warn",
        },
        { path: "/counting/sheet", label: "Count sheet", icon: ScanLine },
        {
          path: "/counting/stock",
          label: "Pools",
          icon: Boxes,
          waiting: (w) => w.missing,
          tone: "bad",
        },
        { path: "/counting/ledger", label: "Ledger", icon: ScrollText },
      ],
    },
  ],
}
