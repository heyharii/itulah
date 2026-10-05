import type { ScreenMap } from "@/screens/registry"

import { Packing } from "@/screens/operations/packing/packing"
import { PackingLists } from "@/screens/operations/packing/packing-lists"

export const screens: ScreenMap = {
  "/operations/packing": Packing,
  "/operations/packing-lists": PackingLists,
}
