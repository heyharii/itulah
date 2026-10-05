import type { ScreenMap } from "@/screens/registry"

import { Board } from "@/screens/operations/board/board"
import { StoreReturnsBoard } from "@/screens/operations/board/returns"
import { SuppliersBoard } from "@/screens/operations/board/suppliers"

export const screens: ScreenMap = {
  "/operations/board": Board,
  "/operations/board/returns": StoreReturnsBoard,
  "/operations/board/suppliers": SuppliersBoard,
}
