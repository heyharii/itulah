import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { useState, useSyncExternalStore } from "react"

import {
  Live,
  type DraggedCard,
  type Target,
  type Up,
} from "@/screens/operations/board/drag-state"

/// **Drag and drop on the board** (allotment-ops-prototype, 11 Oct 2026), on
/// dnd-kit so the card lifts and follows the pointer smoothly and flies home
/// when it lands nowhere. A mouse drags after 6 px; a tablet's finger after
/// holding 350 ms, so a quick swipe still scrolls the lane. While a card is up
/// every lane says what a drop there does, or dims when it takes nothing. A
/// drop never writes: it opens the sheet that does the move.
export function BoardDnd({ children }: { children: React.ReactNode }) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 350, tolerance: 8 },
    })
  )
  const [up, setUp] = useState<Up | null>(null)
  const [over, setOver] = useState<string | null>(null)
  /// The card landed where it may: the lifted copy goes at once while the
  /// sheet opens, instead of flying home as a refused drop does.
  const [landed, setLanded] = useState(false)
  const still = useReducedMotion()

  const accepted = (lane: unknown, card: DraggedCard | undefined) => {
    if (typeof lane !== "string" || card === undefined) return null
    return lane !== card.lane ? lane : null
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(event: DragStartEvent) => {
        const data = event.active.data.current as Omit<Up, "width"> | undefined
        if (data === undefined) return
        if (navigator.vibrate) navigator.vibrate(8)
        setUp({
          ...data,
          width: event.active.rect.current.initial?.width ?? 304,
        })
      }}
      onDragOver={(event: DragOverEvent) => {
        const target = event.over?.data.current as Target | undefined
        const card = up?.card
        const lane = accepted(event.over?.id, card)
        setOver(
          lane !== null && card && target?.accepts[card.lane] !== undefined
            ? lane
            : null
        )
      }}
      onDragEnd={(event: DragEndEvent) => {
        // The click that ends a drag is not a press on the card under it.
        const swallow = (click: MouseEvent) => {
          click.stopPropagation()
          click.preventDefault()
        }
        window.addEventListener("click", swallow, { capture: true, once: true })
        setTimeout(() => window.removeEventListener("click", swallow, true), 0)
        const target = event.over?.data.current as Target | undefined
        const card = up?.card
        const lane = accepted(event.over?.id, card)
        const valid =
          lane !== null &&
          card !== undefined &&
          target?.accepts[card.lane] !== undefined
        setLanded(valid)
        setUp(null)
        setOver(null)
        if (valid) target.onDrop(card, lane)
      }}
      onDragCancel={() => {
        setUp(null)
        setOver(null)
      }}
    >
      <Live.Provider value={{ up, over }}>{children}</Live.Provider>
      <DragOverlay
        dropAnimation={
          still || landed
            ? null
            : { duration: 200, easing: "cubic-bezier(0.23,1,0.32,1)" }
        }
      >
        {up !== null && (
          <div
            style={{ width: up.width }}
            // Lifts in (150 ms, ease-out) rather than appearing lifted: the
            // press becomes a pick-up the eye can follow.
            className="scale-[1.02] cursor-grabbing rounded-card shadow-[0_14px_34px_rgba(24,39,60,0.18),0_2px_6px_rgba(24,39,60,0.08)] transition-[scale,box-shadow] duration-150 ease-(--ease-out) motion-reduce:scale-100 motion-reduce:transition-none starting:scale-100 starting:shadow-none"
          >
            {up.node}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

/// A card that can be dragged: `node` is what the lifted copy shows.
export function DraggableCard({
  card,
  node,
  children,
}: {
  card: DraggedCard
  node: React.ReactNode
  children: React.ReactNode
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `${card.lane}:${card.card}`,
    data: { card, node },
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // The card's own press opens its sheet; Enter on it does the same,
      // so the keyboard keeps the card's button rather than a drag handle.
      role={undefined}
      tabIndex={undefined}
      className={
        "cursor-grab touch-pan-y transition-opacity duration-150 select-none [-webkit-touch-callout:none] active:cursor-grabbing" +
        (isDragging ? " opacity-35" : "")
      }
    >
      {children}
    </div>
  )
}

/// The reader's "reduce motion": the drop then lands without the flight home.
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (listen) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)")
      query.addEventListener("change", listen)
      return () => query.removeEventListener("change", listen)
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  )
}
