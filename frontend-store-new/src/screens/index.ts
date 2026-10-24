import type { ScreenLoaders } from "@/screens/registry"

/// Path → the screen's own chunk. `routes.tsx` builds the router from
/// `lib/navigation.ts` and looks each path up here, and it throws at module
/// load if either list has an entry the other does not.
///
/// **Every screen is fetched when it is opened, not with the entry.** This map
/// used to import all 37 of them statically, which put every screen — and, through the
/// money screens, the whole charting library (recharts + d3) — into the one
/// chunk a till downloads before it can show anything. Measured 2026-10-10 at
/// 456 KB gzipped; a counter tab does not need the HR screens or a line chart.
/// The loaders are wrapped with `lazyRouteComponent` in `routes.tsx`, so the
/// router treats a slow chunk like a slow render: the screen's own data starts
/// moving when its code does.
export const screens: ScreenLoaders = {
  "/ga": () =>
    import("@/screens/ga/overview").then((module) => ({ default: module.GaOverview })),
  "/ga/assets": () =>
    import("@/screens/ga/assets").then((module) => ({ default: module.Assets })),
  "/ga/contracts": () =>
    import("@/screens/ga/contracts").then((module) => ({ default: module.Contracts })),
  "/ga/servicing": () =>
    import("@/screens/ga/servicing").then((module) => ({ default: module.Servicing })),
  "/ga/repairs": () =>
    import("@/screens/ga/repairs").then((module) => ({ default: module.Repairs })),
  "/ga/supplies": () =>
    import("@/screens/ga/supplies").then((module) => ({ default: module.Supplies })),
  "/news": () =>
    import("@/screens/discuss").then((module) => ({ default: module.Discuss })),
  "/catalogue": () =>
    import("@/screens/catalogue").then((module) => ({ default: module.Catalogue })),
  "/promotions": () =>
    import("@/screens/promotions/promotions").then((module) => ({ default: module.Promotions })),
  "/promotions/campaigns": () =>
    import("@/screens/promotions/campaigns").then((module) => ({ default: module.Campaigns })),
  "/promotions/price-changes": () =>
    import("@/screens/promotions/price-drops").then((module) => ({ default: module.PriceDrops })),
  "/promotions/vouchers": () =>
    import("@/screens/promotions/vouchers").then((module) => ({ default: module.Vouchers })),
  "/receive": () =>
    import("@/screens/receive").then((module) => ({ default: module.Receive })),
  "/stock": () =>
    import("@/screens/stock").then((module) => ({ default: module.Stock })),
  "/stock/count": () =>
    import("@/screens/count").then((module) => ({ default: module.Count })),
  "/stock/returns": () =>
    import("@/screens/return-to-ho").then((module) => ({ default: module.ReturnToHo })),
  "/stock/movements": () =>
    import("@/screens/movements").then((module) => ({ default: module.Movements })),
  "/dashboard": () =>
    import("@/screens/dashboard/dashboard").then((module) => ({ default: module.Dashboard })),
  "/money/sales": () =>
    import("@/screens/money/sales").then((module) => ({ default: module.Sales })),
  "/money/unmatched": () =>
    import("@/screens/money/unmatched").then((module) => ({ default: module.UnmatchedSales })),
  "/money/reconciliation": () =>
    import("@/screens/money/reconciliation").then((module) => ({ default: module.Reconciliation })),
  "/money/petty-cash": () =>
    import("@/screens/money/petty-cash").then((module) => ({ default: module.PettyCash })),
  "/money/cash-count": () =>
    import("@/screens/money/cash-count").then((module) => ({ default: module.CashCount })),
  "/hr/overview": () =>
    import("@/screens/hr/today").then((module) => ({ default: module.HrToday })),
  "/hr/roster": () =>
    import("@/screens/hr/roster").then((module) => ({ default: module.HrRoster })),
  "/hr/leave": () =>
    import("@/screens/hr/requests").then((module) => ({ default: module.HrLeave })),
  "/hr/directory": () =>
    import("@/screens/hr/team").then((module) => ({ default: module.HrTeam })),
  "/hr/overtime": () =>
    import("@/screens/hr/overtime").then((module) => ({ default: module.HrOvertime })),
  "/hr/recruitment": () =>
    import("@/screens/hr/interviews").then((module) => ({ default: module.HrInterviews })),
  "/hr/lifecycle": () =>
    import("@/screens/hr/tasks").then((module) => ({ default: module.HrTasks })),
  "/hr/pay": () =>
    import("@/screens/hr/pay").then((module) => ({ default: module.HrPay })),
  "/hr/payroll": () =>
    import("@/screens/hr/period").then((module) => ({ default: module.HrPeriod })),
  "/hr/attendance": () =>
    import("@/screens/hr/attendance").then((module) => ({ default: module.HrAttendance })),
  "/hr/expenses": () =>
    import("@/screens/hr/expenses").then((module) => ({ default: module.HrExpenses })),
  "/hr/benefits": () =>
    import("@/screens/hr/benefits").then((module) => ({ default: module.HrBenefits })),
  "/hr/changes": () =>
    import("@/screens/hr/changes").then((module) => ({ default: module.HrChanges })),
  "/node/sync": () =>
    import("@/screens/sync").then((module) => ({ default: module.SyncScreen })),
  "/node/password": () =>
    import("@/screens/password").then((module) => ({ default: module.Password })),
}
