import type { ScreenMap } from "@/screens/registry"

import { Account } from "@/screens/node/account"
import { Sync } from "@/screens/node/sync"

export const screens: ScreenMap = {
  "/node": Sync,
  "/node/account": Account,
}
