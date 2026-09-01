import type { ScreenMap } from "@/screens/registry"

import { Boxes } from "@/screens/packing/boxes"
import { FillBox } from "@/screens/packing/fill"
import { PackRounds } from "@/screens/packing/rounds"
import { Sweep } from "@/screens/packing/sweep"

export const screens: ScreenMap = {
  "/packing": Boxes,
  "/packing/fill": FillBox,
  "/packing/sweep": Sweep,
  "/packing/rounds": PackRounds,
}
