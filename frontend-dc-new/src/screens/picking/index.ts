import type { ScreenMap } from "@/screens/registry"

import { LinePosition } from "@/screens/picking/lines"
import { Picklist } from "@/screens/picking/picklist"
import { PickRounds } from "@/screens/picking/rounds"

export const screens: ScreenMap = {
  "/picking": Picklist,
  "/picking/rounds": PickRounds,
  "/picking/lines": LinePosition,
}
