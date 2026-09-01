import { ClipboardCheck, PackagePlus, ScanBarcode, Truck } from "lucide-react"

import type { Station } from "@/lib/navigation"

/// **Intake** — the loading bay, and the first station goods reach.
///
/// The order of the sidebar is the order the work happens in, and it is worth
/// naming because the sequence is a control rather than a convenience: a
/// delivery is *opened*, then *counted* by somebody who is not shown what was
/// ordered, then *verified* by somebody else who is shown everything. Only
/// that last step turns goods into stock. Two people is a database
/// constraint, not a policy — so the two screens are separate, and neither
/// carries the other's numbers.
export const intakeNav: Station = {
  id: "intake",
  label: "Intake",
  does: "Deliveries counted blind, then verified",
  icon: Truck,
  mesh: { c1: "#b6ccff", c2: "#c9bcff", c3: "#5a7cec", base: "#6b8bf0" },
  home: "/intake",
  waiting: (w) => w.receipts + w.toVerify,
  sections: [
    {
      items: [
        {
          path: "/intake",
          label: "Deliveries",
          icon: Truck,
          waiting: (w) => w.receipts,
          tone: "info",
        },
        {
          path: "/intake/count",
          label: "Count",
          icon: ScanBarcode,
        },
        {
          path: "/intake/verify",
          label: "Verify",
          icon: ClipboardCheck,
          waiting: (w) => w.toVerify,
          tone: "warn",
        },
      ],
    },
    {
      label: "Outside the flow",
      items: [
        { path: "/intake/direct", label: "Direct intake", icon: PackagePlus },
      ],
    },
  ],
}
