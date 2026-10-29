/// The keys of a list mode: the item list turned into Tunda, Struk or Cek.
///
/// Esc steps back one level, Enter does the main act, ↑ ↓ move the row and
/// Space ticks it. They are read on the window because the caret may be in the
/// scan field or in the mode's own search box, and neither is in the way: a
/// field that used the key itself (a search box clearing its text on Esc, or
/// opening its first match on Enter) calls `stopPropagation`, and the key never
/// gets here. Enter or Space in a field that has text is that field's — a code
/// being scanned — and on a button it is the button's own press.
///
/// `live` is false while anything is drawn over the list (a sheet, the finger,
/// the bags), so a key meant for that never steps the list back behind it.

import { useEffect, useRef } from "react"

export type ListKeys = {
  readonly back: () => void
  readonly enter?: () => void
  readonly move?: (by: 1 | -1) => void
  readonly space?: () => void
}

export function useListKeys(live: boolean, keys: ListKeys): void {
  const now = useRef(keys)
  now.current = keys
  useEffect(() => {
    if (!live) return
    function onKey(event: KeyboardEvent) {
      if (event.repeat) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (event.key === "Escape") {
        event.preventDefault()
        now.current.back()
      } else if (event.key === "Enter") {
        if (target instanceof HTMLButtonElement || target instanceof HTMLTextAreaElement) return
        if (target instanceof HTMLInputElement && target.value !== "") return
        const enter = now.current.enter
        if (enter === undefined) return
        event.preventDefault()
        enter()
      } else if (event.key === " ") {
        if (target instanceof HTMLButtonElement || target instanceof HTMLTextAreaElement) return
        if (target instanceof HTMLInputElement && target.value !== "") return
        const space = now.current.space
        if (space === undefined) return
        event.preventDefault()
        space()
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const move = now.current.move
        if (move === undefined) return
        event.preventDefault()
        move(event.key === "ArrowDown" ? 1 : -1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [live])
}
