import type { ScreenMap } from "@/screens/registry"

import { LinePosition } from "@/screens/operations/picking/lines"
import { Picklist } from "@/screens/operations/picking/picklist"
import { PickRounds } from "@/screens/operations/picking/rounds"

export const screens: ScreenMap = {
  "/operations/picking": Picklist,
  "/operations/picking/rounds": PickRounds,
  "/operations/picking/lines": LinePosition,
}
