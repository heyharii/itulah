import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Six of these arrived from Store ops on 2026-09-13 when that module was
/// absorbed — see `nav.ts` for why. Every grouping of the sidebar is the
/// Explorer, which reads its rows off the path (`PAGE_OF`, 16 Oct 2026).
export const screens: ScreenMap = {
  "/sales": lazyScreen(
    "sales/sales",
    () => import("@/screens/sales/sales"),
    (m) => m.Sales
  ),
  "/sales/by-division": lazyScreen(
    "sales/explorer",
    () => import("@/screens/sales/explorer"),
    (m) => m.SalesExplorer
  ),
  "/sales/by-tag": lazyScreen(
    "sales/explorer",
    () => import("@/screens/sales/explorer"),
    (m) => m.SalesExplorer
  ),
  "/sales/by-article": lazyScreen(
    "sales/explorer",
    () => import("@/screens/sales/explorer"),
    (m) => m.SalesExplorer
  ),
  "/sales/by-sku": lazyScreen(
    "sales/explorer",
    () => import("@/screens/sales/explorer"),
    (m) => m.SalesExplorer
  ),
  "/sales/by-store": lazyScreen(
    "sales/explorer",
    () => import("@/screens/sales/explorer"),
    (m) => m.SalesExplorer
  ),
  "/sales/by-session": lazyScreen(
    "sales/explorer",
    () => import("@/screens/sales/explorer"),
    (m) => m.SalesExplorer
  ),
  "/sales/by-payment": lazyScreen(
    "sales/explorer",
    () => import("@/screens/sales/explorer"),
    (m) => m.SalesExplorer
  ),
  "/sales/by-supplier": lazyScreen(
    "sales/explorer",
    () => import("@/screens/sales/explorer"),
    (m) => m.SalesExplorer
  ),
  "/sales/by-po": lazyScreen(
    "sales/explorer",
    () => import("@/screens/sales/explorer"),
    (m) => m.SalesExplorer
  ),
  "/sales/by-campaign": lazyScreen(
    "sales/breakdown",
    () => import("@/screens/sales/breakdown"),
    (m) => m.SalesByCampaign
  ),
  "/sales/analytics": lazyScreen(
    "sales/analytics",
    () => import("@/screens/sales/analytics"),
    (m) => m.SalesAnalytics
  ),
  "/sales/returns": lazyScreen(
    "sales/returns",
    () => import("@/screens/sales/returns"),
    (m) => m.Returns
  ),
  "/sales/customer": lazyScreen(
    "sales/customer",
    () => import("@/screens/sales/customer"),
    (m) => m.Member
  ),
  "/sales/overview": lazyScreen(
    "sales/overview",
    () => import("@/screens/sales/overview"),
    (m) => m.Overview
  ),
}
