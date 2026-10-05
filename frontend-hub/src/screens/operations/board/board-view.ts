import { useCallback, useState } from "react"

import type { StageRow } from "@/screens/operations/board/stage-table"

export type BoardView = "board" | "table"

const VIEW_KEY = "hub.outbound.view"

/// Board or table, remembered for this viewer across the boards. A board
/// passed by name remembers its own answer; the shared default keeps the
/// outbound key the first board wrote, so nobody's toggle resets.
/// Storage can be blocked or hold nonsense — either way it is the board.
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
  return [view, set]
}

/// Stage order, then oldest first — the order the cards are read in.
export function byStage(rows: readonly StageRow[]): StageRow[] {
  return [...rows].sort(
    (left, right) =>
      left.stage.order - right.stage.order ||
      (left.at ?? "").localeCompare(right.at ?? "")
  )
}
