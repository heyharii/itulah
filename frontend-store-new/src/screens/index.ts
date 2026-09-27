import { Assets } from "@/screens/ga/assets"
import { Contracts } from "@/screens/ga/contracts"
import { GaOverview } from "@/screens/ga/overview"
import { Repairs } from "@/screens/ga/repairs"
import { Servicing } from "@/screens/ga/servicing"
import { Supplies } from "@/screens/ga/supplies"
import { Catalogue } from "@/screens/catalogue"
import { Expenses } from "@/screens/money/expenses"
import { HrAttendance } from "@/screens/hr/attendance"
import { HrBenefits } from "@/screens/hr/benefits"
import { HrChanges } from "@/screens/hr/changes"
import { HrExpenses } from "@/screens/hr/expenses"
import { HrInterviews } from "@/screens/hr/interviews"
import { HrTraining } from "@/screens/hr/training"
import { HrOvertime } from "@/screens/hr/overtime"
import { HrPeriod } from "@/screens/hr/period"
import { HrPerformance } from "@/screens/hr/performance"
import { HrTasks } from "@/screens/hr/tasks"
import { HrLeave } from "@/screens/hr/requests"
import { HrRoster } from "@/screens/hr/roster"
import { HrTeam } from "@/screens/hr/team"
import { HrToday } from "@/screens/hr/today"
import { Movements } from "@/screens/movements"
import { News } from "@/screens/news"
import { Campaigns } from "@/screens/promotions/campaigns"
import { PriceDrops } from "@/screens/promotions/price-drops"
import { Promotions } from "@/screens/promotions/promotions"
import { Vouchers } from "@/screens/promotions/vouchers"
import { Password } from "@/screens/password"
import { Product } from "@/screens/product"
import { Reconciliation } from "@/screens/money/reconciliation"
import { Receive } from "@/screens/receive"
import { Reports } from "@/screens/money/reports"
import { Sales } from "@/screens/money/sales"
import { Stock } from "@/screens/stock"
import { SyncScreen } from "@/screens/sync"
import type { ScreenMap } from "@/screens/registry"

/// Path → screen. `routes.tsx` builds the router from `lib/navigation.ts` and
/// looks each path up here, and it throws at module load if either list has an
/// entry the other does not. Eighteen screens, eighteen nav entries, and no
/// placeholders: a tab that opens on "not built yet" in front of a customer is
/// worse than no tab at all.
export const screens: ScreenMap = {
  // General affairs: head office's too, through the same gate as HR, and
  // always about this node's own site.
  "/ga": GaOverview,
  "/ga/assets": Assets,
  "/ga/contracts": Contracts,
  "/ga/servicing": Servicing,
  "/ga/repairs": Repairs,
  "/ga/supplies": Supplies,
  "/news": News,
  "/catalogue": Catalogue,
  "/catalogue/product": Product,
  "/promotions": Promotions,
  "/promotions/campaigns": Campaigns,
  "/promotions/price-drops": PriceDrops,
  "/promotions/vouchers": Vouchers,
  "/receive": Receive,
  "/stock": Stock,
  "/stock/movements": Movements,
  "/reports": Reports,
  "/money/sales": Sales,
  "/money/reconciliation": Reconciliation,
  "/money/expenses": Expenses,
  // The only screens in this app answered by head office rather than by the
  // node behind the counter. They live in their own folder because they share
  // a gate — relayed through this node, and locked to this node's own site —
  // and because "which server answers this" is the sharpest line in the app.
  "/hr/overview": HrToday,
  "/hr/roster": HrRoster,
  "/hr/leave": HrLeave,
  "/hr/directory": HrTeam,
  "/hr/overtime": HrOvertime,
  "/hr/recruitment": HrInterviews,
  "/hr/lifecycle": HrTasks,
  "/hr/performance": HrPerformance,
  "/hr/payroll": HrPeriod,
  "/hr/attendance": HrAttendance,
  "/hr/expenses": HrExpenses,
  "/hr/benefits": HrBenefits,
  "/hr/changes": HrChanges,
  "/hr/training": HrTraining,
  "/node/sync": SyncScreen,
  "/node/password": Password,
}
