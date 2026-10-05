import type { ScreenMap } from "@/screens/registry"

import { StockLedger } from "@/screens/operations/ledger/ledger"

export const screens: ScreenMap = {
  "/operations/ledger": StockLedger,
}
