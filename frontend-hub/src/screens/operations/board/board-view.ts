import { useCallback, useState } from "react"

import { useLayout } from "@/lib/layout"

import type { StageRow } from "@/screens/operations/board/stage-table"

export type BoardView = "board" | "table"

const VIEW_KEY = "hub.outbound.view"

/// Board or table, remembered for this viewer across the boards. A board
/// passed by name remembers its own answer; the shared default keeps the
/// outbound key the first board wrote, so nobody's toggle resets.
/// Storage can be blocked or hold nonsense — either way it is the board.
/// On a phone it is always the table.
export function useBoardView(
  board?: string
): [BoardView, (next: BoardView) => void] {
  const key = board === undefined ? VIEW_KEY : `hub.board.view:${board}`
  const [view, setView] = useState<BoardView>(() => {
    try {
      return localStorage.getItem(key) === "table" ? "table" : "board"
    } catch {
      return "board"
    }
  })
  const set = useCallback(
    (next: BoardView) => {
      setView(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        // A view that cannot be remembered is still a view.
      }
    },
    [key]
  )
  // A phone has no room to lay lanes side by side, and a board scrolled
  // sideways one lane at a time is not a board: it reads as the list it is
  // (owner, 2026-10-06). The remembered answer is for the glass that made it.
  const phone = useLayout() === "phone"
  return [phone ? "table" : view, set]
}

/// Stage order, then oldest first — the order the cards are read in.
export function byStage(rows: readonly StageRow[]): StageRow[] {
  // Rows with a button to press lead the list, whatever lane they sit in
  // (owner, 2026-10-05); then the lanes in their own order, oldest first.
  return [...rows].sort(
    (left, right) =>
      Number(right.act !== undefined) - Number(left.act !== undefined) ||
      left.stage.order - right.stage.order ||
      (left.at ?? "").localeCompare(right.at ?? "")
  )
}
