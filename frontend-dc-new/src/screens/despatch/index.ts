import type { ScreenMap } from "@/screens/registry"

import { Consignments } from "@/screens/despatch/consignments"
import { Destinations } from "@/screens/despatch/destinations"
import { Trucks } from "@/screens/despatch/trucks"

export const screens: ScreenMap = {
  "/despatch": Consignments,
  "/despatch/trucks": Trucks,
  "/despatch/destinations": Destinations,
}
