import type { ScreenMap } from "@/screens/registry"

import { Counts } from "@/screens/operations/counting/counts"
import { CountSheet } from "@/screens/operations/counting/sheet"
import { Ledger } from "@/screens/operations/counting/ledger"
import { Stock } from "@/screens/operations/counting/stock"

export const screens: ScreenMap = {
  "/operations/counting": Counts,
  "/operations/counting/sheet": CountSheet,
  "/operations/counting/stock": Stock,
  "/operations/counting/ledger": Ledger,
}
