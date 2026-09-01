import type { ScreenMap } from "@/screens/registry"

import { Counts } from "@/screens/counting/counts"
import { CountSheet } from "@/screens/counting/sheet"
import { Ledger } from "@/screens/counting/ledger"
import { Stock } from "@/screens/counting/stock"

export const screens: ScreenMap = {
  "/counting": Counts,
  "/counting/sheet": CountSheet,
  "/counting/stock": Stock,
  "/counting/ledger": Ledger,
}
