import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/commercial": lazyScreen(
    "commercial/overview",
    () => import("@/screens/commercial/overview"),
    (m) => m.CommercialOverview
  ),
  "/commercial/prices": lazyScreen(
    "commercial/pricelist",
    () => import("@/screens/commercial/pricelist"),
    (m) => m.Pricelist
  ),
  "/commercial/changes": lazyScreen(
    "commercial/changes",
    () => import("@/screens/commercial/changes"),
    (m) => m.Changes
  ),
  "/commercial/history": lazyScreen(
    "commercial/history",
    () => import("@/screens/commercial/history"),
    (m) => m.History
  ),
  "/commercial/promotions": lazyScreen(
    "commercial/promotions",
    () => import("@/screens/commercial/promotions"),
    (m) => m.Promotions
  ),
  "/commercial/campaigns": lazyScreen(
    "commercial/campaigns",
    () => import("@/screens/commercial/campaigns"),
    (m) => m.Campaigns
  ),
  "/commercial/vouchers": lazyScreen(
    "commercial/vouchers",
    () => import("@/screens/commercial/vouchers"),
    (m) => m.Vouchers
  ),
  "/commercial/return-policy": lazyScreen(
    "commercial/return-policy",
    () => import("@/screens/commercial/return-policy"),
    (m) => m.ReturnPolicyScreen
  ),
  "/commercial/point-policy": lazyScreen(
    "commercial/point-policy",
    () => import("@/screens/commercial/point-policy"),
    (m) => m.PointPolicyScreen
  ),
  "/commercial/employee-discount": lazyScreen(
    "commercial/employee-discount",
    () => import("@/screens/commercial/employee-discount"),
    (m) => m.EmployeeDiscountPage
  ),
  "/commercial/employee-discount-history": lazyScreen(
    "commercial/employee-discount-history",
    () => import("@/screens/commercial/employee-discount-history"),
    (m) => m.EmployeeDiscountHistory
  ),
  "/commercial/employee-discount-settings": lazyScreen(
    "commercial/employee-discount-settings",
    () => import("@/screens/commercial/employee-discount-settings"),
    (m) => m.EmployeeDiscountSettings
  ),
}
