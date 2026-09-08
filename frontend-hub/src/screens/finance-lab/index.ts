import type { ScreenMap } from "@/screens/registry"

import { LabAccruals } from "@/screens/finance-lab/accruals"
import { LabAssets } from "@/screens/finance-lab/assets"
import { LabCashBank } from "@/screens/finance-lab/cash"
import { LabClose } from "@/screens/finance-lab/close"
import { LabContract } from "@/screens/finance-lab/contract"
import { LabCoverage } from "@/screens/finance-lab/coverage"
import { LabInterunit } from "@/screens/finance-lab/interunit"
import { LabOverview } from "@/screens/finance-lab/overview"
import { Scenarios } from "@/screens/finance-lab/scenarios"

/// Every screen this module has. All nine are written; none is a placeholder,
/// because a lab whose menu has dead entries is a lab that teaches the wrong
/// lesson about what has been proved.
export const screens: ScreenMap = {
  "/finance-lab": LabOverview,
  "/finance-lab/scenarios": Scenarios,
  "/finance-lab/assets": LabAssets,
  "/finance-lab/cash": LabCashBank,
  "/finance-lab/accruals": LabAccruals,
  "/finance-lab/interunit": LabInterunit,
  "/finance-lab/close": LabClose,
  "/finance-lab/contract": LabContract,
  "/finance-lab/coverage": LabCoverage,
}
