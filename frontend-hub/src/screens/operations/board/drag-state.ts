import { useDroppable } from "@dnd-kit/core"
import { createContext, useContext } from "react"

/// What a drag carries: the lane the card came from and the card's own value —
/// the same string the sheets that own the work open with (a picklist's
/// `allotment~shop`, a shop id).
export interface DraggedCard {
  lane: string
  card: string
  /// The card owes pieces back to stock: a forward drop says "Put back first".
  owed?: boolean
}

/// A lane that takes cards: from which lanes, what it says while a card is up
/// ("Pack", "Put back"), and what a drop opens.
export interface Target {
  accepts: Record<string, string>
  onDrop: (card: DraggedCard, lane: string) => void
}

export interface Up {
  card: DraggedCard
  node: React.ReactNode
  width: number
}

export const Live = createContext<{ up: Up | null; over: string | null }>({
  up: null,
  over: null,
})

/// What a lane draws while a card is up: `can` with its hint, `over` when the
/// card is above it, `no` when it takes nothing, `null` when nothing is up or
/// the card came from here. The lane registers itself with `useDropRef`.
export function useDropTarget(
  id: string,
  target: Target | undefined
): { mode: "can" | "over" | "no" | null; hint?: string } {
  const { up, over } = useContext(Live)
  if (up === null || target === undefined || up.card.lane === id)
    return { mode: null }
  const hint = target.accepts[up.card.lane]
  if (hint === undefined) return { mode: "no" }
  const shown =
    up.card.owed && hint !== "Put back" && hint !== "Unpack"
      ? "Put back first"
      : hint
  return { mode: over === id ? "over" : "can", hint: shown }
}

/// The element a lane takes drops on.
export function useDropRef(id: string, target: Target | undefined) {
  return useDroppable({ id, disabled: target === undefined, data: target })
    .setNodeRef
}
