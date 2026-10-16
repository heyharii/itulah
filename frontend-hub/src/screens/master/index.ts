import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// New articles is its own page since 2026-10-02: the work area itself,
/// `SetupWorkspace` in `procurement/setups.tsx`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/master": lazyScreen(
    "master/articles",
    () => import("@/screens/master/articles"),
    (m) => m.Articles
  ),
  "/master/new-articles": lazyScreen(
    "master/new-articles",
    () => import("@/screens/master/new-articles"),
    (m) => m.NewArticles
  ),
  // Units is written in `inventory/`: one move of the MENU is not a reason to
  // move the code; only the path and the nav row belong to this module.
  "/master/organisation": lazyScreen(
    "system/organisation",
    () => import("@/screens/system/organisation"),
    (m) => m.Organisation
  ),
  // Where a shop is added and its server installed: the Stores screens of
  // `screens/stores/`, under a second path.
  "/master/stores": lazyScreen(
    "stores/list",
    () => import("@/screens/stores/list"),
    (m) => m.StoresList
  ),
  "/master/stores/$unit": lazyScreen(
    "stores/detail",
    () => import("@/screens/stores/detail"),
    (m) => m.StoreDetail
  ),
  "/master/units": lazyScreen(
    "inventory/units",
    () => import("@/screens/inventory/units"),
    (m) => m.Units
  ),
  "/master/destinations": lazyScreen(
    "procurement/destinations",
    () => import("@/screens/procurement/destinations"),
    (m) => m.Destinations
  ),
  // The supplier book, as Procurement has it: one screen, two paths.
  "/master/suppliers": lazyScreen(
    "procurement/offline-suppliers",
    () => import("@/screens/procurement/offline-suppliers"),
    (m) => m.SuppliersGate
  ),
  "/master/divisions": lazyScreen(
    "master/vocabulary",
    () => import("@/screens/master/vocabulary"),
    (m) => m.Divisions
  ),
  "/master/colours": lazyScreen(
    "master/colours",
    () => import("@/screens/master/colours"),
    (m) => m.Colours
  ),
  "/master/name-suggestions": lazyScreen(
    "master/name-suggestions",
    () => import("@/screens/master/name-suggestions"),
    (m) => m.NameSuggestions
  ),
  "/master/sizes": lazyScreen(
    "master/vocabulary",
    () => import("@/screens/master/vocabulary"),
    (m) => m.Sizes
  ),
  "/master/tags": lazyScreen(
    "master/vocabulary",
    () => import("@/screens/master/vocabulary"),
    (m) => m.Tags
  ),
  "/master/payment-templates": lazyScreen(
    "master/payment-templates",
    () => import("@/screens/master/payment-templates"),
    (m) => m.PaymentTemplates
  ),
}
