import type { ScreenMap } from "@/screens/registry"

import { Account } from "@/screens/operations/node/account"
import { Sync } from "@/screens/operations/node/sync"

export const screens: ScreenMap = {
  "/operations/node": Sync,
  "/operations/node/account": Account,
}
