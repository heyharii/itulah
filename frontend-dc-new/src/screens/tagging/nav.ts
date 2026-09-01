import { Printer, Tags } from "lucide-react"

import type { Station } from "@/lib/navigation"

/// **Tagging** — where a counted quantity becomes that many tracked pieces.
///
/// Accepted goods are a number. Tagging is the moment each garment gets an
/// identity, and the EPCs on these screens arrived as finished strings from
/// the centre: the DC prints them and never computes one. Confirming a job is
/// what actually puts the units into the warehouse.
export const taggingNav: Station = {
  id: "tagging",
  label: "Tagging",
  does: "Print the labels, then say they are on",
  icon: Tags,
  mesh: { c1: "#ffd7b0", c2: "#ffc0d6", c3: "#e0823c", base: "#ef9a58" },
  home: "/tagging",
  waiting: (w) => w.tagging,
  sections: [
    {
      items: [
        {
          path: "/tagging",
          label: "Jobs",
          icon: Tags,
          waiting: (w) => w.tagging,
          tone: "warn",
        },
        { path: "/tagging/bench", label: "Print bench", icon: Printer },
      ],
    },
  ],
}
