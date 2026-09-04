import type { ScreenMap } from "@/screens/registry"

import { Boxes } from "@/screens/operations/packing/boxes"
import { FillBox } from "@/screens/operations/packing/fill"
import { PackRounds } from "@/screens/operations/packing/rounds"
import { Sweep } from "@/screens/operations/packing/sweep"

export const screens: ScreenMap = {
  "/operations/packing": Boxes,
  "/operations/packing/fill": FillBox,
  "/operations/packing/sweep": Sweep,
  "/operations/packing/rounds": PackRounds,
}
