import { Assets } from "@/screens/ga/assets"
import { Contracts } from "@/screens/ga/contracts"
import { GaOverview } from "@/screens/ga/overview"
import { Repairs } from "@/screens/ga/repairs"
import { Servicing } from "@/screens/ga/servicing"
import { Supplies } from "@/screens/ga/supplies"
import { Catalogue } from "@/screens/catalogue"
import { CashCount } from "@/screens/money/cash-count"
import { Expenses } from "@/screens/money/expenses"
import { HrAttendance } from "@/screens/hr/attendance"
import { HrBenefits } from "@/screens/hr/benefits"
import { HrChanges } from "@/screens/hr/changes"
import { HrExpenses } from "@/screens/hr/expenses"
import { HrInterviews } from "@/screens/hr/interviews"
import { HrOvertime } from "@/screens/hr/overtime"
import { HrPeriod } from "@/screens/hr/period"
import { HrTasks } from "@/screens/hr/tasks"
import { HrLeave } from "@/screens/hr/requests"
import { HrRoster } from "@/screens/hr/roster"
import { HrTeam } from "@/screens/hr/team"
import { HrToday } from "@/screens/hr/today"
import { Count } from "@/screens/count"
import { Movements } from "@/screens/movements"
import { Discuss } from "@/screens/discuss"
import { Campaigns } from "@/screens/promotions/campaigns"
import { Vouchers } from "@/screens/promotions/vouchers"
import { PriceDrops } from "@/screens/promotions/price-drops"
import { Promotions } from "@/screens/promotions/promotions"
import { Password } from "@/screens/password"
import { Product } from "@/screens/product"
import { ReconciliationSoon } from "@/screens/money/coming-soon"
import { Receive } from "@/screens/receive"
import { Reports } from "@/screens/money/reports"
import { Sales } from "@/screens/money/sales"
import { ReturnToHo } from "@/screens/return-to-ho"
import { Stock } from "@/screens/stock"
import { SyncScreen } from "@/screens/sync"
import { TillApprovals } from "@/screens/till-approvals"
import type { ScreenMap } from "@/screens/registry"

/// Path → screen. `routes.tsx` builds the router from `lib/navigation.ts` and
/// looks each path up here, and it throws at module load if either list has an
/// entry the other does not. One screen per nav entry, and no
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
  "/news": Discuss,
  "/catalogue": Catalogue,
  "/catalogue/product": Product,
  "/promotions": Promotions,
  "/promotions/campaigns": Campaigns,
  "/promotions/price-changes": PriceDrops,
  "/promotions/vouchers": Vouchers,
  "/receive": Receive,
  "/stock": Stock,
  "/stock/count": Count,
  "/stock/returns": ReturnToHo,
  "/stock/movements": Movements,
  "/reports": Reports,
  "/money/sales": Sales,
  "/money/reconciliation": ReconciliationSoon,
  "/money/expenses": Expenses,
  "/money/cash-count": CashCount,
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
  "/hr/payroll": HrPeriod,
  "/hr/attendance": HrAttendance,
  "/hr/expenses": HrExpenses,
  "/hr/benefits": HrBenefits,
  "/hr/changes": HrChanges,
  "/node/sync": SyncScreen,
  "/node/password": Password,
  "/node/tills": TillApprovals,
}
