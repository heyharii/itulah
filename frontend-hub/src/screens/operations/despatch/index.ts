import type { ScreenMap } from "@/screens/registry"

import { Consignments } from "@/screens/operations/despatch/consignments"
import { Trucks } from "@/screens/operations/despatch/trucks"

export const screens: ScreenMap = {
  "/operations/despatch": Consignments,
  "/operations/despatch/trucks": Trucks,
}
