import type { ScreenMap } from "@/screens/registry"
import { ExecutiveCustomers } from "@/screens/executive/customers"
import { ExecutiveFinance } from "@/screens/executive/finance"
import { ExecutiveOverview } from "@/screens/executive/overview"
import { ExecutivePeople } from "@/screens/executive/people"
import { ExecutiveStock } from "@/screens/executive/stock"
import { ExecutiveStores } from "@/screens/executive/stores"

export const screens: ScreenMap = {
  "/executive": ExecutiveOverview,
  "/executive/stores": ExecutiveStores,
  "/executive/stock": ExecutiveStock,
  "/executive/finance": ExecutiveFinance,
  "/executive/customers": ExecutiveCustomers,
  "/executive/people": ExecutivePeople,
}
