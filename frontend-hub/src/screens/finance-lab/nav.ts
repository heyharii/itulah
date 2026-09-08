import {
  Archive,
  FlaskConical,
  Landmark,
  LayoutGrid,
  ListChecks,
  ScrollText,
  Split,
  Wallet,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// The Finance lab's row in the sidebar.
///
/// # Why this is a module of its own and not five screens inside Finance
///
/// Because everything under it is SIMULATED, and the one thing a finance
/// surface must never do is let a person mistake a rehearsal for the books. A
/// simulated trial balance sitting three rows below the real one, in the same
/// module, with the same icon, is a screenshot waiting to be misread in a
/// meeting. A separate module with its own name and a Simulasi badge on every
/// page is the cheap version of that guarantee.
///
/// It is also why the paths do not shadow Finance's: `/finance-lab/close` and
/// `/finance/periods` are different URLs on purpose, so a bookmark cannot land
/// somebody in the wrong one.
///
/// The five screens under Prioritas are the five §8 asks for, in the order it
/// asks for them. Skenario sits above them because it is the reason the module
/// exists: it is where a claim gets checked rather than described.
export const financeLabNav: AppModule = {
  id: "finance-lab",
  label: "Finance lab",
  icon: FlaskConical,
  home: "/finance-lab",
  sections: [
    {
      items: [
        { path: "/finance-lab", label: "Overview", icon: Landmark },
        { path: "/finance-lab/scenarios", label: "Skenario", icon: ListChecks },
      ],
    },
    {
      /// The five priority flows, in §8's order.
      label: "Prioritas",
      items: [
        { path: "/finance-lab/assets", label: "Assets & Projects", icon: Archive },
        { path: "/finance-lab/cash", label: "Cash & Bank", icon: Wallet },
        { path: "/finance-lab/accruals", label: "Accruals / YMHD", icon: ScrollText },
        { path: "/finance-lab/interunit", label: "Interunit & Principal", icon: Split },
        { path: "/finance-lab/close", label: "Accounting & Close", icon: Landmark },
      ],
    },
    {
      label: "Kontrak",
      items: [
        { path: "/finance-lab/contract", label: "Aturan & peta akun", icon: ScrollText },
        { path: "/finance-lab/coverage", label: "Cakupan menu", icon: LayoutGrid },
      ],
    },
  ],
}
