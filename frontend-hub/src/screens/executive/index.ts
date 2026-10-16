import { lazyScreen, type ScreenMap } from "@/screens/registry"

export const screens: ScreenMap = {
  "/executive": lazyScreen(
    "executive/overview",
    () => import("@/screens/executive/overview"),
    (m) => m.ExecutiveOverview
  ),
  "/executive/stores": lazyScreen(
    "executive/stores",
    () => import("@/screens/executive/stores"),
    (m) => m.ExecutiveStores
  ),
  "/executive/stock": lazyScreen(
    "executive/stock",
    () => import("@/screens/executive/stock"),
    (m) => m.ExecutiveStock
  ),
  "/executive/finance": lazyScreen(
    "executive/finance",
    () => import("@/screens/executive/finance"),
    (m) => m.ExecutiveFinance
  ),
  "/executive/customers": lazyScreen(
    "executive/customers",
    () => import("@/screens/executive/customers"),
    (m) => m.ExecutiveCustomers
  ),
  "/executive/people": lazyScreen(
    "executive/people",
    () => import("@/screens/executive/people"),
    (m) => m.ExecutivePeople
  ),
}
