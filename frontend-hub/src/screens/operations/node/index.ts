import type { ScreenMap } from "@/screens/registry"

import { edgeOnly } from "@/screens/operations/gate"
import { Account } from "@/screens/operations/node/account"
import { Sync } from "@/screens/operations/node/sync"

export const screens: ScreenMap = {
  "/operations/node": edgeOnly(Sync),
  "/operations/node/account": edgeOnly(Account),
}
